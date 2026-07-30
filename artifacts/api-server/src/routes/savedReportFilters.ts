import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, savedReportFiltersTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const { reportDefinitionId, userId } = req.query as Record<string, string>;
    const conditions = [];
    if (reportDefinitionId) conditions.push(eq(savedReportFiltersTable.reportDefinitionId, parseInt(reportDefinitionId)));
    if (userId) conditions.push(eq(savedReportFiltersTable.userId, parseInt(userId)));
    const rows = conditions.length > 0
      ? await db.select().from(savedReportFiltersTable).where(and(...conditions))
      : await db.select().from(savedReportFiltersTable);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(savedReportFiltersTable).values(req.body).returning();
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(savedReportFiltersTable)
      .where(eq(savedReportFiltersTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(savedReportFiltersTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(savedReportFiltersTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /:id — delete
router.delete("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.delete(savedReportFiltersTable)
      .where(eq(savedReportFiltersTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ deleted: true, id: row.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
