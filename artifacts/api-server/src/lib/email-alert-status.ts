/**
 * Security-alert email delivery watchdog.
 *
 * Lockout (and other security) alert emails are fire-and-forget: SMTP being
 * unconfigured or down must never block the auth path. But dropping them with
 * only a console.error means nobody inside the app knows security emails are
 * being lost. This module turns each send outcome into visible state:
 *
 *  - On the FIRST failure of an outage window, an in-app "security_alert"
 *    notification is written to every active admin explaining that security
 *    alert emails are not being delivered (with the underlying reason).
 *  - Subsequent failures during the same outage are deduplicated — no spam.
 *  - A successful send closes the outage window, so a later failure raises a
 *    fresh warning.
 *
 * Persistence: status is written through to system_config ("smtp.emailAlertStatus")
 * on every mutation, so the indicator survives API server restarts. On startup,
 * the persisted row is loaded back into memory before any request is served
 * (await emailAlertStatusReady). In-process mutations that race the startup
 * hydration take precedence — the flag `_mutatedBeforeHydrate` guards this.
 */
import { and, eq, ilike } from "drizzle-orm";
import {
  db,
  notificationsTable,
  systemUsersTable,
  rolesTable,
  systemConfigTable,
} from "@workspace/db";

export interface EmailDeliveryStatus {
  /** True while we're inside an unresolved outage window. */
  outageActive: boolean;
  /** Message from the last failed send (config missing or SMTP error). */
  lastFailureMessage: string | null;
  /** When the last failure happened. */
  lastFailureAt: string | null;
  /** When the current outage window was first noticed. */
  outageSince: string | null;
  /** When the last successful send happened. */
  lastSuccessAt: string | null;
}

const CONFIG_KEY = "smtp.emailAlertStatus";

let status: EmailDeliveryStatus = {
  outageActive: false,
  lastFailureMessage: null,
  lastFailureAt: null,
  outageSince: null,
  lastSuccessAt: null,
};

// ---------------------------------------------------------------------------
// Write-through persistence
// ---------------------------------------------------------------------------

/**
 * True once any in-process mutation has fired. If this is true when hydration
 * completes, the persisted row is stale relative to in-memory state and must
 * not overwrite it.
 */
let _mutatedBeforeHydrate = false;

/** Single promise chain serialising all writes to the one config row. */
let _writeChain: Promise<void> = Promise.resolve();

function persistStatus(snapshot: EmailDeliveryStatus): void {
  _mutatedBeforeHydrate = true;
  const value = JSON.stringify(snapshot);
  _writeChain = _writeChain
    .then(() =>
      db
        .insert(systemConfigTable)
        .values({
          key: CONFIG_KEY,
          value,
          valueType: "json",
          category: "smtp",
          labelEn: "Security email delivery status",
          labelAr: "حالة تسليم البريد الإلكتروني الأمني",
        })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value, updatedAt: new Date() },
        })
    )
    .then(() => {})
    .catch((err) => {
      console.error("[emailAlertStatus] failed to persist status:", err);
    });
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/**
 * Load the persisted delivery status from system_config. Called once at
 * module load. Only applies the persisted value when no in-process mutation
 * has already set a newer state (same guard as loginThrottle hydration).
 */
async function hydrateStatus(): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, CONFIG_KEY));
    if (row && !_mutatedBeforeHydrate) {
      const persisted = JSON.parse(row.value) as Partial<EmailDeliveryStatus>;
      status = {
        outageActive: persisted.outageActive ?? false,
        lastFailureMessage: persisted.lastFailureMessage ?? null,
        lastFailureAt: persisted.lastFailureAt ?? null,
        outageSince: persisted.outageSince ?? null,
        lastSuccessAt: persisted.lastSuccessAt ?? null,
      };
    }
  } catch (err) {
    console.error("[emailAlertStatus] failed to hydrate status:", err);
  }
}

