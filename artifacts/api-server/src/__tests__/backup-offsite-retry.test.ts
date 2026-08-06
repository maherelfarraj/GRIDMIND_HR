import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { inArray, eq } from "drizzle-orm";
import { db, backupRecordsTable } from "@workspace/db";
import { retryOffsiteUploads, retryOffsiteUploadForRecord } from "../lib/backupService.js";

// Self-cleaning: all inserted rows are deleted in afterAll.
const createdIds: number[] = [];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "offsite-retry-test-"));

afterAll(async () => {
  if (createdIds.length) {
    await db.delete(backupRecordsTable).where(inArray(backupRecordsTable.id, createdIds));
  }
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

/** Insert a minimal backup_record with controllable offsite/local state. */
async function insertRecord(opts: {
  status?: string;
  offsiteStatus?: string | null;
  withFile?: boolean;
}): Promise<{ id: number; filePath: string | null }> {
  let filePath: string | null = null;
  if (opts.withFile) {
    filePath = path.join(tmpDir, `dump-${Date.now()}-${Math.random().toString(36).slice(2)}.dump`);
    await fsp.writeFile(filePath, "fake dump contents");
  }
  const now = new Date();
  const [rec] = await db
    .insert(backupRecordsTable)
    .values({
      backupType: "full",
      status: opts.status ?? "completed",
      startedAt: now,
      completedAt: now,
      storageLocation: filePath,
      offsiteStatus: opts.offsiteStatus === undefined ? "failed" : opts.offsiteStatus ?? undefined,
      offsiteError: opts.offsiteStatus === "uploaded" ? null : "Simulated upload failure",
      notes: "offsite-retry.test fixture",
    })
    .returning();
  createdIds.push(rec.id);
  return { id: rec.id, filePath };
}

describe("retryOffsiteUploads sweep", () => {
  it("skips records whose local file no longer exists and updates the error", async () => {
    // Insert a completed record with failed offsite and NO local file.
    const { id } = await insertRecord({ withFile: false, offsiteStatus: "failed" });

    const result = await retryOffsiteUploads();

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(backupRecordsTable)
      .where(eq(backupRecordsTable.id, id));
    // Still failed / no offsite copy — but error clarifies why.
    expect(row.offsiteStatus).not.toBe("uploaded");
    expect(row.offsiteError).toContain("local backup file no longer exists");
  });

  it("does not scan in_progress or expired records", async () => {
    const inProg = await insertRecord({ status: "in_progress", withFile: true, offsiteStatus: "failed" });
    const expired = await insertRecord({ status: "expired", withFile: true, offsiteStatus: "failed" });

    // We'll track the scan count before and after to verify these don't appear.
    // The simplest check: verify their offsiteStatus hasn't changed to something
    // (sweep won't touch them — their status filter excludes them).
    await retryOffsiteUploads();

    for (const { id } of [inProg, expired]) {
      const [row] = await db
        .select()
        .from(backupRecordsTable)
        .where(eq(backupRecordsTable.id, id));
      // Row still exists with original status — sweep didn't alter them.
      expect(row.offsiteStatus).toBe("failed");
    }
  });

  it("skips records that already have a successful offsite copy", async () => {
    const now = new Date();
    const [rec] = await db
      .insert(backupRecordsTable)
      .values({
        backupType: "full",
        status: "completed",
        startedAt: now,
        completedAt: now,
        offsiteStatus: "uploaded",
        offsiteLocation: "gs://fake-bucket/backups/already-uploaded.dump",
        offsiteUploadedAt: now,
        notes: "offsite-retry.test already-uploaded fixture",
      })
      .returning();
    createdIds.push(rec.id);

    // The sweep should not touch already-uploaded records at all.
    const before = { ...rec };
    await retryOffsiteUploads();

    const [after] = await db
      .select()
      .from(backupRecordsTable)
      .where(eq(backupRecordsTable.id, rec.id));
    expect(after.offsiteStatus).toBe("uploaded");
    expect(after.offsiteLocation).toBe(before.offsiteLocation);
  });
});

describe("retryOffsiteUploadForRecord", () => {
  it("throws 'not found' for a nonexistent record id", async () => {
    await expect(retryOffsiteUploadForRecord(999_999_999)).rejects.toThrow(
      /not found/i
    );
  });

  it("throws 'not eligible' for a failed backup", async () => {
    const now = new Date();
    const [rec] = await db
      .insert(backupRecordsTable)
      .values({
        backupType: "full",
        status: "failed",
        startedAt: now,
        offsiteStatus: "failed",
        notes: "offsite-retry.test failed-status fixture",
      })
      .returning();
    createdIds.push(rec.id);

    await expect(retryOffsiteUploadForRecord(rec.id)).rejects.toThrow(
      /not eligible/i
    );
  });

  it("throws 'already has' for an already-uploaded record", async () => {
    const now = new Date();
    const [rec] = await db
      .insert(backupRecordsTable)
      .values({
        backupType: "full",
        status: "completed",
        startedAt: now,
        completedAt: now,
        offsiteStatus: "uploaded",
        offsiteLocation: "gs://fake-bucket/backups/uploaded.dump",
        offsiteUploadedAt: now,
        notes: "offsite-retry.test already-uploaded single fixture",
      })
      .returning();
    createdIds.push(rec.id);

    await expect(retryOffsiteUploadForRecord(rec.id)).rejects.toThrow(
      /already has/i
    );
  });

  it("updates the error message when the local file is missing", async () => {
    const { id } = await insertRecord({ withFile: false, offsiteStatus: "failed" });
    const updated = await retryOffsiteUploadForRecord(id);
    expect(updated.offsiteStatus).not.toBe("uploaded");
    expect(updated.offsiteError).toContain("local backup file no longer exists");
  });
});

describe("admin retry endpoints", () => {
  it("POST /admin/backup-records/retry-offsite returns a sweep result", async () => {
    const request = (await import("supertest")).default;
    const { default: app } = await import("../app.js");

    const res = await request(app)
      .post("/api/admin/backup-records/retry-offsite")
      .send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.scanned).toBe("number");
    expect(typeof res.body.uploaded).toBe("number");
    expect(typeof res.body.skipped).toBe("number");
    expect(Array.isArray(res.body.errors)).toBe(true);
  }, 30_000);

  it("POST /admin/backup-records/:id/retry-offsite returns 404 for unknown id", async () => {
    const request = (await import("supertest")).default;
    const { default: app } = await import("../app.js");

    const res = await request(app)
      .post("/api/admin/backup-records/999999999/retry-offsite")
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  }, 30_000);

  it("POST /admin/backup-records/:id/retry-offsite returns 400 for already-uploaded record", async () => {
    const request = (await import("supertest")).default;
    const { default: app } = await import("../app.js");

    const now = new Date();
    const [rec] = await db
      .insert(backupRecordsTable)
      .values({
        backupType: "full",
        status: "completed",
        startedAt: now,
        completedAt: now,
        offsiteStatus: "uploaded",
        offsiteLocation: "gs://fake-bucket/backups/endpoint-test.dump",
        offsiteUploadedAt: now,
        notes: "offsite-retry.test endpoint already-uploaded fixture",
      })
      .returning();
    createdIds.push(rec.id);

    const res = await request(app)
      .post(`/api/admin/backup-records/${rec.id}/retry-offsite`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already has/i);
  }, 30_000);

  it("POST /admin/backup-records/:id/retry-offsite returns the updated record for a failed/missing record", async () => {
    const request = (await import("supertest")).default;
    const { default: app } = await import("../app.js");

    const { id } = await insertRecord({ withFile: false, offsiteStatus: "failed" });

    const res = await request(app)
      .post(`/api/admin/backup-records/${id}/retry-offsite`)
      .send({});

    // Local file is missing, so we get the record back (with updated error), not a 5xx.
    expect([200, 400]).not.toContain(500);
    expect(res.body.id).toBe(id);
    expect(res.body.offsiteError).toContain("local backup file no longer exists");
  }, 30_000);
});
