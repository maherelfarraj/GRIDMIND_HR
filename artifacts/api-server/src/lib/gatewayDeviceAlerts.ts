import { and, eq, gte, ilike, inArray } from "drizzle-orm";
import { db, gatewayRegistrationsTable, notificationsTable, systemUsersTable, rolesTable } from "@workspace/db";
import { logger } from "./logger.js";
import { expireStaleDeviceCommandsOnce, backfillMissedCommandOutcomeNotifications } from "./deviceCommandNotifications.js";
import { sendSmtpMail } from "./smtp-adapter.js";
import { createJobFailureAlerter, JOB_FAILURE_ALERT_THRESHOLD, type JobRunResult } from "./backgroundJobAlerts.js";

/**
 * Gateway device warning notifications.
 *
 * A heartbeat can move a gateway registration into (or out of) a warning
 * state: the vendor SDK went missing, or the device clock skew crossed the
 * alert threshold. Admins should hear about the *transition* exactly once —
 * not on every subsequent heartbeat while the condition persists — and the
 * open alert should be auto-resolved (dismissed) when the condition clears.
 *
 * Transition detection compares the registration row as it was BEFORE the
 * heartbeat (already loaded by the signature middleware) against the values
 * the heartbeat is persisting, so no extra state table is needed and repeat
 * heartbeats in the same state are naturally deduplicated.
 */

export const GATEWAY_SDK_ALERT_TYPE = "gateway_sdk_missing";
export const GATEWAY_SKEW_ALERT_TYPE = "gateway_clock_skew";

export const GATEWAY_SILENT_ALERT_TYPE = "gateway_silent";
export const GATEWAY_BATCH_DISCREPANCY_ALERT_TYPE = "gateway_batch_discrepancy";
export const GATEWAY_AUTH_FAILED_ALERT_TYPE = "gateway_device_auth_failed";
export const GATEWAY_UNREACHABLE_ALERT_TYPE = "gateway_device_unreachable";

export const GATEWAY_CREDENTIAL_UNUSABLE_ALERT_TYPE = "gateway_credential_unusable";

/**
 * Raised once per open pepper-rotation window (GATEWAY_KEY_PEPPER_PREVIOUS set
 * but all envelopes already re-wrapped). Stored with entityType="system_config"
 * and entityId=0 so it is not tied to any individual gateway registration.
 */
export const GATEWAY_PEPPER_WINDOW_OPEN_ALERT_TYPE = "gateway_pepper_window_open";
/** Connection-test statuses that raise an admin alert. */
const CONN_ALERT_STATUSES = ["AUTH_FAILED", "UNREACHABLE"] as const;
type ConnAlertStatus = (typeof CONN_ALERT_STATUSES)[number];
const CONN_ALERT_TYPE_BY_STATUS: Record<ConnAlertStatus, string> = {
  AUTH_FAILED: GATEWAY_AUTH_FAILED_ALERT_TYPE,
  UNREACHABLE: GATEWAY_UNREACHABLE_ALERT_TYPE,
};

interface PrevState {
  id: number;
  name: string;
  nameAr: string | null;
  sdkPresent: boolean | null;
  deviceClockSkewAlert: boolean;
  adapterConnStatus: string | null;
}

interface NextState {
  /** New SDK presence, if the heartbeat reported it. */
  sdkPresent?: boolean;
  /** New skew-alert flag, if the heartbeat measured (or explicitly cleared) skew. */
  deviceClockSkewAlert?: boolean;
  /** Measured skew in ms (for the notification body). */
  deviceClockSkewMs?: number | null;
  /** New adapter connection-test status, if the heartbeat reported one. */
  adapterConnStatus?: string;
  /** Connection-test message (for the notification body). */
  adapterConnMessage?: string;
}

/**
 * Alert types that warrant an email as well as an in-app notification.
 * SDK-missing and clock-skew are lower-severity warnings; batch-discrepancy
 * alerts are their own category. The types below indicate that punch
 * collection has stopped completely or the credential must be re-registered.
 */
const EMAIL_ALERT_TYPES = new Set([
  GATEWAY_SILENT_ALERT_TYPE,
  GATEWAY_AUTH_FAILED_ALERT_TYPE,
  GATEWAY_UNREACHABLE_ALERT_TYPE,
  GATEWAY_CREDENTIAL_UNUSABLE_ALERT_TYPE,
]);

/** Active system users whose role name contains "admin" (System Administrator, HR Admin, ...). */
async function getAdminUsers(): Promise<Array<{ id: number; email: string }>> {
  const rows = await db
    .select({ id: systemUsersTable.id, email: systemUsersTable.email })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
  return rows;
}

