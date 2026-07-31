import { and, eq, ilike, inArray } from "drizzle-orm";
import { db, notificationsTable, systemUsersTable, rolesTable } from "@workspace/db";
import { logger } from "./logger.js";

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
