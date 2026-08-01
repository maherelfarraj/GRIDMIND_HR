/**
 * Background job failure alerting — shared helper generalizing the
 * privileged-session sweeper's streak-tracking + audit-trail alert/recovery
 * pattern so every background loop (privileged-session sweeper, connection
 * health monitor sweep, ...) alerts security roles instead of only logging
 * when it silently stops working.
 *
 * Pattern (see .agents/memory/alert-recovery-dedupe.md):
 * - An in-memory consecutive-failure streak decides when to alert (resets on
 *   restart, which is correct: a fresh process hasn't failed yet).
 * - Whether an alert is *outstanding* is derived from the audit trail (the
 *   latest alert vs recovered event for the job's entityType), never from
 *   counters, so recovery notices fire only when an alert was actually raised
 *   — even across restarts.
 * - Transitions are claimed atomically under a per-job Postgres advisory lock
 *   inside the same transaction that writes the audit event + notifications,
 *   so concurrent paths can never emit duplicate notices.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  notificationsTable,
  systemUsersTable,
  rolesTable,
} from "@workspace/db";
import { logger } from "./logger.js";

/** Consecutive failures before security roles are alerted (shared default). */
export const JOB_FAILURE_ALERT_THRESHOLD = 3;

// Roles that must know when a background job stops working.
const SECURITY_ALERT_ROLES = ["Super Administrator", "Security Officer"] as const;

export interface JobRunResult {
  success: boolean;
  consecutiveFailures: number;
  alertRaised: boolean;
  recoveryRaised: boolean;
}

export interface JobAlertConfig {
  /** Audit-trail entityType identifying this job (e.g. "health_monitor_sweep"). */
  entityType: string;
  /** Audit action written when the failure alert is raised. */
  alertAction: string;
  /** Audit action written when the recovery notice is raised. */
  recoveredAction: string;
  /** App-defined advisory-lock key — must be unique per job. */
  lockKey: number;
  /** Consecutive failures before alerting. Defaults to JOB_FAILURE_ALERT_THRESHOLD. */
  threshold?: number;
  /** Short job name used in log lines (e.g. "Health monitor sweep"). */
  logLabel: string;
  /** In-app notification content. */
  notification: {
    alertTitleEn: string;
    alertTitleAr: string;
    alertBodyAr: (failures: number) => string;
    recoveredTitleEn: string;
    recoveredTitleAr: string;
    recoveredBodyAr: string;
    actionUrl: string;
    actionLabelEn: string;
  };
  /** English alert body — must explain the operational impact. */
  alertMessage: (failures: number, lastError: string) => string;
  /** English recovery body. */
  recoveredMessage: string;
}

async function getSecurityOfficerUserIds(
  tx: Pick<typeof db, "select"> = db,
): Promise<number[]> {
  const rows = await tx
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(
      eq(systemUsersTable.isActive, true),
      inArray(rolesTable.nameEn, [...SECURITY_ALERT_ROLES]),
    ));
  return rows.map((r) => r.id);
}

export interface JobFailureAlerter {
  /**
   * Wraps one run of the job: executes `jobFn`, updates the failure streak,
   * and raises the alert / recovery transition as appropriate. Never throws —
   * job errors are absorbed into the returned result (the scheduler loop must
   * keep ticking regardless).
   */
  runMonitored(jobFn: () => Promise<void>): Promise<JobRunResult>;
  /** Test-only: reset the in-memory failure streak. */
  _resetForTests(): void;
}

/**
 * Creates a failure alerter for one background job. Each job gets its own
 * in-memory streak and its own advisory-lock key / audit entityType, so jobs
 * alert and recover independently.
 */
