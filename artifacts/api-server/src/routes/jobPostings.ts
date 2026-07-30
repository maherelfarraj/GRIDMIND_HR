import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, jobPostingsTable, auditLogsTable } from "@workspace/db";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { status, departmentId } = req.query as Record<string, string>;

    const conditions = [];
    if (status) conditions.push(eq(jobPostingsTable.status, status));
    if (departmentId) conditions.push(eq(jobPostingsTable.departmentId, parseInt(departmentId)));

    const query = db.select().from(jobPostingsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(jobPostingsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(jobPostingsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(jobPostingsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(jobPostingsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "job_posting", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(jobPostingsTable).where(eq(jobPostingsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobPostingsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(jobPostingsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "job_posting", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/publish", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobPostingsTable)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobPostingsTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "publish", entityType: "job_posting", entityId: row.id, changesJson: JSON.stringify({ status: "published" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/close", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobPostingsTable)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(jobPostingsTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "close", entityType: "job_posting", entityId: row.id, changesJson: JSON.stringify({ status: "closed" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