async function raiseAlert(
  reg: PrevState,
  notificationType: string,
  titleEn: string,
  titleAr: string,
  bodyEn: string,
  bodyAr: string,
): Promise<void> {
  const admins = await getAdminUsers();
  if (!admins.length) return;
  await db.insert(notificationsTable).values(
    admins.map(({ id: userId }) => ({
      recipientUserId: userId,
      notificationType,
      titleEn,
      titleAr,
      bodyEn,
      bodyAr,
      severity: "urgent",
      actionUrl: "/attendance-gateway",
      actionLabelEn: "View gateway status",
      entityType: "gateway_registration",
      entityId: reg.id,
      requiresAction: true,
    })),
  );
  logger.warn({ registrationId: reg.id, notificationType }, "Gateway device alert raised");

  // Send an email for critical failure types (unreachable / auth failed / silent).
  // SMTP being unconfigured or failing must never break the heartbeat or sweep.
  if (EMAIL_ALERT_TYPES.has(notificationType)) {
    const to = admins.map((a) => a.email);
    sendSmtpMail({ to, subject: `[GridMindHR Alert] ${titleEn}`, text: bodyEn })
      .then((result) => {
        if (!result.success) {
          logger.warn(
            { registrationId: reg.id, notificationType, reason: result.message },
            "Gateway alert email not delivered",
          );
        }
      })
      .catch((err) => {
        logger.error({ err, registrationId: reg.id, notificationType }, "Gateway alert email send threw unexpectedly");
      });
  }
}

/** Auto-resolve (dismiss) all open alerts of a given type for this registration. */
async function resolveAlerts(registrationId: number, notificationTypes: string[]): Promise<void> {
  await db
    .update(notificationsTable)
    .set({ isDismissed: true, dismissedAt: new Date() })
    .where(
      and(
        inArray(notificationsTable.notificationType, notificationTypes),
        eq(notificationsTable.entityType, "gateway_registration"),
        eq(notificationsTable.entityId, registrationId),
        eq(notificationsTable.isDismissed, false),
      ),
    );
}

/**
 * Compare pre-heartbeat state with the values just persisted and notify /
 * resolve accordingly. Never throws — a notification failure must not fail
 * the heartbeat itself.
 */