export function createJobFailureAlerter(config: JobAlertConfig): JobFailureAlerter {
  const threshold = config.threshold ?? JOB_FAILURE_ALERT_THRESHOLD;
  let consecutiveFailures = 0;

  /**
   * Latest alert/recovered event decides whether an alert is outstanding —
   * derived from the audit trail, not from counters, so a recovery notice
   * fires only when an alert was actually raised.
   */
  async function hasOutstandingAlert(tx: Pick<typeof db, "select">): Promise<boolean> {
    const [latest] = await tx
      .select({ action: auditLogsTable.action })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.entityType, config.entityType),
        inArray(auditLogsTable.action, [config.alertAction, config.recoveredAction]),
      ))
      .orderBy(desc(auditLogsTable.id))
      .limit(1);
    return latest?.action === config.alertAction;
  }

  /**
   * Raises the failure alert (audit event + notifications) unless one is
   * already outstanding. Claimed atomically under the job's advisory lock so
   * two concurrent failing paths emit exactly one alert.
   */
  async function raiseFailureAlert(failures: number, lastError: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${config.lockKey})`);
      if (await hasOutstandingAlert(tx)) return false;

      const message = config.alertMessage(failures, lastError);

      await tx.insert(auditLogsTable).values({
        actorUserId: null,
        action: config.alertAction,
        entityType: config.entityType,
        entityId: null,
        entityLabel: "job failures",
        changesJson: JSON.stringify({
          consecutiveFailures: failures,
          threshold,
          lastError,
        }),
      });

      const officerIds = await getSecurityOfficerUserIds(tx);
      if (officerIds.length) {
        await tx.insert(notificationsTable).values(officerIds.map((userId) => ({
          recipientUserId: userId,
          notificationType: "security_alert",
          titleEn: config.notification.alertTitleEn,
          titleAr: config.notification.alertTitleAr,
          bodyEn: message,
          bodyAr: config.notification.alertBodyAr(failures),
          severity: "urgent",
          actionUrl: config.notification.actionUrl,
          actionLabelEn: config.notification.actionLabelEn,
          entityType: config.entityType,
          entityId: null,
          requiresAction: true,
        })));
      }
      return true;
    });
  }

  /**
   * Raises the recovery notice iff an alert is actually outstanding (atomic
   * claim under the same advisory lock). Returns true when this call raised it.
   */
  async function raiseRecoveryIfAlerted(): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${config.lockKey})`);
      if (!(await hasOutstandingAlert(tx))) return false;

      await tx.insert(auditLogsTable).values({
        actorUserId: null,
        action: config.recoveredAction,
        entityType: config.entityType,
        entityId: null,
        entityLabel: "job recovered",
        changesJson: JSON.stringify({ threshold }),
      });

      const officerIds = await getSecurityOfficerUserIds(tx);
      if (officerIds.length) {
        await tx.insert(notificationsTable).values(officerIds.map((userId) => ({
          recipientUserId: userId,
          notificationType: "security_alert",
          titleEn: config.notification.recoveredTitleEn,
          titleAr: config.notification.recoveredTitleAr,
          bodyEn: config.recoveredMessage,
          bodyAr: config.notification.recoveredBodyAr,
          severity: "success",
          actionUrl: config.notification.actionUrl,
          actionLabelEn: config.notification.actionLabelEn,
          entityType: config.entityType,
          entityId: null,
          requiresAction: false,
        })));
      }
      return true;
    });
  }

  async function runMonitored(jobFn: () => Promise<void>): Promise<JobRunResult> {
    try {
      await jobFn();
    } catch (err) {
      consecutiveFailures += 1;
      logger.error({ err, consecutiveFailures }, `${config.logLabel} failed`);
      let alertRaised = false;
      // Alert once when the streak reaches the threshold; the outstanding-alert
      // check keeps later failures from re-alerting even after a restart.
      if (consecutiveFailures >= threshold) {
        try {
          alertRaised = await raiseFailureAlert(
            consecutiveFailures,
            err instanceof Error ? err.message : String(err),
          );
          if (alertRaised) {
            logger.warn({ consecutiveFailures }, `${config.logLabel} failure alert raised`);
          }
        } catch (alertErr) {
          // Likely the same DB outage that broke the job — the next failing
          // run retries the alert (streak stays past the threshold).
          logger.error({ err: alertErr }, `Failed to raise ${config.logLabel} alert`);
        }
      }
      return { success: false, consecutiveFailures, alertRaised, recoveryRaised: false };
    }

    const hadFailures = consecutiveFailures > 0;
    consecutiveFailures = 0;
    let recoveryRaised = false;
    // Check even without in-memory failures: after a restart the streak resets
    // but an alert raised by the previous process may still be outstanding.
    try {
      recoveryRaised = await raiseRecoveryIfAlerted();
      if (recoveryRaised) {
        logger.info({ hadFailures }, `${config.logLabel} recovery notice raised`);
      }
    } catch (recoveryErr) {
      logger.error({ err: recoveryErr }, `Failed to raise ${config.logLabel} recovery notice`);
    }
    return { success: true, consecutiveFailures: 0, alertRaised: false, recoveryRaised };
  }

  return {
    runMonitored,
    _resetForTests() { consecutiveFailures = 0; },
  };
}