/** Resolves once persisted state has been loaded (never rejects). */
export const emailAlertStatusReady: Promise<void> = hydrateStatus();

/**
 * Test/diagnostic hook: flush pending DB writes, then re-run hydration against
 * the current DB contents, overwriting in-memory state. Simulates a server
 * restart: all in-flight writes land first, then the state is re-read as a
 * fresh process would see it.
 */
export async function rehydrateSecurityEmailStatus(): Promise<void> {
  // Drain the write chain so the DB row is up-to-date before we read it.
  await _writeChain;
  _mutatedBeforeHydrate = false;
  await hydrateStatus();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Current delivery status (e.g. for a health/integrations endpoint). */
export function getSecurityEmailDeliveryStatus(): EmailDeliveryStatus {
  return { ...status };
}

/** Test hook: reset the outage window between test cases. */
export async function resetSecurityEmailDeliveryStatus(): Promise<void> {
  status = {
    outageActive: false,
    lastFailureMessage: null,
    lastFailureAt: null,
    outageSince: null,
    lastSuccessAt: null,
  };
  _mutatedBeforeHydrate = false;
  // Drain pending writes before deleting so a straggling upsert cannot land
  // after the delete and resurrect state.
  const pending = _writeChain;
  _writeChain = Promise.resolve();
  try {
    await pending;
    await db.delete(systemConfigTable).where(eq(systemConfigTable.key, CONFIG_KEY)).then(() => {});
  } catch (err) {
    console.error("[emailAlertStatus] failed to reset persisted status:", err);
  }
}

async function getActiveAdminIds(): Promise<number[]> {
  const rows = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
  return rows.map((r) => r.id);
}

/**
 * Record the outcome of a security-alert email send. Never throws.
 * Returns true when a new outage warning notification was raised.
 */
export async function recordSecurityEmailOutcome(
  outcome: { success: boolean; message?: string },
  context: string,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  if (outcome.success) {
    status.outageActive = false;
    status.outageSince = null;
    status.lastSuccessAt = nowIso;
    persistStatus({ ...status });
    return false;
  }

  const reason = outcome.message ?? "Unknown email delivery error";
  status.lastFailureMessage = reason;
  status.lastFailureAt = nowIso;

  // One warning per outage window: if we already warned and no success has
  // happened since, stay quiet.
  if (status.outageActive) {
    persistStatus({ ...status });
    return false;
  }
  status.outageActive = true;
  status.outageSince = nowIso;
  persistStatus({ ...status });

  try {
    const adminIds = await getActiveAdminIds();
    if (adminIds.length === 0) return false;
    await db.insert(notificationsTable).values(adminIds.map((recipientUserId) => ({
      recipientUserId,
      notificationType: "security_alert" as const,
      titleEn: "Security alert emails are not being delivered",
      titleAr: "رسائل التنبيهات الأمنية لا يتم إرسالها",
      bodyEn:
        `A security alert email (${context}) could not be sent and email delivery ` +
        `is currently failing. Reason: ${reason}. ` +
        `In-app notifications still work, but email alerts are being dropped until this is fixed. ` +
        `Check the SMTP settings on the integrations page.`,
      bodyAr:
        `تعذر إرسال بريد إلكتروني للتنبيه الأمني (${context}) وفشل إرسال البريد حاليًا. ` +
        `السبب: ${reason}. ` +
        `لا تزال الإشعارات داخل التطبيق تعمل، لكن تنبيهات البريد الإلكتروني تُفقد حتى يتم إصلاح ذلك. ` +
        `تحقق من إعدادات SMTP في صفحة التكاملات.`,
      severity: "urgent",
      actionUrl: "/integration-governance",
      actionLabelEn: "Check SMTP settings",
      entityType: "smtp",
      requiresAction: true,
    })));
    return true;
  } catch (err) {
    // Watchdog must never break the caller; the console message still exists.
    console.error("Failed to write security email outage notification:", err);
    return false;
  }
}