export async function processGatewayWarningTransitions(prev: PrevState, next: NextState): Promise<void> {
  try {
    const nameAr = prev.nameAr ?? prev.name;

    // Any heartbeat means the gateway is no longer silent — auto-resolve an
    // open silence alert immediately (single UPDATE; no-op when none open).
    await resolveAlerts(prev.id, [GATEWAY_SILENT_ALERT_TYPE]);

    // SDK presence transitions (only when this heartbeat reported the field).
    if (typeof next.sdkPresent === "boolean") {
      if (next.sdkPresent === false && prev.sdkPresent !== false) {
        await raiseAlert(
          prev,
          GATEWAY_SDK_ALERT_TYPE,
          `Gateway "${prev.name}": vendor SDK missing`,
          `البوابة "${nameAr}": حزمة SDK الخاصة بالمورد مفقودة`,
          `The attendance gateway "${prev.name}" reported that its vendor SDK is not available. Punch collection from the biometric device may be interrupted until the SDK is restored.`,
          `أبلغت بوابة الحضور "${nameAr}" أن حزمة SDK الخاصة بالمورد غير متوفرة. قد يتوقف جمع البصمات حتى تتم استعادة الحزمة.`,
        );
      } else if (next.sdkPresent === true && prev.sdkPresent === false) {
        await resolveAlerts(prev.id, [GATEWAY_SDK_ALERT_TYPE]);
      }
    }

    // Device clock skew transitions (only when this heartbeat measured or
    // explicitly cleared the skew).
    if (typeof next.deviceClockSkewAlert === "boolean") {
      if (next.deviceClockSkewAlert && !prev.deviceClockSkewAlert) {
        const skewSec = next.deviceClockSkewMs != null ? Math.round(Math.abs(next.deviceClockSkewMs) / 1000) : null;
        const skewEn = skewSec != null ? ` by ~${skewSec}s` : "";
        await raiseAlert(
          prev,
          GATEWAY_SKEW_ALERT_TYPE,
          `Gateway "${prev.name}": device clock skew detected`,
          `البوابة "${nameAr}": انحراف في ساعة الجهاز`,
          `The biometric device behind gateway "${prev.name}" reported a clock skewed${skewEn} beyond the 60s tolerance. Punch timestamps may be inaccurate until the device clock is corrected.`,
          `أبلغ الجهاز خلف البوابة "${nameAr}" عن انحراف في الساعة يتجاوز حد الـ 60 ثانية. قد تكون أوقات البصمات غير دقيقة حتى يتم تصحيح ساعة الجهاز.`,
        );
      } else if (!next.deviceClockSkewAlert && prev.deviceClockSkewAlert) {
        await resolveAlerts(prev.id, [GATEWAY_SKEW_ALERT_TYPE]);
      }
    }

    // Adapter connection-test transitions (only when this heartbeat reported
    // a structured status). Entering AUTH_FAILED or UNREACHABLE notifies once;
    // any change away from a failing status resolves that status's alerts, and
    // a return to REACHABLE resolves everything.
    if (typeof next.adapterConnStatus === "string" && next.adapterConnStatus !== prev.adapterConnStatus) {
      // Resolve alerts for failing statuses we just left.
      const cleared = CONN_ALERT_STATUSES
        .filter((s) => s !== next.adapterConnStatus)
        .map((s) => CONN_ALERT_TYPE_BY_STATUS[s]);
      if (cleared.length) {
        await resolveAlerts(prev.id, cleared);
      }
      const detail = next.adapterConnMessage ? ` Gateway reported: ${next.adapterConnMessage.slice(0, 300)}` : "";
      if (next.adapterConnStatus === "AUTH_FAILED") {
        await raiseAlert(
          prev,
          GATEWAY_AUTH_FAILED_ALERT_TYPE,
          `Gateway "${prev.name}": device rejected login`,
          `البوابة "${nameAr}": رفض الجهاز تسجيل الدخول`,
          `The biometric device behind gateway "${prev.name}" rejected the gateway's login credentials. Punches are NOT being collected until the device credentials are corrected.${detail}`,
          `رفض الجهاز خلف البوابة "${nameAr}" بيانات اعتماد تسجيل الدخول الخاصة بالبوابة. لن يتم جمع البصمات حتى يتم تصحيح بيانات اعتماد الجهاز.`,
        );
      } else if (next.adapterConnStatus === "UNREACHABLE") {
        await raiseAlert(
          prev,
          GATEWAY_UNREACHABLE_ALERT_TYPE,
          `Gateway "${prev.name}": device unreachable`,
          `البوابة "${nameAr}": تعذر الوصول إلى الجهاز`,
          `The biometric device behind gateway "${prev.name}" could not be reached. Punches are NOT being collected until connectivity is restored.${detail}`,
          `تعذر الوصول إلى الجهاز خلف البوابة "${nameAr}". لن يتم جمع البصمات حتى تتم استعادة الاتصال.`,
        );
      }
    }
  } catch (e) {
    logger.error({ err: e, registrationId: prev.id }, "Failed to process gateway warning transitions");
  }
}

/**
 * Credential-unusable transitions.
 *
 * Called whenever the `credentialUnusable` flag changes on a registration:
 *  - false → true: the stored envelope can no longer be decrypted (tampered
 *    pepper, lost key); the gateway will 401 until it is re-registered. Raise
 *    a one-time alert and send email (critical: punch collection has stopped).
 *  - true → false: self-heal (pepper restored / re-registration) — auto-
 *    resolve any open credential-unusable alert.
 *
 * Transition detection is done here (prev vs next) so callers that have
 * already gated their update behind `if (!reg.credentialUnusable)` do not
 * need to pass redundant state. Never throws — a notification failure must
 * not propagate to the calling request or sweep.
 */
