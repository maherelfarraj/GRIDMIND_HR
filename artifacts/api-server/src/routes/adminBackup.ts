import { Router } from "express";
import { db, backupRecordsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// GET /admin/backup-records
router.get("/admin/backup-records", async (req, res): Promise<void> => {
  const { status, backupType } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(backupRecordsTable.status, status));
  if (backupType) conditions.push(eq(backupRecordsTable.backupType, backupType));

  const rows = conditions.length
    ? await db.select().from(backupRecordsTable).where(and(...conditions)).orderBy(desc(backupRecordsTable.startedAt))
    : await db.select().from(backupRecordsTable).orderBy(desc(backupRecordsTable.startedAt));

  res.json(rows);
});

// POST /admin/backup-records
router.post("/admin/backup-records", async (req, res): Promise<void> => {
  const { backupType, startedAt, ...rest } = req.body;

  if (!backupType) {
    res.status(400).json({ error: "backupType is required" });
    return;
  }

  const [row] = await db
    .insert(backupRecordsTable)
    .values({
      backupType,
      status: rest.status ?? "in_progress",
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      ...rest,
    })
    .returning();

  res.status(201).json(row);
});

// POST /admin/backup-records/:id/verify
router.post("/admin/backup-records/:id/verify", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { verificationNotes, restoreTestResult } = req.body;

  const [row] = await db
    .update(backupRecordsTable)
    .set({
      isVerified: true,
      verifiedAt: new Date(),
      verificationNotes: verificationNotes ?? null,
      restoreTestResult: restoreTestResult ?? "restored_ok",
    })
    .where(eq(backupRecordsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Backup record not found" });
    return;
  }
  res.json(row);
});

export default router;
