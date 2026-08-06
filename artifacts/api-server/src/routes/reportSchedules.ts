import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, and } from "drizzle-orm";
import { db, reportSchedulesTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const { reportDefinitionId, isActive } = req.query as Record<string, string>;
    const conditions = [];
    if (reportDefinitionId) conditions.push(eq(reportSchedulesTable.reportDefinitionId, parseInt(reportDefinitionId)));
    if (isActive !== undefined) conditions.push(eq(reportSchedulesTable.isActive, isActive === "true"));
    const rows = conditions.length > 0
      ? await db.select().from(reportSchedulesTable).where(and(...conditions))
      : await db.select().from(reportSchedulesTable);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(reportSchedulesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "report_schedule", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update (toggle isActive)
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(reportSchedulesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(reportSchedulesTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "report_schedule", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