export async function processCredentialUnusableTransitions(
  reg: { id: number; name: string; nameAr: string | null; credentialUnusable: boolean },
  nextUnusable: boolean,
): Promise<void> {
  try {
    const nameAr = reg.nameAr ?? reg.name;
    if (nextUnusable && !reg.credentialUnusable) {
      await raiseAlert(
        { id: reg.id, name: reg.name, nameAr: reg.nameAr, sdkPresent: null, deviceClockSkewAlert: false, adapterConnStatus: null },
        GATEWAY_CREDENTIAL_UNUSABLE_ALERT_TYPE,
        `Gateway "${reg.name}": credential unusable — re-register`,
        `البوابة "${nameAr}": بيانات الاعتماد غير صالحة — يرجى إعادة التسجيل`,
        `The attendance gateway "${reg.name}" can no longer authenticate because its stored credential cannot be decrypted (the signing-key envelope may have been tampered with or the pepper lost). Punch collection has stopped. Re-register the gateway to restore connectivity.`,
        `تعذر على بوابة الحضور "${nameAr}" المصادقة لأن بيانات الاعتماد المخزنة لا يمكن فك تشفيرها (ربما تعرض غلاف مفتاح التوقيع للتلاعب أو فُقد الفلفل). توقف جمع البصمات. أعد تسجيل البوابة لاستعادة الاتصال.`,
      );
    } else if (!nextUnusable && reg.credentialUnusable) {
      await resolveAlerts(reg.id, [GATEWAY_CREDENTIAL_UNUSABLE_ALERT_TYPE]);
    }
  } catch (e) {
    logger.error({ err: e, registrationId: reg.id }, "Failed to process credential-unusable transitions");
  }
}
/**
 * Punch-batch reconcile discrepancy transitions.
 *
 * A reconcile can move a registration into (or out of) a discrepancy state:
 * the gateway believes it delivered batches the server never received
 * (MISSING_ON_SERVER) or whose event counts disagree (COUNT_MISMATCH).
 * Missing punches directly affect payroll, so HR admins must hear about the
 * *transition* exactly once — not on every periodic reconcile while the same
 * discrepancy persists — and the open alert auto-resolves when a later
 * reconcile comes back clean.
 *
 * Transition detection compares the previous reconcile outcome (the latest
 * gateway_reconcile audit row, already loaded by the route) against the
 * current one. As with silence alerts, an admin dismissing the notification
 * is an acknowledgement, not a recovery: while the registration stays in a
 * discrepancy state no new alert is raised even if the set of affected
 * batches shifts, because an open-or-dismissed alert for the current episode
 * already exists; only a clean reconcile resets the episode.
 * Never throws — a notification failure must not fail the reconcile itself.
 */
export async function processReconcileDiscrepancyTransitions(
  reg: { id: number; name: string; nameAr: string | null },
  prevHadDiscrepancy: boolean,
  current: { missing: string[]; mismatched: string[] },
): Promise<void> {
  try {
    const hasDiscrepancy = current.missing.length > 0 || current.mismatched.length > 0;
    if (!hasDiscrepancy) {
      if (prevHadDiscrepancy) {
        await resolveAlerts(reg.id, [GATEWAY_BATCH_DISCREPANCY_ALERT_TYPE]);
      }
      return;
    }
    if (prevHadDiscrepancy) return; // same episode — no repeat spam
    const nameAr = reg.nameAr ?? reg.name;
    const parts: string[] = [];
    const partsAr: string[] = [];
    if (current.missing.length) {
      parts.push(`${current.missing.length} batch(es) were never received by the server`);
      partsAr.push(`${current.missing.length} دفعة لم يستلمها الخادم إطلاقًا`);
    }
    if (current.mismatched.length) {
      parts.push(`${current.mismatched.length} batch(es) have mismatched event counts`);
      partsAr.push(`${current.mismatched.length} دفعة بعدد أحداث غير مطابق`);
    }
    await raiseAlert(
      { id: reg.id, name: reg.name, nameAr: reg.nameAr, sdkPresent: null, deviceClockSkewAlert: false, adapterConnStatus: null },
      GATEWAY_BATCH_DISCREPANCY_ALERT_TYPE,
      `Gateway "${reg.name}": punch batches missing on server`,
      `البوابة "${nameAr}": دفعات بصمات مفقودة على الخادم`,
      `Batch reconciliation for gateway "${reg.name}" found a delivery discrepancy: ${parts.join("; ")}. Missing punches directly affect payroll — investigate before the next payroll run.`,
      `كشفت مطابقة الدفعات لبوابة "${nameAr}" عن اختلاف في التسليم: ${partsAr.join("؛ ")}. البصمات المفقودة تؤثر مباشرة على الرواتب — يرجى التحقق قبل تشغيل الرواتب القادم.`,
    );
  } catch (e) {
    logger.error({ err: e, registrationId: reg.id }, "Failed to process reconcile discrepancy transitions");
  }
}

/**
 * Silent-gateway sweep.
 *
 * Heartbeat-driven alerts can never fire for a gateway that stopped talking
 * altogether (power loss, network outage, crashed service). A periodic sweep
 * flags ACTIVE registrations whose lastHeartbeatAt is older than the
 * threshold. One notification per outage: a stale registration only raises a
 * new alert when it has no open (undismissed) silence alert; resumed
 * heartbeats auto-resolve it (both in processGatewayWarningTransitions and,
 * as a backstop, here for fresh registrations).
 */

