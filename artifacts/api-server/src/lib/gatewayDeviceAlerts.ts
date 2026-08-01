import { and, eq, gte, ilike, inArray } from "drizzle-orm";
import { db, gatewayRegistrationsTable, notificationsTable, systemUsersTable, rolesTable } from "@workspace/db";
import { logger } from "./logger.js";
import { expireStaleDeviceCommandsOnce } from "./deviceCommandNotifications.js";

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
export const GATEWAY_AUTH_FAILED_ALERT_TYPE = "gateway_device_auth_failed";
export const GATEWAY_UNREACHABLE_ALERT_TYPE = "gateway_device_unreachable";
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

/** Active system users whose role name contains "admin" (System Administrator, HR Admin, ...). */
async function getAdminUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
  return rows.map((r) => r.id);
}

async function raiseAlert(
  reg: PrevState,
  notificationType: string,
  titleEn: string,
  titleAr: string,
  bodyEn: string,
  bodyAr: string,
): Promise<void> {
  const adminIds = await getAdminUserIds();
  if (!adminIds.length) return;
  await db.insert(notificationsTable).values(
    adminIds.map((userId) => ({
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

export function stopGatewaySilenceMonitor(): void {
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
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

/** Starts the background silent-gateway scheduler. Called from index.ts (not from tests). */
export function startGatewaySilenceMonitor(): void {
  if (silenceTimer) return;
  silenceTimer = setInterval(() => {
    if (silenceSweeping) return; // never overlap sweeps
    silenceSweeping = true;
    runGatewaySilenceSweepOnce()
      .then((r) => {
        if (r.alertsRaised > 0 || r.resolved > 0) {
          logger.info(r, "Gateway silence sweep completed");
        }
      })
      .catch((err) => logger.error({ err }, "Gateway silence sweep failed"))
      // Server-side command expiry: stale restart commands must expire (and
      // notify their requester) even when nobody has the device page open.
      .then(() => expireStaleDeviceCommandsOnce())
      .then((expired) => {
        if (expired > 0) logger.info({ expired }, "Stale device commands expired by sweep");
      })
      .catch((err) => logger.error({ err }, "Device command expiry sweep failed"))
      .finally(() => { silenceSweeping = false; });
  }, SILENCE_SWEEP_INTERVAL_MS);
  silenceTimer.unref?.();
  logger.info(
    { sweepIntervalMs: SILENCE_SWEEP_INTERVAL_MS, thresholdMs: GATEWAY_SILENCE_THRESHOLD_MS },
    "Gateway silence monitor started",
  );
}
