import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, applicationsTable, auditLogsTable } from "@workspace/db";
import { CreateApplicationBody, UpdateApplicationBody } from "@workspace/api-zod";
import { validateBody } from "../middleware/validateBody.js";
import { nestedInterviewScoresRouter } from "./interviewScores.js";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { jobPostingId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (jobPostingId) conditions.push(eq(applicationsTable.jobPostingId, parseInt(jobPostingId)));
    if (status) conditions.push(eq(applicationsTable.status, status));

    const query = db.select().from(applicationsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(applicationsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(applicationsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(applicationsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", validateBody(CreateApplicationBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(applicationsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "application", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", validateBody(UpdateApplicationBody.partial()), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(applicationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(applicationsTable.id, parseInt(req.params.id as string))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "application", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/shortlist", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(applicationsTable)
      .set({ status: "shortlisted", updatedAt: new Date() })
      .where(eq(applicationsTable.id, parseInt(req.params.id as string)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "shortlist", entityType: "application", entityId: row.id, changesJson: JSON.stringify({ status: "shortlisted" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/reject", async (req, res): Promise<void> => {
  try {
    const { reason } = req.body;
    const [row] = await db.update(applicationsTable)
      .set({ status: "rejected", rejectionReason: reason, rejectedAt: new Date(), updatedAt: new Date() })
      .where(eq(applicationsTable.id, parseInt(req.params.id as string)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "reject", entityType: "application", entityId: row.id, changesJson: JSON.stringify({ reason }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Nested interview scores
router.use("/:appId/interview-scores", nestedInterviewScoresRouter);

export default router;