export const GATEWAY_SILENCE_THRESHOLD_MS = Math.max(
  60_000,
  Number(process.env["GATEWAY_SILENCE_THRESHOLD_MINUTES"] || 10) * 60_000 || 10 * 60_000,
);

/**
 * Effective silence threshold for one registration: the per-registration
 * override (minutes, clamped to >= 1) when set, otherwise the given global
 * default. Shared by the sweep and the admin listing so both always agree.
 */
export function effectiveSilenceThresholdMs(
  silenceThresholdMinutes: number | null | undefined,
  defaultMs: number = GATEWAY_SILENCE_THRESHOLD_MS,
): number {
  if (silenceThresholdMinutes != null && Number.isFinite(silenceThresholdMinutes) && silenceThresholdMinutes > 0) {
    return Math.max(60_000, Math.round(silenceThresholdMinutes) * 60_000);
  }
  return defaultMs;
}

/**
 * Shared device connectivity verdict, used by BOTH the devices list and the
 * device health endpoint so they can never disagree.
 *
 * Last real contact = the most recent of any ACTIVE registration's
 * heartbeat/last-seen and the device's stored lastSyncAt. The silence
 * threshold is the effective (per-registration override aware) threshold of
 * the ACTIVE registration with the most recent contact; without any active
 * registration, the global default applies.
 */
export function deviceConnectivityVerdict(
  registrations: Array<{
    status: string;
    lastHeartbeatAt: Date | null;
    lastSeenAt: Date | null;
    silenceThresholdMinutes: number | null;
  }>,
  lastSyncAt: Date | null,
  now: number = Date.now(),
): { lastContactMs: number | null; thresholdMs: number; isOnline: boolean; isStale: boolean } {
  let bestRegTs = 0;
  let thresholdMs = GATEWAY_SILENCE_THRESHOLD_MS;
  for (const r of registrations) {
    if (r.status !== "ACTIVE") continue;
    const ts = Math.max(r.lastHeartbeatAt?.getTime() ?? 0, r.lastSeenAt?.getTime() ?? 0);
    if (ts > bestRegTs) {
      bestRegTs = ts;
      thresholdMs = effectiveSilenceThresholdMs(r.silenceThresholdMinutes);
    }
  }
  const syncTs = lastSyncAt?.getTime() ?? 0;
  const lastContactMs = Math.max(bestRegTs, syncTs) || null;
  const isOnline = lastContactMs !== null && now - lastContactMs <= thresholdMs;
  return { lastContactMs, thresholdMs, isOnline, isStale: lastContactMs !== null && !isOnline };
}

/**
 * Stops the scheduler: clears the interval (no new sweeps) and awaits any
 * sweep currently in flight so shutdown never cuts it off mid-write.
 */
export async function stopGatewaySilenceMonitor(): Promise<void> {
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
  if (inFlightSilenceSweep) await inFlightSilenceSweep;
}

async function hasOpenSilenceAlert(registrationId: number): Promise<boolean> {
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_SILENT_ALERT_TYPE),
        eq(notificationsTable.entityType, "gateway_registration"),
        eq(notificationsTable.entityId, registrationId),
        eq(notificationsTable.isDismissed, false),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface GatewaySilenceSweepResult {
  checked: number;
  silent: number;
  alertsRaised: number;
  resolved: number;
}

/**
 * "One alert per outage" must survive an admin dismissing the notification
 * while the gateway is still silent — dismissal is an acknowledgement, not a
 * recovery. The outage itself is identified by its baseline (the last
 * heartbeat / contact before the silence): any silence notification created
 * AFTER that baseline — dismissed or not — belongs to the current outage, so
 * the sweep must not raise another. A resumed heartbeat advances the
 * baseline past all existing notifications, which is what allows the NEXT
 * outage to alert again.
 */
async function hasAlertForCurrentOutage(registrationId: number, outageBaseline: Date): Promise<boolean> {
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_SILENT_ALERT_TYPE),
        eq(notificationsTable.entityType, "gateway_registration"),
        eq(notificationsTable.entityId, registrationId),
        gte(notificationsTable.createdAt, outageBaseline),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Runs one silence sweep. Exported separately from the scheduler so it can be
 * tested directly. Never throws for a single registration — one bad row must
 * not stall the sweep.
 */
