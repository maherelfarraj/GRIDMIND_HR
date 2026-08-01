import cron from "node-cron";
import { logger } from "./logger";
import { runBackup, pruneExpiredBackups } from "./backupService.js";

// ─── Scheduled backups ─────────────────────────────────────────────────────────
// A node-cron job runs a full pg_dump backup on a configurable cron expression
// (BACKUP_CRON, default nightly at 02:00) and then prunes dump files older than
// each record's retention_days, marking those records "expired".
//
// Set BACKUP_SCHEDULE_ENABLED="false" to disable (dev-only escape hatch).

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

export function getBackupScheduleStatus(): BackupScheduleStatus {
  return { ...status };
}

/** One scheduled cycle: full backup, then retention pruning. Exported for tests. */
export async function runScheduledBackupCycle(): Promise<void> {
  status.lastRunAt = new Date().toISOString();
  try {
    const record = await runBackup({
      backupType: "full",
      initiatedByUserId: null,
      notes: `Scheduled backup (cron: ${status.cronExpression})`,
    });
    if (record.status === "completed") {
      status.lastRunStatus = "completed";
      status.lastRunError = null;
      logger.info({ backupRecordId: record.id, fileSizeBytes: record.fileSizeBytes }, "Scheduled backup completed");
    } else {
      status.lastRunStatus = "failed";
      status.lastRunError = record.errorMessage ?? "Backup failed";
      logger.error({ backupRecordId: record.id, error: record.errorMessage }, "Scheduled backup failed");
    }
  } catch (err: any) {
    status.lastRunStatus = "failed";
    status.lastRunError = String(err?.message || err);
    logger.error({ err }, "Scheduled backup threw");
  }

  try {
    const prune = await pruneExpiredBackups();
    status.lastPrune = { expired: prune.expired, filesDeleted: prune.filesDeleted, errors: prune.errors.length };
    if (prune.expired > 0 || prune.errors.length > 0) {
      logger.info({ prune }, "Backup retention pruning finished");
    }
  } catch (err: any) {
    logger.error({ err }, "Backup retention pruning threw");
  }
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
    void runScheduledBackupCycle();
  });
  status.running = true;
  logger.info({ cron: expr }, "Backup scheduler started (nightly full backup + retention pruning)");
}

export function stopBackupScheduler(): void {
  if (task) {
    void task.stop();
    task = null;
  }
  status.running = false;
}
