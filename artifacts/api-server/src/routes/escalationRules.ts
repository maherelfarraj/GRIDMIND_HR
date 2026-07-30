import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, escalationRulesTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list all
router.get("/", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(escalationRulesTable);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(escalationRulesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "escalation_rule", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(escalationRulesTable)
      .where(eq(escalationRulesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update (toggle isActive)
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.update(escalationRulesTable)
      .set(req.body)
      .where(eq(escalationRulesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "escalation_rule", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