export async function runGatewaySilenceSweepOnce(
  options: { thresholdMs?: number; now?: Date } = {},
): Promise<GatewaySilenceSweepResult> {
  const thresholdMs = options.thresholdMs ?? GATEWAY_SILENCE_THRESHOLD_MS;
  const now = options.now ?? new Date();
  const result: GatewaySilenceSweepResult = { checked: 0, silent: 0, alertsRaised: 0, resolved: 0 };

  const regs = await db
    .select({
      id: gatewayRegistrationsTable.id,
      name: gatewayRegistrationsTable.name,
      nameAr: gatewayRegistrationsTable.nameAr,
      lastHeartbeatAt: gatewayRegistrationsTable.lastHeartbeatAt,
      lastSeenAt: gatewayRegistrationsTable.lastSeenAt,
      createdAt: gatewayRegistrationsTable.createdAt,
      silenceThresholdMinutes: gatewayRegistrationsTable.silenceThresholdMinutes,
    })
    .from(gatewayRegistrationsTable)
    .where(eq(gatewayRegistrationsTable.status, "ACTIVE"));

  for (const reg of regs) {
    result.checked += 1;
    try {
      // A registration that never heartbeated yet is measured from its last
      // contact of any kind, falling back to creation time — so a gateway
      // that was registered but never came online is also caught.
      const baseline = reg.lastHeartbeatAt ?? reg.lastSeenAt ?? reg.createdAt;
      // A per-registration threshold (admin-set, minutes) overrides the
      // global default for this row only.
      const regThresholdMs = effectiveSilenceThresholdMs(reg.silenceThresholdMinutes, thresholdMs);
      const silent = now.getTime() - new Date(baseline).getTime() >= regThresholdMs;
      if (silent) {
        result.silent += 1;
        if (!(await hasAlertForCurrentOutage(reg.id, new Date(baseline)))) {
          const nameAr = reg.nameAr ?? reg.name;
          const minutes = Math.max(1, Math.round((now.getTime() - new Date(baseline).getTime()) / 60_000));
          const lastEn = reg.lastHeartbeatAt
            ? `Its last heartbeat was ~${minutes} minutes ago.`
            : "It has never sent a heartbeat since registration.";
          await raiseAlert(
            { id: reg.id, name: reg.name, nameAr: reg.nameAr, sdkPresent: null, deviceClockSkewAlert: false, adapterConnStatus: null },
            GATEWAY_SILENT_ALERT_TYPE,
            `Gateway "${reg.name}": no heartbeat received`,
            `البوابة "${nameAr}": لم يتم استلام نبضات`,
            `The attendance gateway "${reg.name}" has stopped sending heartbeats (power loss, network outage, or crashed service). ${lastEn} Punch collection is interrupted until it reconnects.`,
            `توقفت بوابة الحضور "${nameAr}" عن إرسال النبضات (انقطاع كهرباء أو شبكة أو تعطل الخدمة). جمع البصمات متوقف حتى إعادة الاتصال.`,
          );
          result.alertsRaised += 1;
        }
      } else if (await hasOpenSilenceAlert(reg.id)) {
        // Backstop: heartbeats resumed but the heartbeat-path resolution was
        // missed (e.g. it errored) — resolve here.
        await resolveAlerts(reg.id, [GATEWAY_SILENT_ALERT_TYPE]);
        result.resolved += 1;
      }
    } catch (e) {
      logger.error({ err: e, registrationId: reg.id }, "Gateway silence sweep failed for registration");
    }
  }

  return result;
}

const SILENCE_SWEEP_INTERVAL_MS = 60_000;

let silenceSweeping = false;

let silenceTimer: NodeJS.Timeout | null = null;

/** In-progress sweep chain, so shutdown can await it instead of cutting it off mid-write. */
let inFlightSilenceSweep: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Sweep-loop failure alerting
// ---------------------------------------------------------------------------

/** Consecutive sweep-loop failures before security officers are alerted. */
export const GATEWAY_SILENCE_SWEEP_FAILURE_ALERT_THRESHOLD = JOB_FAILURE_ALERT_THRESHOLD;

/** Audit action written when the silence-sweep failure alert is raised. */
export const GATEWAY_SILENCE_SWEEP_ALERT_ACTION = "gateway_silence_sweep.alert";

/** Audit action written when the silence sweep recovers. */
export const GATEWAY_SILENCE_SWEEP_RECOVERED_ACTION = "gateway_silence_sweep.recovered";

