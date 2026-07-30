import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, employeeOnboardingTable, onboardingTasksTable, auditLogsTable } from "@workspace/db";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(employeeOnboardingTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(employeeOnboardingTable.status, status));

    const query = db.select().from(employeeOnboardingTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(employeeOnboardingTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(employeeOnboardingTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(employeeOnboardingTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(employeeOnboardingTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "employee_onboarding", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(employeeOnboardingTable).where(eq(employeeOnboardingTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(employeeOnboardingTable).set({ ...req.body, updatedAt: new Date() }).where(eq(employeeOnboardingTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "employee_onboarding", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id/tasks", async (req, res): Promise<void> => {
  try {
    const onboardingId = parseInt(req.params.id);
    const rows = await db.select().from(onboardingTasksTable)
      .where(eq(onboardingTasksTable.onboardingId, onboardingId))
      .orderBy(onboardingTasksTable.sortOrder);
    res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id/tasks/:taskId", async (req, res): Promise<void> => {
  try {
    const onboardingId = parseInt(req.params.id);
    const taskId = parseInt(req.params.taskId);

    const [task] = await db.update(onboardingTasksTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(onboardingTasksTable.id, taskId), eq(onboardingTasksTable.onboardingId, onboardingId)))
      .returning();
    if (!task) { res.status(404).json({ error: "Not found" }); return; }

    // Recalculate completion percentage on the parent onboarding record
    const allTasks = await db.select().from(onboardingTasksTable)
      .where(eq(onboardingTasksTable.onboardingId, onboardingId));
    const completedCount = allTasks.filter(t => t.status === "completed" || t.status === "skipped").length;
    const completionPct = allTasks.length > 0 ? Math.round((completedCount / allTasks.length) * 100) : 0;

    await db.update(employeeOnboardingTable)
      .set({ completionPct, updatedAt: new Date() })
      .where(eq(employeeOnboardingTable.id, onboardingId));

    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "onboarding_task", entityId: task.id, changesJson: JSON.stringify(req.body) });
    res.json(task);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
