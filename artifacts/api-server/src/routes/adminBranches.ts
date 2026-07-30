import { Router } from "express";
import { db, branchServersTable, syncQueueTable, backupRecordsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// GET /admin/branch-servers
router.get("/admin/branch-servers", async (req, res): Promise<void> => {
  const rows = await db.select().from(branchServersTable).orderBy(desc(branchServersTable.registeredAt));
  res.json(rows);
});

// POST /admin/branch-servers
router.post("/admin/branch-servers", async (req, res): Promise<void> => {
  const { serverCode, nameEn, nameAr, ...rest } = req.body;

  if (!serverCode || !nameEn || !nameAr) {
    res.status(400).json({ error: "serverCode, nameEn, nameAr are required" });
    return;
  }

  const [row] = await db
    .insert(branchServersTable)
    .values({ serverCode, nameEn, nameAr, ...rest })
    .returning();

  res.status(201).json(row);
});

// GET /admin/branch-servers/:id
router.get("/admin/branch-servers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(branchServersTable).where(eq(branchServersTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Branch server not found" });
    return;
  }
  res.json(row);
});

// PATCH /admin/branch-servers/:id
router.patch("/admin/branch-servers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(branchServersTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(branchServersTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Branch server not found" });
    return;
  }
  res.json(row);
});

// GET /admin/sync-queue
router.get("/admin/sync-queue", async (req, res): Promise<void> => {
  const { status, targetServerCode } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(syncQueueTable.status, status));
  if (targetServerCode) conditions.push(eq(syncQueueTable.targetServerCode, targetServerCode));

  const rows = conditions.length
    ? await db.select().from(syncQueueTable).where(and(...conditions)).orderBy(desc(syncQueueTable.createdAt)).limit(200)
    : await db.select().from(syncQueueTable).orderBy(desc(syncQueueTable.createdAt)).limit(200);

  res.json(rows);
});

// POST /admin/sync-queue/:id/resolve
router.post("/admin/sync-queue/:id/resolve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { resolution, notes, resolvedByUserId } = req.body;

  const [row] = await db
    .update(syncQueueTable)
    .set({
      conflictResolution: resolution ?? null,
      conflictNotes: notes ?? null,
      status: "completed",
      resolvedAt: new Date(),
      resolvedByUserId: resolvedByUserId ? parseInt(resolvedByUserId, 10) : null,
      updatedAt: new Date(),
    })
    .where(eq(syncQueueTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Sync queue entry not found" });
    return;
  }
  res.json(row);
});

// GET /admin/sync-status
router.get("/admin/sync-status", async (req, res): Promise<void> => {
  const servers = await db.select().from(branchServersTable);
  const queueEntries = await db.select().from(syncQueueTable);

  const lastSyncAt = servers.reduce(
    (m, s) => (s.lastSyncAt && (!m || s.lastSyncAt > m) ? s.lastSyncAt : m),
    null as Date | null
  );

  res.json({
    totalServers: servers.length,
    onlineServers: servers.filter((s) => s.status === "active").length,
    offlineServers: servers.filter((s) => s.status === "offline").length,
    pendingEntries: queueEntries.filter((e) => e.status === "pending").length,
    conflictEntries: queueEntries.filter((e) => e.status === "conflict").length,
    failedEntries: queueEntries.filter((e) => e.status === "failed").length,
    lastSyncAt,
    servers,
  });
});

// GET /admin/dr-status
router.get("/admin/dr-status", async (req, res): Promise<void> => {
  const backups = await db
    .select()
    .from(backupRecordsTable)
    .orderBy(desc(backupRecordsTable.startedAt));

  const completed = backups.filter((b) => b.status === "completed" || b.status === "verified");
  const lastBackup = completed[0] ?? null;
  const lastVerified = backups.find((b) => b.status === "verified") ?? null;
  const lastTestedRestore = backups.find((b) => b.restoreTestResult !== "not_tested") ?? null;

  const rpoCurrent = lastBackup
    ? Math.round((Date.now() - new Date(lastBackup.startedAt).getTime()) / 3600000)
    : null;

  const alerts: string[] = [];
  if (!lastBackup) alerts.push("No completed backups found");
  if (rpoCurrent !== null && rpoCurrent > 24)
    alerts.push("RPO exceeded: last backup was " + rpoCurrent + "h ago");
  if (!lastVerified) alerts.push("No verified backups — run verification");
  if (!lastTestedRestore) alerts.push("No restore test performed — schedule a DR drill");

  const overallStatus =
    alerts.length === 0 ? "healthy" : alerts.length <= 1 ? "warning" : "critical";

  res.json({
    overallStatus,
    lastBackupAt: lastBackup?.startedAt ?? null,
    lastBackupStatus: lastBackup?.status ?? "none",
    lastVerifiedAt: lastVerified?.verifiedAt ?? null,
    lastRestoreTestAt: lastTestedRestore?.restoreTestedAt ?? null,
    lastRestoreTestResult: lastTestedRestore?.restoreTestResult ?? "not_tested",
    rpoCurrent,
    rpoTarget: 24,
    rtoTarget: 4,
    totalBackupSizeBytes: completed.reduce((s, b) => s + (b.fileSizeBytes ?? 0), 0),
    backupCount: completed.length,
    verifiedBackupCount: backups.filter((b) => b.status === "verified").length,
    alerts,
  });
});

export default router;
