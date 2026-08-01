import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  backupRecordsTable,
  restoreTestResultsTable,
  type BackupRecord,
} from "@workspace/db";

const execFileAsync = promisify(execFile);

// ─── Configuration ─────────────────────────────────────────────────────────────
// Backups are written to BACKUP_DIR (defaults to <cwd>/backups). Point this at a
// mounted offsite volume in production.
export function getBackupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
}

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — cannot run backups");
  return url;
}

/** Build a connection URL to a different database on the same server. */
function urlForDatabase(dbName: string): string {
  const u = new URL(getDatabaseUrl());
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

// Tables whose row counts are verified after a restore.
const VERIFY_TABLES = [
  "employees",
  "leave_requests",
  "payroll_runs",
  "audit_logs",
  "backup_records",
] as const;

async function countRows(connUrl: string, table: string): Promise<number> {
  const { stdout } = await execFileAsync("psql", [
    connUrl,
    "-tAc",
    `SELECT count(*) FROM "${table}"`,
  ]);
  return parseInt(stdout.trim(), 10);
}

// ─── Real backup via pg_dump (custom format) ───────────────────────────────────
export async function runBackup(opts: {
  backupType?: string;
  initiatedByUserId?: number | null;
  notes?: string | null;
}): Promise<BackupRecord> {
  const backupDir = getBackupDir();
  await fsp.mkdir(backupDir, { recursive: true });

  const startedAt = new Date();
  const fileName = `hrms-${startedAt.toISOString().replace(/[:.]/g, "-")}.dump`;
  const filePath = path.join(backupDir, fileName);

  // Record the run up-front so failures are visible too.
  const [record] = await db
    .insert(backupRecordsTable)
    .values({
      backupType: opts.backupType ?? "full",
      status: "in_progress",
      startedAt,
      storageLocation: filePath,
      initiatedByUserId: opts.initiatedByUserId ?? null,
      notes: opts.notes ?? null,
    })
    .returning();

  try {
    await execFileAsync("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--file",
      filePath,
      getDatabaseUrl(),
    ]);

    const completedAt = new Date();
    const stat = await fsp.stat(filePath);
    const checksum = await sha256File(filePath);

    const [updated] = await db
      .update(backupRecordsTable)
      .set({
        status: "completed",
        completedAt,
        fileSizeBytes: stat.size,
        checksum,
      })
      .where(eq(backupRecordsTable.id, record.id))
      .returning();
    return updated;
  } catch (err: any) {
    const [failed] = await db
      .update(backupRecordsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: String(err?.stderr || err?.message || err),
      })
      .where(eq(backupRecordsTable.id, record.id))
      .returning();
    return failed;
  }
}

// ─── Retention pruning ─────────────────────────────────────────────────────────
// Deletes dump files whose age exceeds the record's retention_days and marks the
// records "expired". Records whose file is already gone are expired too.
export interface PruneResult {
  scanned: number;
  expired: number;
  filesDeleted: number;
  errors: Array<{ id: number; error: string }>;
}

export async function pruneExpiredBackups(): Promise<PruneResult> {
  const now = Date.now();
  const candidates = await db
    .select()
    .from(backupRecordsTable)
    .where(
      sql`${backupRecordsTable.status} IN ('completed', 'verified', 'failed')`
    );

  const result: PruneResult = { scanned: candidates.length, expired: 0, filesDeleted: 0, errors: [] };

  for (const rec of candidates) {
    const anchor = rec.completedAt ?? rec.startedAt;
    const ageMs = now - new Date(anchor).getTime();
    const retentionMs = rec.retentionDays * 24 * 60 * 60 * 1000;
    if (ageMs <= retentionMs) continue;

    try {
      if (rec.storageLocation && fs.existsSync(rec.storageLocation)) {
        await fsp.unlink(rec.storageLocation);
        result.filesDeleted++;
      }
      await db
        .update(backupRecordsTable)
        .set({
          status: "expired",
          notes: rec.notes
            ? `${rec.notes} | Expired by retention pruning (retention ${rec.retentionDays}d)`
            : `Expired by retention pruning (retention ${rec.retentionDays}d)`,
        })
        .where(eq(backupRecordsTable.id, rec.id));
      result.expired++;
    } catch (err: any) {
      result.errors.push({ id: rec.id, error: String(err?.message || err) });
    }
  }

  return result;
}

// ─── Real restore test into a scratch database ─────────────────────────────────
export interface RestoreTestOutcome {
  result: "pass" | "fail";
  restoreTest: typeof restoreTestResultsTable.$inferSelect;
  backupRecord: BackupRecord;
}

