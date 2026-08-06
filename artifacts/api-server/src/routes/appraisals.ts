import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, appraisalCyclesTable, appraisalRecordsTable, appraisalCompetencyRatingsTable, calibrationSessionsTable, auditLogsTable } from "@workspace/db";

// Appraisal Cycles Router
const appraisalCyclesRouter = Router();

appraisalCyclesRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(appraisalCyclesTable);
    const rows = await db.select().from(appraisalCyclesTable)
      .orderBy(desc(appraisalCyclesTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalCyclesRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(appraisalCyclesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "appraisal_cycle", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalCyclesRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(appraisalCyclesTable).where(eq(appraisalCyclesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalCyclesRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(appraisalCyclesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(appraisalCyclesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "appraisal_cycle", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Appraisal Records Router
const appraisalRecordsRouter = Router();

appraisalRecordsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(appraisalRecordsTable);
    const rows = await db.select().from(appraisalRecordsTable)
      .orderBy(desc(appraisalRecordsTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalRecordsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(appraisalRecordsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "appraisal_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalRecordsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(appraisalRecordsTable).where(eq(appraisalRecordsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalRecordsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(appraisalRecordsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(appraisalRecordsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "appraisal_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalRecordsRouter.get("/:id/competency-ratings", async (req, res): Promise<void> => {
  try {
    const appraisalId = parseInt(req.params.id);
    const rows = await db.select().from(appraisalCompetencyRatingsTable)
      .where(eq(appraisalCompetencyRatingsTable.appraisalId, appraisalId));
    res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

appraisalRecordsRouter.post("/:id/competency-ratings", async (req, res): Promise<void> => {
  try {
    const appraisalId = parseInt(req.params.id);
    const [row] = await db.insert(appraisalCompetencyRatingsTable).values({ ...req.body, appraisalId }).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "appraisal_competency_rating", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Calibration Sessions Router
const calibrationSessionsRouter = Router();

calibrationSessionsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { cycleId, departmentId } = req.query as Record<string, string>;

    const conditions = [];
    if (cycleId) conditions.push(eq(calibrationSessionsTable.cycleId, parseInt(cycleId)));
    if (departmentId) conditions.push(eq(calibrationSessionsTable.departmentId, parseInt(departmentId)));

    const query = db.select().from(calibrationSessionsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(calibrationSessionsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(calibrationSessionsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(calibrationSessionsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

calibrationSessionsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(calibrationSessionsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "calibration_session", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

calibrationSessionsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(calibrationSessionsTable).where(eq(calibrationSessionsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

calibrationSessionsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(calibrationSessionsTable).set(req.body).where(eq(calibrationSessionsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "calibration_session", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export { appraisalCyclesRouter, appraisalRecordsRouter, calibrationSessionsRouter };