const silenceSweepAlerter = createJobFailureAlerter({
  entityType: "gateway_silence_sweep",
  alertAction: GATEWAY_SILENCE_SWEEP_ALERT_ACTION,
  recoveredAction: GATEWAY_SILENCE_SWEEP_RECOVERED_ACTION,
  // Unique app-defined advisory-lock key for this loop
  // (distinct from the health-monitor key 0x4ea1_7451 and the privileged-session sweeper).
  lockKey: 0x2b9f_6d84,
  threshold: GATEWAY_SILENCE_SWEEP_FAILURE_ALERT_THRESHOLD,
  logLabel: "Gateway silence sweep",
  alertMessage: (failures, lastError) =>
    `The background gateway silence checker has failed ${failures} consecutive times. ` +
    `Silent gateways (power loss, network outage, crashed service) are no longer being detected, ` +
    `so punch-collection outages may go unnoticed. Last error: ${lastError}`,
  recoveredMessage:
    "The background gateway silence checker has recovered and is running again. " +
    "Silent gateway detection is active once more.",
  notification: {
    alertTitleEn: "Gateway silence checker is failing",
    alertTitleAr: "توقف فاحص صمت البوابات عن العمل",
    alertBodyAr: (failures) =>
      `فشل فاحص صمت البوابات في الخلفية ${failures} مرات متتالية. لم يعد يتم اكتشاف البوابات الصامتة، لذا قد تمر انقطاعات جمع البصمات دون ملاحظة.`,
    recoveredTitleEn: "Gateway silence checker recovered",
    recoveredTitleAr: "عاد فاحص صمت البوابات إلى العمل",
    recoveredBodyAr:
      "عاد فاحص صمت البوابات في الخلفية إلى العمل وبات يكتشف البوابات الصامتة مرة أخرى.",
    actionUrl: "/attendance-gateway",
    actionLabelEn: "View gateway status",
  },
});

/** Test-only: reset the silence-sweep failure streak between test cases. */
export function _resetSilenceSweepStateForTests(): void {
  silenceSweepAlerter._resetForTests();
}

export type SilenceSweepRunResult = JobRunResult;

/**
 * Runs one monitored silence sweep: executes `runGatewaySilenceSweepOnce` and
 * updates the sweep-loop failure streak / alert state. Exported so tests can
 * drive it directly; `sweepFn` is injectable to simulate failures.
 */
export async function runMonitoredGatewaySilenceSweep(
  sweepFn: () => Promise<void> = async () => {
    const r = await runGatewaySilenceSweepOnce();
    if (r.alertsRaised > 0 || r.resolved > 0) {
      logger.info(r, "Gateway silence sweep completed");
    }
  },
): Promise<SilenceSweepRunResult> {
  return silenceSweepAlerter.runMonitored(sweepFn);
}

/**
 * System-level sentinel for notifications not tied to a specific gateway
 * registration. Uses entityType="system_config" and entityId=0.
 */
const SYSTEM_ENTITY_TYPE = "system_config";
const SYSTEM_ENTITY_ID = 0;

/**
 * Check whether an undismissed pepper-window-open notification already exists.
 * The alert is global (entityType=system_config, entityId=0), so a single
 * check covers all admin recipients.
 */
async function hasOpenPepperWindowAlert(): Promise<boolean> {
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_PEPPER_WINDOW_OPEN_ALERT_TYPE),
        eq(notificationsTable.entityType, SYSTEM_ENTITY_TYPE),
        eq(notificationsTable.entityId, SYSTEM_ENTITY_ID),
        eq(notificationsTable.isDismissed, false),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Auto-resolve (dismiss) any open pepper-window-open notifications. */
async function resolvePepperWindowAlerts(): Promise<void> {
  await db
    .update(notificationsTable)
    .set({ isDismissed: true, dismissedAt: new Date() })
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_PEPPER_WINDOW_OPEN_ALERT_TYPE),
        eq(notificationsTable.entityType, SYSTEM_ENTITY_TYPE),
        eq(notificationsTable.entityId, SYSTEM_ENTITY_ID),
        eq(notificationsTable.isDismissed, false),
      ),
    );
}

/**
 * Notify admins once per open pepper-rotation window.
 *
 * "Open" means GATEWAY_KEY_PEPPER_PREVIOUS is still set even though all
 * envelopes have already been re-wrapped under the new pepper (rotationComplete
 * = true, pendingRewrap = 0). The old pepper stays live and weakens the
 * rotation until an operator removes the env var.
 *
 * Deduplication: the notification is stored with entityType="system_config" /
 * entityId=0. The function checks for an existing undismissed notification
 * before inserting, so repeat server starts during the same open window do
 * not spam admins. Auto-resolves when the window closes (PREVIOUS pepper
 * removed) or while re-wraps are still pending.
 *
 * Never throws — a notification failure must not abort startup.
 */
