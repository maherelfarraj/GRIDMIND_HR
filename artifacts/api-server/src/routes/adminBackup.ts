import { Router } from "express";
import { db, backupRecordsTable, auditLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { runBackup } from "../lib/backupService.js";

const router = Router();

// GET /admin/backup — latest backup summary (used by pilot control center)
router.get("/admin/backup", async (req, res): Promise<void> => {
  const [backup] = await db
    .select()
    .from(backupRecordsTable)
    .orderBy(desc(backupRecordsTable.startedAt))
    .limit(1);
  res.json({ backup: backup ?? null });
});

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

// POST /admin/backup-records/run — execute a REAL pg_dump backup
router.post("/admin/backup-records/run", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { backupType, notes } = req.body ?? {};

    const record = await runBackup({
      backupType: backupType ?? "full",
      initiatedByUserId: actorUserId,
      notes: notes ?? null,
    });

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "backup_record",
      entityId: record.id,
      entityLabel: `Backup: ${record.backupType} — ${record.status}`,
      actorUserId,
      changesJson: JSON.stringify({
        backupType: record.backupType,
        status: record.status,
        fileSizeBytes: record.fileSizeBytes,
        checksum: record.checksum,
        storageLocation: record.storageLocation,
      }),
    });

    if (record.status !== "completed") {
      res.status(500).json({ error: record.errorMessage ?? "Backup failed", record });
      return;
    }
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/backup-records — execute a real backup (legacy record-creation
// endpoint upgraded: this now runs pg_dump instead of just inserting a row).
router.post("/admin/backup-records", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { backupType, notes } = req.body ?? {};

    if (!backupType) {
      res.status(400).json({ error: "backupType is required" });
      return;
    }

    const record = await runBackup({
      backupType,
      initiatedByUserId: actorUserId,
      notes: notes ?? null,
    });

    if (record.status !== "completed") {
      res.status(500).json({ error: record.errorMessage ?? "Backup failed", record });
      return;
    }
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
