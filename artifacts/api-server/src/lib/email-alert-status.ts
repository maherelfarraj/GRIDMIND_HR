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
 * State is in-memory (per-process). After a restart the first failing send
 * simply re-raises the warning, which is the desired behavior anyway.
 */
import { and, eq, ilike } from "drizzle-orm";
import {
  db,
  notificationsTable,
  systemUsersTable,
  rolesTable,
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

let status: EmailDeliveryStatus = {
  outageActive: false,
  lastFailureMessage: null,
  lastFailureAt: null,
  outageSince: null,
  lastSuccessAt: null,
};

/** Current delivery status (e.g. for a health/integrations endpoint). */
export function getSecurityEmailDeliveryStatus(): EmailDeliveryStatus {
  return { ...status };
}

/** Test hook: reset the outage window between test cases. */
export function resetSecurityEmailDeliveryStatus(): void {
  status = {
    outageActive: false,
    lastFailureMessage: null,
    lastFailureAt: null,
    outageSince: null,
    lastSuccessAt: null,
  };
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
    return false;
  }

  const reason = outcome.message ?? "Unknown email delivery error";
  status.lastFailureMessage = reason;
  status.lastFailureAt = nowIso;

  // One warning per outage window: if we already warned and no success has
  // happened since, stay quiet.
  if (status.outageActive) return false;
  status.outageActive = true;
  status.outageSince = nowIso;

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
