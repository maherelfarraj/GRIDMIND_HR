import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, and, sql } from "drizzle-orm";
import { db, documentCategoriesTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list all active categories
router.get("/", async (req, res): Promise<void> => {
  try {
    const { organizationType } = req.query as Record<string, string>;
    const conditions = [eq(documentCategoriesTable.isActive, true)];
    if (organizationType) conditions.push(eq(documentCategoriesTable.organizationType, organizationType));
    const rows = await db.select().from(documentCategoriesTable)
      .where(and(...conditions))
      .orderBy(documentCategoriesTable.sortOrder);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create category
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(documentCategoriesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "document_category", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get one
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(documentCategoriesTable)
      .where(eq(documentCategoriesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(documentCategoriesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(documentCategoriesTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "document_category", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
