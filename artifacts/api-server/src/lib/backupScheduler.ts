import cron from "node-cron";
import { logger } from "./logger";
import { runBackup, pruneExpiredBackups, retryOffsiteUploads } from "./backupService.js";
import {
  createJobFailureAlerter,
  type JobRunResult,
} from "./backgroundJobAlerts.js";

// ─── Scheduled backups ─────────────────────────────────────────────────────────
// A node-cron job runs a full pg_dump backup on a configurable cron expression
// (BACKUP_CRON, default nightly at 02:00) and then prunes dump files older than
// each record's retention_days, marking those records "expired".
//
// Set BACKUP_SCHEDULE_ENABLED="false" to disable (dev-only escape hatch).
//
// Failure alerting: if the backup fails (record status "failed" or the call
// throws), an admin-facing notification is raised so gaps in backup coverage
// are noticed immediately rather than silently accumulating. Repeated failures
// don't re-alert — the outstanding-alert check (audit-trail-derived) prevents
// spam. A recovery notice is raised the first time the backup completes
// successfully again after an alert was outstanding.

const DEFAULT_CRON = "0 2 * * *"; // nightly at 02:00

export interface BackupScheduleStatus {
  enabled: boolean;
  cronExpression: string;
  valid: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: "completed" | "failed" | null;
  lastRunError: string | null;
  lastPrune: { expired: number; filesDeleted: number; errors: number } | null;
}

let task: ReturnType<typeof cron.schedule> | null = null;

/** In-progress backup cycle, so shutdown can await it instead of cutting it off mid-write. */
let inFlightCycle: Promise<void> | null = null;

const status: BackupScheduleStatus = {
  enabled: false,
  cronExpression: process.env.BACKUP_CRON || DEFAULT_CRON,
  valid: false,
  running: false,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  lastPrune: null,
};

// ─── Failure alerter ──────────────────────────────────────────────────────────
// Threshold of 1: nightly jobs have no redundant runs. A single missed backup
// means a day of missing coverage, which is worth an immediate admin alert.

/** Consecutive failures before admins are alerted (1 for nightly jobs). */
export const BACKUP_FAILURE_ALERT_THRESHOLD = 1;

// Audit-trail markers for the alert/recovery transition.
export const BACKUP_ALERT_ACTION = "scheduled_backup.alert";
export const BACKUP_RECOVERED_ACTION = "scheduled_backup.recovered";

const alerter = createJobFailureAlerter({
  entityType: "scheduled_backup",
  alertAction: BACKUP_ALERT_ACTION,
  recoveredAction: BACKUP_RECOVERED_ACTION,
  // Stable advisory-lock key — unique per job, never reused.
  lockKey: 0xba4b_bac4,
  threshold: BACKUP_FAILURE_ALERT_THRESHOLD,
  logLabel: "Scheduled backup",
  alertMessage: (failures, lastError) =>
    `The nightly scheduled backup has failed ${failures} consecutive time${failures !== 1 ? "s" : ""}. ` +
    `Database backups may be missing. Check the backup admin panel for details. Last error: ${lastError}`,
  recoveredMessage:
    "The nightly scheduled backup has recovered and completed successfully. " +
    "Database backup coverage is restored.",
  notification: {
    alertTitleEn: "Nightly backup failed",
    alertTitleAr: "فشل النسخ الاحتياطي الليلي",
    alertBodyAr: (failures) =>
      `فشل النسخ الاحتياطي المجدول ${failures} ${failures !== 1 ? "مرات متتالية" : "مرة"}. ` +
      `قد تكون النسخ الاحتياطية لقاعدة البيانات مفقودة. تحقق من لوحة إدارة النسخ الاحتياطية للاطلاع على التفاصيل.`,
    recoveredTitleEn: "Nightly backup recovered",
    recoveredTitleAr: "عاد النسخ الاحتياطي الليلي إلى العمل",
    recoveredBodyAr:
      "اكتمل النسخ الاحتياطي المجدول بنجاح. تمت استعادة تغطية النسخ الاحتياطي لقاعدة البيانات.",
    actionUrl: "/admin/backups",
    actionLabelEn: "View backups",
  },
});

/** Test-only: reset the in-memory failure streak. */
export function _resetBackupAlerterForTests(): void {
  alerter._resetForTests();
}

/**
 * Test-only: simulate the cron callback firing with an injectable cycle
 * function.  This is the only way to get `inFlightCycle` set in a test
 * environment where the real cron expression never fires.  Never call from
 * production code.
 */
export function _triggerBackupCycleForTest(
  cycleFn: () => Promise<void> = runScheduledBackupCycle,
): void {
  if (inFlightCycle) return; // honour the "never overlap" invariant
  inFlightCycle = cycleFn()
    .catch((err) => logger.error({ err }, "Scheduled backup cycle failed unexpectedly"))
    .finally(() => { inFlightCycle = null; });
}