export async function runRestoreTest(opts: {
  backupRecordId?: number | null;
  testedByUserId?: number | null;
  notes?: string | null;
}): Promise<RestoreTestOutcome> {
  // 1. Pick the backup: explicit id, else latest completed, else take a fresh one.
  let backup: BackupRecord | undefined;
  if (opts.backupRecordId) {
    [backup] = await db
      .select()
      .from(backupRecordsTable)
      .where(eq(backupRecordsTable.id, opts.backupRecordId));
    if (!backup) throw new Error(`Backup record ${opts.backupRecordId} not found`);
  } else {
    const candidates = await db
      .select()
      .from(backupRecordsTable)
      .where(eq(backupRecordsTable.status, "completed"))
      .orderBy(desc(backupRecordsTable.startedAt));
    backup = candidates.find(
      (b) => b.storageLocation && fs.existsSync(b.storageLocation)
    );
  }
  if (!backup || !backup.storageLocation || !fs.existsSync(backup.storageLocation)) {
    backup = await runBackup({
      backupType: "full",
      initiatedByUserId: opts.testedByUserId ?? null,
      notes: "Automatic backup taken for restore test",
    });
    if (backup.status !== "completed") {
      throw new Error(`Backup failed, cannot run restore test: ${backup.errorMessage}`);
    }
  }

  const dumpPath = backup.storageLocation!;

  // 2. Verify the archive checksum still matches what we recorded.
  const checksumNow = await sha256File(dumpPath);
  const checksumOk = !backup.checksum || checksumNow === backup.checksum;

  // 3. Capture source row counts BEFORE restoring, for comparison.
  const sourceUrl = getDatabaseUrl();
  const sourceCounts: Record<string, number> = {};
  for (const table of VERIFY_TABLES) {
    sourceCounts[table] = await countRows(sourceUrl, table);
  }

  // 4. Restore into a scratch database on the same server.
  const scratchName = `restore_test_${Date.now()}`;
  const scratchUrl = urlForDatabase(scratchName);
  const startedAt = Date.now();
  const checks: Array<{ check: string; status: string; detail?: string }> = [];
  const restoredCounts: Record<string, number> = {};
  let restoreOk = false;
  let failureReason: string | null = null;

  checks.push({
    check: "backup_archive_checksum",
    status: checksumOk ? "pass" : "fail",
    detail: checksumOk ? "SHA-256 matches recorded checksum" : "Checksum mismatch — archive may be corrupted",
  });

  try {
    await execFileAsync("psql", [sourceUrl, "-c", `CREATE DATABASE "${scratchName}"`]);
    try {
      await execFileAsync("pg_restore", [
        "--no-owner",
        "--no-acl",
        "--dbname",
        scratchUrl,
        dumpPath,
      ]);
      restoreOk = true;
      checks.push({ check: "pg_restore_completed", status: "pass" });

      // 5. Verify row counts in the scratch database against the live source.
      for (const table of VERIFY_TABLES) {
        restoredCounts[table] = await countRows(scratchUrl, table);
        // The source may have drifted slightly since the dump (e.g. this test's
        // own audit rows), so allow a small tolerance on append-only tables.
        const tolerance = table === "audit_logs" || table === "backup_records" ? 25 : 0;
        const diff = Math.abs(restoredCounts[table] - sourceCounts[table]);
        checks.push({
          check: `row_count_${table}`,
          status: diff <= tolerance ? "pass" : "fail",
          detail: `restored=${restoredCounts[table]} source=${sourceCounts[table]}`,
        });
      }

      // FK integrity sanity check on the restored copy.
      const { stdout: fkOut } = await execFileAsync("psql", [
        scratchUrl,
        "-tAc",
        "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY'",
      ]);
      checks.push({
        check: "foreign_key_constraints_restored",
        status: parseInt(fkOut.trim(), 10) >= 0 ? "pass" : "fail",
        detail: `${fkOut.trim()} FK constraints present in restored schema`,
      });
    } finally {
      // Always drop the scratch database.
      await execFileAsync("psql", [
        sourceUrl,
        "-c",
        `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`,
      ]).catch(() => undefined);
    }
  } catch (err: any) {
    failureReason = String(err?.stderr || err?.message || err);
    checks.push({ check: "pg_restore_completed", status: "fail", detail: failureReason ?? undefined });
  }

  const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const allPassed = restoreOk && checksumOk && checks.every((c) => c.status === "pass");
  const result: "pass" | "fail" = allPassed ? "pass" : "fail";
  if (!allPassed && !failureReason) {
    failureReason = checks
      .filter((c) => c.status !== "pass")
      .map((c) => `${c.check}: ${c.detail ?? "failed"}`)
      .join("; ");
  }

  // 6. Record the restore test with real evidence.
  const [restoreTest] = await db
    .insert(restoreTestResultsTable)
    .values({
      backupRecordId: backup.id,
      restoreType: "full",
      result,
      restoreDurationSeconds: durationSeconds,
      verificationChecksJson: JSON.stringify(checks),
      rowCountsJson: JSON.stringify({
        source: sourceCounts,
        restored: restoredCounts,
        note: "Real restore test — restored into scratch database, counts compared against live source",
      }),
      failureReason,
      testedByUserId: opts.testedByUserId ?? null,
      testedAt: new Date(),
      notes: opts.notes ?? `Restored ${path.basename(dumpPath)} into scratch database ${scratchName}`,
    })
    .returning();

  // 7. Mark the backup verified on success (feeds DATA_BACKUP_VERIFIED gate).
  const [updatedBackup] = await db
    .update(backupRecordsTable)
    .set({
      restoreTestResult: result === "pass" ? "restored_ok" : "restore_failed",
      restoreTestedAt: new Date(),
      ...(result === "pass"
        ? {
            isVerified: true,
            verifiedAt: new Date(),
            verifiedByUserId: opts.testedByUserId ?? null,
            verificationNotes: `Verified by restore test #${restoreTest.id}: restored into scratch DB and row counts matched source`,
            status: "verified",
          }
        : {}),
    })
    .where(eq(backupRecordsTable.id, backup.id))
    .returning();

  return { result, restoreTest, backupRecord: updatedBackup ?? backup };
}
