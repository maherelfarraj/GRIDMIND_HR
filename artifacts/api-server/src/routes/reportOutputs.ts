import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, reportOutputsTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { reportDefinitionId, status, generatedByUserId } = req.query as Record<string, string>;

    const conditions = [];
    if (reportDefinitionId) conditions.push(eq(reportOutputsTable.reportDefinitionId, parseInt(reportDefinitionId)));
    if (status) conditions.push(eq(reportOutputsTable.status, status));
    if (generatedByUserId) conditions.push(eq(reportOutputsTable.generatedByUserId, parseInt(generatedByUserId)));

    const [{ count }] = conditions.length > 0
      ? await db.select({ count: sql<number>`count(*)` }).from(reportOutputsTable).where(and(...conditions))
      : await db.select({ count: sql<number>`count(*)` }).from(reportOutputsTable);

    const rows = conditions.length > 0
      ? await db.select().from(reportOutputsTable).where(and(...conditions)).orderBy(desc(reportOutputsTable.createdAt)).limit(limit).offset(offset)
      : await db.select().from(reportOutputsTable).orderBy(desc(reportOutputsTable.createdAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get single
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(reportOutputsTable)
      .where(eq(reportOutputsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id/download — increment downloadCount, return storagePath + fileName
router.get("/:id/download", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(reportOutputsTable).where(eq(reportOutputsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(reportOutputsTable)
      .set({ downloadCount: (row.downloadCount ?? 0) + 1 })
      .where(eq(reportOutputsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "download", entityType: "report_output", entityId: id, changesJson: JSON.stringify({ storagePath: row.storagePath }) });

    res.json({ storagePath: updated.storagePath, fileName: updated.fileName });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
