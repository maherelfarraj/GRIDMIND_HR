import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc } from "drizzle-orm";
import { db, interviewScoresTable, auditLogsTable } from "@workspace/db";

// Nested router: mounted at /applications/:appId/interview-scores
const nestedRouter = Router({ mergeParams: true });

nestedRouter.get("/", async (req, res): Promise<void> => {
  try {
    const appId = parseInt((req.params as any).appId);
    const rows = await db.select().from(interviewScoresTable)
      .where(eq(interviewScoresTable.applicationId, appId))
      .orderBy(desc(interviewScoresTable.createdAt));
    res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

nestedRouter.post("/", async (req, res): Promise<void> => {
  try {
    const appId = parseInt((req.params as any).appId);
    const [row] = await db.insert(interviewScoresTable).values({ ...req.body, applicationId: appId }).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "interview_score", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Flat router: mounted at /interview-scores
const flatRouter = Router();

flatRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(interviewScoresTable).set({ ...req.body, updatedAt: new Date() }).where(eq(interviewScoresTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "interview_score", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export const nestedInterviewScoresRouter = nestedRouter;
export const interviewScoresRouter = flatRouter;
