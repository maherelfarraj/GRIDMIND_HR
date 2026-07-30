import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, deploymentEventsTable } from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const offset = (page - 1) * limit;
    const { eventType, outcome } = req.query as Record<string, string>;

    const conditions = [];
    if (eventType) conditions.push(eq(deploymentEventsTable.eventType, eventType));
    if (outcome) conditions.push(eq(deploymentEventsTable.outcome, outcome));

    const [{ count }] = conditions.length > 0
      ? await db.select({ count: sql<number>`count(*)` }).from(deploymentEventsTable).where(and(...conditions))
      : await db.select({ count: sql<number>`count(*)` }).from(deploymentEventsTable);

    const rows = conditions.length > 0
      ? await db.select().from(deploymentEventsTable).where(and(...conditions)).orderBy(desc(deploymentEventsTable.occurredAt)).limit(limit).offset(offset)
      : await db.select().from(deploymentEventsTable).orderBy(desc(deploymentEventsTable.occurredAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
