import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { eq, inArray } from "drizzle-orm";
import { db, backupRecordsTable } from "@workspace/db";
import { pruneExpiredBackups } from "../lib/backupService.js";
import {
  getBackupScheduleStatus,
  startBackupScheduler,
  stopBackupScheduler,
} from "../lib/backupScheduler.js";

// Self-cleaning fixtures: every record we insert is tracked and deleted.
const createdIds: number[] = [];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-prune-test-"));

afterAll(async () => {
  if (createdIds.length) {
    await db.delete(backupRecordsTable).where(inArray(backupRecordsTable.id, createdIds));
  }
  await fsp.rm(tmpDir, { recursive: true, force: true });
  stopBackupScheduler();
});

async function insertBackup(opts: {
  daysOld: number;
  retentionDays: number;
  withFile?: boolean;
  status?: string;
}): Promise<{ id: number; filePath: string | null }> {
  let filePath: string | null = null;
  if (opts.withFile) {
    filePath = path.join(tmpDir, `dump-${Date.now()}-${Math.random().toString(36).slice(2)}.dump`);
    await fsp.writeFile(filePath, "fake dump contents");
  }
  const completedAt = new Date(Date.now() - opts.daysOld * 24 * 60 * 60 * 1000);
  const [rec] = await db
    .insert(backupRecordsTable)
    .values({
      backupType: "full",
      status: opts.status ?? "completed",
      startedAt: completedAt,
      completedAt,
      retentionDays: opts.retentionDays,
      storageLocation: filePath,
      notes: "backup-schedule.test fixture",
    })
    .returning();
  createdIds.push(rec.id);
  return { id: rec.id, filePath };
}

describe("retention pruning", () => {
  it("deletes dump files past retention and marks records expired", async () => {
    const old = await insertBackup({ daysOld: 10, retentionDays: 3, withFile: true });
    const fresh = await insertBackup({ daysOld: 1, retentionDays: 3, withFile: true });

    const result = await pruneExpiredBackups();
    expect(result.errors).toEqual([]);

    const [oldRow] = await db.select().from(backupRecordsTable).where(eq(backupRecordsTable.id, old.id));
    const [freshRow] = await db.select().from(backupRecordsTable).where(eq(backupRecordsTable.id, fresh.id));

    expect(oldRow.status).toBe("expired");
    expect(fs.existsSync(old.filePath!)).toBe(false);

    expect(freshRow.status).toBe("completed");
    expect(fs.existsSync(fresh.filePath!)).toBe(true);
  });

  it("expires records whose file is already missing without error", async () => {
    const gone = await insertBackup({ daysOld: 30, retentionDays: 5, withFile: false });
    const result = await pruneExpiredBackups();
    expect(result.errors).toEqual([]);
    const [row] = await db.select().from(backupRecordsTable).where(eq(backupRecordsTable.id, gone.id));
    expect(row.status).toBe("expired");
  });

  it("does not touch in-progress or already-expired records", async () => {
    const inProgress = await insertBackup({ daysOld: 40, retentionDays: 1, withFile: false, status: "in_progress" });
    await pruneExpiredBackups();
    const [row] = await db.select().from(backupRecordsTable).where(eq(backupRecordsTable.id, inProgress.id));
    expect(row.status).toBe("in_progress");
  });
});

describe("BACKUP_SCHEDULE_CONFIGURED gate", () => {
  it("reflects the real scheduler status, not a proxy backup count", async () => {
    const request = (await import("supertest")).default;
    const { default: app } = await import("../app.js");

    startBackupScheduler();
    let res = await request(app).post("/api/go-live-gates/evaluate").send({});
    expect(res.status).toBe(200);
    let gate = res.body.gates.find((g: any) => g.gateCode === "BACKUP_SCHEDULE_CONFIGURED");
    expect(gate.status).toBe("pass");
    const evidence = JSON.parse(gate.evidenceJson);
    expect(evidence.scheduler.running).toBe(true);
    expect(evidence.scheduler.cronExpression).toBe(process.env.BACKUP_CRON || "0 2 * * *");

    stopBackupScheduler();
    res = await request(app).post("/api/go-live-gates/evaluate").send({});
    gate = res.body.gates.find((g: any) => g.gateCode === "BACKUP_SCHEDULE_CONFIGURED");
    expect(gate.status).toBe("fail");
  }, 60_000);
});

describe("backup scheduler status", () => {
  it("starts with the configured cron expression and reports a running schedule", () => {
    startBackupScheduler();
    const status = getBackupScheduleStatus();
    expect(status.enabled).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.running).toBe(true);
    expect(status.cronExpression).toBe(process.env.BACKUP_CRON || "0 2 * * *");
    stopBackupScheduler();
    expect(getBackupScheduleStatus().running).toBe(false);
  });
});
