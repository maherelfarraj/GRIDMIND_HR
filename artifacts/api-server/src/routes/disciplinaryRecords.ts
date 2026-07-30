import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, disciplinaryRecordsTable, commendationRecordsTable, promotionRecommendationsTable, auditLogsTable } from "@workspace/db";

// Disciplinary Records Router
const disciplinaryRecordsRouter = Router();

disciplinaryRecordsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(disciplinaryRecordsTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(disciplinaryRecordsTable.status, status));

    const query = db.select().from(disciplinaryRecordsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(disciplinaryRecordsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(disciplinaryRecordsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(disciplinaryRecordsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

disciplinaryRecordsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(disciplinaryRecordsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "disciplinary_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

disciplinaryRecordsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(disciplinaryRecordsTable).where(eq(disciplinaryRecordsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

disciplinaryRecordsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(disciplinaryRecordsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(disciplinaryRecordsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "disciplinary_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Commendation Records Router
const commendationRecordsRouter = Router();

commendationRecordsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(commendationRecordsTable.employeeId, parseInt(employeeId)));

    const query = db.select().from(commendationRecordsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(commendationRecordsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(commendationRecordsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(commendationRecordsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

commendationRecordsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(commendationRecordsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "commendation_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

commendationRecordsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(commendationRecordsTable).where(eq(commendationRecordsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

commendationRecordsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(commendationRecordsTable).set(req.body).where(eq(commendationRecordsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "commendation_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Promotion Recommendations Router
const promotionRecommendationsRouter = Router();

promotionRecommendationsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(promotionRecommendationsTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(promotionRecommendationsTable.status, status));

    const query = db.select().from(promotionRecommendationsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(promotionRecommendationsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(promotionRecommendationsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(promotionRecommendationsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

promotionRecommendationsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(promotionRecommendationsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "promotion_recommendation", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

promotionRecommendationsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(promotionRecommendationsTable).where(eq(promotionRecommendationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

promotionRecommendationsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(promotionRecommendationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(promotionRecommendationsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "promotion_recommendation", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export { disciplinaryRecordsRouter, commendationRecordsRouter, promotionRecommendationsRouter };
