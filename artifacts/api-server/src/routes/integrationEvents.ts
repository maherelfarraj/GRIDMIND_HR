import { Router } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, integrationEventLogTable } from "@workspace/db";

const router = Router();

// GET /integration-events — list (filter: connectorId, eventType, success, from, to), paginated
router.get("/integration-events", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const { connectorId, eventType, success, from, to } = req.query as Record<string, string>;
    const conditions = [];
    if (connectorId) conditions.push(eq(integrationEventLogTable.connectorId, parseInt(connectorId)));
    if (eventType) conditions.push(eq(integrationEventLogTable.eventType, eventType));
    if (success !== undefined) conditions.push(eq(integrationEventLogTable.success, success === "true"));
    if (from) conditions.push(gte(integrationEventLogTable.occurredAt, new Date(from)));
    if (to) conditions.push(lte(integrationEventLogTable.occurredAt, new Date(to)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count }] = whereClause
      ? await db.select({ count: sql<number>`count(*)` }).from(integrationEventLogTable).where(whereClause)
      : await db.select({ count: sql<number>`count(*)` }).from(integrationEventLogTable);

    const rows = whereClause
      ? await db.select().from(integrationEventLogTable).where(whereClause).orderBy(desc(integrationEventLogTable.occurredAt)).limit(limit).offset(offset)
      : await db.select().from(integrationEventLogTable).orderBy(desc(integrationEventLogTable.occurredAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /integration-events/:id — detail
router.get("/integration-events/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(integrationEventLogTable).where(eq(integrationEventLogTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
