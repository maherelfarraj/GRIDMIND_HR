import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, goalCyclesTable, employeeGoalsTable, auditLogsTable } from "@workspace/db";

// Goal Cycles Router
const goalCyclesRouter = Router();

goalCyclesRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(goalCyclesTable);
    const rows = await db.select().from(goalCyclesTable)
      .orderBy(desc(goalCyclesTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

goalCyclesRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(goalCyclesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "goal_cycle", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

goalCyclesRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(goalCyclesTable).where(eq(goalCyclesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

goalCyclesRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(goalCyclesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(goalCyclesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "goal_cycle", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Employee Goals Router
const employeeGoalsRouter = Router();

employeeGoalsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { cycleId, employeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (cycleId) conditions.push(eq(employeeGoalsTable.cycleId, parseInt(cycleId)));
    if (employeeId) conditions.push(eq(employeeGoalsTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(employeeGoalsTable.status, status));

    const query = db.select().from(employeeGoalsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(employeeGoalsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(employeeGoalsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(employeeGoalsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeGoalsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(employeeGoalsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "employee_goal", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeGoalsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(employeeGoalsTable).where(eq(employeeGoalsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeGoalsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(employeeGoalsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(employeeGoalsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "employee_goal", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export { goalCyclesRouter, employeeGoalsRouter };
