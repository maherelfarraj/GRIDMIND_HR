import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, jobOffersTable, auditLogsTable } from "@workspace/db";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { status, applicationId } = req.query as Record<string, string>;

    const conditions = [];
    if (status) conditions.push(eq(jobOffersTable.status, status));
    if (applicationId) conditions.push(eq(jobOffersTable.applicationId, parseInt(applicationId)));

    const query = db.select().from(jobOffersTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(jobOffersTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(jobOffersTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(jobOffersTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(jobOffersTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "job_offer", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(jobOffersTable).where(eq(jobOffersTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobOffersTable).set({ ...req.body, updatedAt: new Date() }).where(eq(jobOffersTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "job_offer", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/send", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobOffersTable)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(jobOffersTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "send", entityType: "job_offer", entityId: row.id, changesJson: JSON.stringify({ status: "sent" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/accept", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobOffersTable)
      .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobOffersTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "accept", entityType: "job_offer", entityId: row.id, changesJson: JSON.stringify({ status: "accepted" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/decline", async (req, res): Promise<void> => {
  try {
    const { reason } = req.body;
    const [row] = await db.update(jobOffersTable)
      .set({ status: "declined", declinedAt: new Date(), declineReason: reason, updatedAt: new Date() })
      .where(eq(jobOffersTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "decline", entityType: "job_offer", entityId: row.id, changesJson: JSON.stringify({ reason }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
