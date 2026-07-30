import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, competencyFrameworksTable, competenciesTable, auditLogsTable } from "@workspace/db";

// Competency Frameworks Router
const frameworksRouter = Router();

frameworksRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(competencyFrameworksTable);
    const rows = await db.select().from(competencyFrameworksTable)
      .orderBy(desc(competencyFrameworksTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

frameworksRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(competencyFrameworksTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "competency_framework", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

frameworksRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(competencyFrameworksTable).where(eq(competencyFrameworksTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

frameworksRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(competencyFrameworksTable).set({ ...req.body, updatedAt: new Date() }).where(eq(competencyFrameworksTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "competency_framework", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

frameworksRouter.get("/:id/competencies", async (req, res): Promise<void> => {
  try {
    const frameworkId = parseInt(req.params.id);
    const rows = await db.select().from(competenciesTable)
      .where(eq(competenciesTable.frameworkId, frameworkId))
      .orderBy(competenciesTable.sortOrder);
    res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Competencies Router
const competenciesRouter = Router();

competenciesRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(competenciesTable);
    const rows = await db.select().from(competenciesTable)
      .orderBy(competenciesTable.sortOrder)
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

competenciesRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(competenciesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "competency", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

competenciesRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(competenciesTable).set(req.body).where(eq(competenciesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "competency", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export const competencyFrameworksRouter = frameworksRouter;
export { competenciesRouter };
