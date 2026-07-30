import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, successionPoolsTable, successionCandidatesTable, developmentPlansTable, developmentActivitiesTable, auditLogsTable } from "@workspace/db";

// Succession Pools Router
const successionPoolsRouter = Router();

successionPoolsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const [{ count }] = await db.select({ count: sql`count(*)` }).from(successionPoolsTable);
    const rows = await db.select().from(successionPoolsTable).orderBy(desc(successionPoolsTable.createdAt)).limit(limit).offset(offset);
    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

successionPoolsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(successionPoolsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "succession_pool", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

successionPoolsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(successionPoolsTable).where(eq(successionPoolsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

successionPoolsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(successionPoolsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(successionPoolsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "succession_pool", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Succession Candidates Router
const successionCandidatesRouter = Router();

successionCandidatesRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { poolId, employeeId, readinessLevel } = req.query as Record<string, string>;

    const conditions = [];
    if (poolId) conditions.push(eq(successionCandidatesTable.poolId, parseInt(poolId)));
    if (employeeId) conditions.push(eq(successionCandidatesTable.employeeId, parseInt(employeeId)));
    if (readinessLevel) conditions.push(eq(successionCandidatesTable.readinessLevel, readinessLevel));

    const query = db.select().from(successionCandidatesTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(successionCandidatesTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(successionCandidatesTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(successionCandidatesTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

successionCandidatesRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(successionCandidatesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "succession_candidate", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

successionCandidatesRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(successionCandidatesTable).where(eq(successionCandidatesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

successionCandidatesRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(successionCandidatesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(successionCandidatesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "succession_candidate", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Development Plans Router
const developmentPlansRouter = Router();

developmentPlansRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const [{ count }] = await db.select({ count: sql`count(*)` }).from(developmentPlansTable);
    const rows = await db.select().from(developmentPlansTable).orderBy(desc(developmentPlansTable.createdAt)).limit(limit).offset(offset);
    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

developmentPlansRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(developmentPlansTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "development_plan", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

developmentPlansRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(developmentPlansTable).where(eq(developmentPlansTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

developmentPlansRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(developmentPlansTable).set({ ...req.body, updatedAt: new Date() }).where(eq(developmentPlansTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "development_plan", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

developmentPlansRouter.get("/:id/activities", async (req, res): Promise<void> => {
  try {
    const planId = parseInt(req.params.id);
    const rows = await db.select().from(developmentActivitiesTable)
      .where(eq(developmentActivitiesTable.planId, planId))
      .orderBy(developmentActivitiesTable.sortOrder);
    res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

developmentPlansRouter.post("/:id/activities", async (req, res): Promise<void> => {
  try {
    const planId = parseInt(req.params.id);
    const [row] = await db.insert(developmentActivitiesTable).values({ ...req.body, planId }).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "development_activity", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Development Activities Router (flat — PATCH only)
const developmentActivitiesRouter = Router();

developmentActivitiesRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(developmentActivitiesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(developmentActivitiesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "development_activity", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export { successionPoolsRouter, successionCandidatesRouter, developmentPlansRouter, developmentActivitiesRouter };
