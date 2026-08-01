import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import * as fs from "node:fs";
import { inArray, eq } from "drizzle-orm";
import { db, backupRecordsTable, restoreTestResultsTable } from "@workspace/db";
import app from "../app";

// Real backup + restore test flow: pg_dump → scratch DB restore → row-count verify.
// Self-cleaning: removes created rows and dump files in afterAll.

const createdBackupIds: number[] = [];
const createdRestoreTestIds: number[] = [];
const createdFiles: string[] = [];
const createdOffsiteUris: string[] = [];

afterAll(async () => {
  // Remove offsite copies created by this suite.
  const { objectStorageClient } = await import("../lib/backupOffsite");
  for (const uri of createdOffsiteUris) {
    const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (!m) continue;
    await objectStorageClient
      .bucket(m[1])
      .file(m[2])
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
  }
  if (createdRestoreTestIds.length) {
    await db
      .delete(restoreTestResultsTable)
      .where(inArray(restoreTestResultsTable.id, createdRestoreTestIds));
  }
  if (createdBackupIds.length) {
    await db
      .delete(backupRecordsTable)
      .where(inArray(backupRecordsTable.id, createdBackupIds));
  }
  for (const f of createdFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
});

describe("real backup execution", () => {
  it("POST /admin/backup-records/run performs a pg_dump and records size, checksum, duration", async () => {
    const res = await request(app)
      .post("/api/admin/backup-records/run")
      .send({ backupType: "full", notes: "integration test backup" });

    expect(res.status).toBe(201);
    const record = res.body;
    createdBackupIds.push(record.id);
    if (record.storageLocation) createdFiles.push(record.storageLocation);

    expect(record.status).toBe("completed");
    expect(record.fileSizeBytes).toBeGreaterThan(0);
    expect(record.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(record.storageLocation).toBeTruthy();
    expect(fs.existsSync(record.storageLocation)).toBe(true);
    expect(new Date(record.completedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(record.startedAt).getTime()
    );

    // Offsite copy: record stores both locations.
    expect(record.offsiteStatus).toBe("uploaded");
    expect(record.offsiteLocation).toMatch(/^gs:\/\/.+\/backups\/.+\.dump$/);
    expect(record.offsiteUploadedAt).toBeTruthy();
    expect(record.offsiteError).toBeNull();
    createdOffsiteUris.push(record.offsiteLocation);
  }, 120_000);
});

describe("offsite disaster recovery", () => {
  it("restore test pulls the archive back from offsite when the local file is missing", async () => {
    // 1. Take a backup (uploads offsite).
    const backupRes = await request(app)
      .post("/api/admin/backup-records/run")
      .send({ backupType: "full", notes: "offsite DR test backup" });
    expect(backupRes.status).toBe(201);
    const record = backupRes.body;
    createdBackupIds.push(record.id);
    if (record.storageLocation) createdFiles.push(record.storageLocation);
    if (record.offsiteLocation) createdOffsiteUris.push(record.offsiteLocation);
    expect(record.offsiteStatus).toBe("uploaded");

    // 2. Simulate a local disk loss.
    fs.unlinkSync(record.storageLocation);
    expect(fs.existsSync(record.storageLocation)).toBe(false);

    // 3. Restore test against that specific backup must recover the archive
    //    from offsite storage and pass.
    const res = await request(app)
      .post("/api/restore-tests")
      .send({ backupRecordId: record.id });
    expect(res.status).toBe(201);
    createdRestoreTestIds.push(res.body.id);
    expect(res.body.backupRecordId).toBe(record.id);
    expect(res.body.result).toBe("pass");
    // The archive was re-downloaded to the original local path.
    expect(fs.existsSync(record.storageLocation)).toBe(true);
  }, 180_000);
});

describe("real restore test", () => {
  it("POST /restore-tests restores into a scratch DB and verifies row counts", async () => {
    const res = await request(app).post("/api/restore-tests").send({});
    expect(res.status).toBe(201);
    const rt = res.body;
    createdRestoreTestIds.push(rt.id);
    if (rt.backupRecord?.id && !createdBackupIds.includes(rt.backupRecord.id)) {
      createdBackupIds.push(rt.backupRecord.id);
      if (rt.backupRecord.storageLocation) createdFiles.push(rt.backupRecord.storageLocation);
    }

    expect(rt.result).toBe("pass");
    expect(rt.backupRecordId).toBeTruthy();
    expect(rt.restoreDurationSeconds).toBeGreaterThan(0);

    const checks = JSON.parse(rt.verificationChecksJson);
    expect(checks.length).toBeGreaterThanOrEqual(5);
    expect(checks.every((c: any) => c.status === "pass")).toBe(true);
    expect(checks.map((c: any) => c.check)).toContain("pg_restore_completed");

    const counts = JSON.parse(rt.rowCountsJson);
    expect(counts.source.employees).toBe(counts.restored.employees);
    expect(counts.source.leave_requests).toBe(counts.restored.leave_requests);
    expect(counts.source.payroll_runs).toBe(counts.restored.payroll_runs);

    // Backup gets verified by a passing restore test
    const [backup] = await db
      .select()
      .from(backupRecordsTable)
      .where(eq(backupRecordsTable.id, rt.backupRecordId));
    expect(backup.isVerified).toBe(true);
    expect(backup.restoreTestResult).toBe("restored_ok");
  }, 120_000);

  it("DATA_RESTORE_TESTED and DATA_BACKUP_VERIFIED gates pass after evaluation", async () => {
    const res = await request(app).post("/api/go-live-gates/evaluate").send({});
    expect(res.status).toBe(200);
    const byCode: Record<string, any> = {};
    for (const g of res.body.gates) byCode[g.gateCode] = g;
    expect(byCode["DATA_RESTORE_TESTED"].status).toBe("pass");
    expect(byCode["DATA_BACKUP_VERIFIED"].status).toBe("pass");
  }, 60_000);
});
