import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, desc } from "drizzle-orm";
import { db, restoreTestResultsTable, auditLogsTable } from "@workspace/db";
import { runRestoreTest } from "../lib/backupService.js";

const router = Router();

// ─── GET /restore-tests/latest — MUST come before /:id ────────────────────────
router.get("/restore-tests/latest", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(restoreTestResultsTable)
      .orderBy(desc(restoreTestResultsTable.testedAt));

    // Get latest per restore type
    const latestByType = new Map<string, any>();
    for (const row of rows) {
      if (!latestByType.has(row.restoreType)) {
        latestByType.set(row.restoreType, row);
      }
    }

    res.json({ latest: Array.from(latestByType.values()) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /restore-tests — list restore test results ───────────────────────────
router.get("/restore-tests", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(restoreTestResultsTable)
      .orderBy(desc(restoreTestResultsTable.testedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /restore-tests — run a REAL restore test ────────────────────────────
// Restores the latest (or specified) pg_dump backup into a scratch database,
// verifies row counts against the live source, then drops the scratch database.
router.post("/restore-tests", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const { backupRecordId, notes } = req.body ?? {};

    const outcome = await runRestoreTest({
      backupRecordId: backupRecordId ?? null,
      testedByUserId: actorUserId,
      notes: notes ?? null,
    });

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "restore_test_result",
      entityId: outcome.restoreTest.id,
      entityLabel: `Restore Test: full — ${outcome.result}`,
      actorUserId,
      changesJson: JSON.stringify({
        restoreType: "full",
        result: outcome.result,
        backupRecordId: outcome.backupRecord.id,
        durationSeconds: outcome.restoreTest.restoreDurationSeconds,
      }),
    });

    res.status(201).json({
      ...outcome.restoreTest,
      result: outcome.result,
      backupRecord: outcome.backupRecord,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /restore-tests/:id ────────────────────────────────────────────────────
router.get("/restore-tests/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db
      .select()
      .from(restoreTestResultsTable)
      .where(eq(restoreTestResultsTable.id, id));
    if (!row) return void res.status(404).json({ error: "Restore test result not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