export function getBackupScheduleStatus(): BackupScheduleStatus {
  return { ...status };
}

// ─── Backup step — throws on failure so the alerter can track the streak ──────

type BackupFn = () => Promise<void>;

/**
 * Runs the backup and updates module-level status. Throws when the backup
 * fails (record status ≠ "completed", or the call throws) so the alerter's
 * `runMonitored` can track the consecutive-failure streak.
 */
async function defaultBackupFn(): Promise<void> {
  let record;
  try {
    record = await runBackup({
      backupType: "full",
      initiatedByUserId: null,
      notes: `Scheduled backup (cron: ${status.cronExpression})`,
    });
  } catch (err: any) {
    status.lastRunStatus = "failed";
    status.lastRunError = String(err?.message || err);
    logger.error({ err }, "Scheduled backup threw");
    throw err;
  }

  if (record.status === "completed") {
    status.lastRunStatus = "completed";
    status.lastRunError = null;
    logger.info(
      { backupRecordId: record.id, fileSizeBytes: record.fileSizeBytes },
      "Scheduled backup completed",
    );
  } else {
    status.lastRunStatus = "failed";
    status.lastRunError = record.errorMessage ?? "Backup failed";
    logger.error(
      { backupRecordId: record.id, error: record.errorMessage },
      "Scheduled backup failed",
    );
    throw new Error(record.errorMessage ?? "Backup failed");
  }
}

// ─── Public cycle API ─────────────────────────────────────────────────────────

export type BackupCycleResult = JobRunResult;

/**
 * Runs the backup step through the failure alerter, then runs retention
 * pruning and offsite retry sweep regardless. The `backupFn` parameter is
 * injectable for tests; production callers omit it to use the real backup.
 *
 * Returns the alerter result (success/consecutiveFailures/alertRaised/
 * recoveryRaised) so tests can assert on alerting behaviour.
 */
export async function runMonitoredBackupCycle(
  backupFn: BackupFn = defaultBackupFn,
): Promise<BackupCycleResult> {
  status.lastRunAt = new Date().toISOString();
  const result = await alerter.runMonitored(backupFn);

  try {
    const prune = await pruneExpiredBackups();
    status.lastPrune = {
      expired: prune.expired,
      filesDeleted: prune.filesDeleted,
      errors: prune.errors.length,
    };
    if (prune.expired > 0 || prune.errors.length > 0) {
      logger.info({ prune }, "Backup retention pruning finished");
    }
  } catch (err: any) {
    logger.error({ err }, "Backup retention pruning threw");
  }

  try {
    const retry = await retryOffsiteUploads();
    if (retry.scanned > 0) {
      logger.info({ retry }, "Offsite upload retry sweep finished");
    }
  } catch (err: any) {
    logger.error({ err }, "Offsite upload retry sweep threw");
  }

  return result;
}

/**
 * One scheduled cycle exported for tests that need to drive the full backup
 * + prune + offsite retry path (without injectable backup function). Production
 * code and most tests should use `runMonitoredBackupCycle` directly.
 */
export async function runScheduledBackupCycle(): Promise<void> {
  await runMonitoredBackupCycle();
}

export function startBackupScheduler(): void {
  const expr = process.env.BACKUP_CRON || DEFAULT_CRON;
  status.cronExpression = expr;
  status.enabled = process.env.BACKUP_SCHEDULE_ENABLED !== "false";

  if (!status.enabled) {
    logger.warn("Backup scheduler disabled via BACKUP_SCHEDULE_ENABLED=\"false\"");
    return;
  }

  status.valid = cron.validate(expr);
  if (!status.valid) {
    logger.error({ expr }, "Invalid BACKUP_CRON expression — backup scheduler NOT started");
    return;
  }

  task = cron.schedule(expr, () => {
    if (inFlightCycle) return; // never overlap cycles
    inFlightCycle = runScheduledBackupCycle()
      .catch((err) => logger.error({ err }, "Scheduled backup cycle failed unexpectedly"))
      .finally(() => { inFlightCycle = null; });
  });
  status.running = true;
  logger.info({ cron: expr }, "Backup scheduler started (nightly full backup + retention pruning)");
}

/**
 * Stops the scheduler: cancels the cron job (no new cycles) and awaits any
 * backup cycle currently in flight so shutdown never cuts it off mid-write.
 */
export async function stopBackupScheduler(): Promise<void> {
  if (task) {
    void task.stop();
    task = null;
  }
  status.running = false;
  if (inFlightCycle) await inFlightCycle;
}