export async function processPepperRotationWindowAlert(status: {
  windowOpen: boolean;
  rotationComplete: boolean;
  pendingRewrap: number;
}): Promise<void> {
  try {
    if (!status.windowOpen) {
      // Pepper env var removed — close the window; resolve any open alert.
      await resolvePepperWindowAlerts();
      return;
    }
    if (!status.rotationComplete || status.pendingRewrap > 0) {
      // Re-wraps still pending — don't alert yet; the window must stay open.
      return;
    }
    // Window is complete-but-open. Alert once per window.
    if (await hasOpenPepperWindowAlert()) return;
    const admins = await getAdminUsers();
    if (!admins.length) return;
    await db.insert(notificationsTable).values(
      admins.map(({ id: userId }) => ({
        recipientUserId: userId,
        notificationType: GATEWAY_PEPPER_WINDOW_OPEN_ALERT_TYPE,
        titleEn: "Gateway key rotation window left open",
        titleAr: "نافذة تدوير مفاتيح البوابة مفتوحة",
        bodyEn:
          "All gateway key envelopes have been re-wrapped under the new pepper, but GATEWAY_KEY_PEPPER_PREVIOUS is still set. The old pepper remains live and weakens the rotation. Remove GATEWAY_KEY_PEPPER_PREVIOUS from the server environment to close the window.",
        bodyAr:
          "تمت إعادة تغليف جميع مفاتيح البوابة تحت الـ pepper الجديد، لكن GATEWAY_KEY_PEPPER_PREVIOUS لا يزال مضبوطًا. يبقى الـ pepper القديم نشطًا مما يضعف عملية التدوير. أزل GATEWAY_KEY_PEPPER_PREVIOUS من بيئة الخادم لإغلاق النافذة.",
        severity: "warning",
        actionUrl: "/integration-governance",
        actionLabelEn: "View governance status",
        entityType: SYSTEM_ENTITY_TYPE,
        entityId: SYSTEM_ENTITY_ID,
        requiresAction: true,
      })),
    );
    logger.warn("Pepper rotation window left open — admin notification raised");
  } catch (e) {
    logger.error({ err: e }, "Failed to process pepper rotation window alert");
  }
}

/**
 * Default sweep chain for the gateway silence monitor: silence sweep →
 * command expiry → outcome-notification backfill.  Extracted so the
 * start function can use it as its default `sweepFn` while tests can
 * substitute a controlled function without touching the DB.
 */
async function defaultGatewaySilenceSweep(): Promise<void> {
  try {
    const r = await runMonitoredGatewaySilenceSweep();
    void r; // result already logged inside runMonitoredGatewaySilenceSweep
  } catch (err) {
    logger.error({ err }, "Gateway silence sweep failed unexpectedly");
  }
  try {
    const expired = await expireStaleDeviceCommandsOnce();
    if (expired > 0) logger.info({ expired }, "Stale device commands expired by sweep");
  } catch (err) {
    logger.error({ err }, "Device command expiry sweep failed");
  }
  try {
    const backfilled = await backfillMissedCommandOutcomeNotifications();
    if (backfilled > 0) logger.info({ backfilled }, "Missed command outcome notifications backfilled");
  } catch (err) {
    logger.error({ err }, "Command outcome notification backfill failed");
  }
}

/**
 * Starts the background silent-gateway scheduler. Called from index.ts (not from tests).
 *
 * `sweepFn` is injectable for tests: pass a controlled function to drive the
 * start/stop contract without touching the DB.  Production callers omit it
 * to get the real sweep chain (silence + command expiry + backfill).
 */
export function startGatewaySilenceMonitor(
  sweepFn: () => Promise<void> = defaultGatewaySilenceSweep,
): void {
  if (silenceTimer) return;
  silenceTimer = setInterval(() => {
    if (silenceSweeping) return; // never overlap sweeps
    silenceSweeping = true;
    inFlightSilenceSweep = sweepFn()
      .catch((err) => logger.error({ err }, "Gateway silence monitor sweep chain failed unexpectedly"))
      .finally(() => { silenceSweeping = false; inFlightSilenceSweep = null; });
  }, SILENCE_SWEEP_INTERVAL_MS);
  silenceTimer.unref?.();
  logger.info(
    { sweepIntervalMs: SILENCE_SWEEP_INTERVAL_MS, thresholdMs: GATEWAY_SILENCE_THRESHOLD_MS },
    "Gateway silence monitor started",
  );
}
