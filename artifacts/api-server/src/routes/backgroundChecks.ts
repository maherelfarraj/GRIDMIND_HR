import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, backgroundChecksTable, auditLogsTable } from "@workspace/db";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { applicationId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (applicationId) conditions.push(eq(backgroundChecksTable.applicationId, parseInt(applicationId)));
    if (status) conditions.push(eq(backgroundChecksTable.status, status));

    const query = db.select().from(backgroundChecksTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(backgroundChecksTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(backgroundChecksTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(backgroundChecksTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(backgroundChecksTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "background_check", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(backgroundChecksTable).where(eq(backgroundChecksTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(backgroundChecksTable).set({ ...req.body, updatedAt: new Date() }).where(eq(backgroundChecksTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "background_check", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
