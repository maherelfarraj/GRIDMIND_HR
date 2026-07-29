import { Router } from "express";
import { db, leaveDelegationsTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /leave-delegations?delegatorId=&delegateeId=&activeOnly=true
router.get("/leave-delegations", async (req, res): Promise<void> => {
  const { delegatorId, delegateeId, activeOnly } = req.query as Record<string, string>;
  const conditions = [];
  if (delegatorId) conditions.push(eq(leaveDelegationsTable.delegatorEmployeeId, parseInt(delegatorId, 10)));
  if (delegateeId) conditions.push(eq(leaveDelegationsTable.delegateeEmployeeId, parseInt(delegateeId, 10)));
  if (activeOnly === "true") conditions.push(eq(leaveDelegationsTable.isActive, true));

  const rows = conditions.length > 0
    ? await db.select().from(leaveDelegationsTable).where(and(...conditions))
    : await db.select().from(leaveDelegationsTable);

  const emps = await db.select().from(employeesTable);
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]));

  const enriched = rows.map(d => {
    const delegator = empMap[d.delegatorEmployeeId];
    const delegatee = empMap[d.delegateeEmployeeId];
    return {
      ...d,
      delegatorNameEn: delegator ? `${delegator.firstNameEn} ${delegator.lastNameEn}` : "Unknown",
      delegateeNameEn: delegatee ? `${delegatee.firstNameEn} ${delegatee.lastNameEn}` : "Unknown",
    };
  });
  res.json(enriched);
});

router.post("/leave-delegations", async (req, res): Promise<void> => {
  const { delegatorEmployeeId, delegateeEmployeeId, startDate, endDate, reason } = req.body;
  if (!delegatorEmployeeId || !delegateeEmployeeId || !startDate || !endDate) {
    res.status(400).json({ error: "delegatorEmployeeId, delegateeEmployeeId, startDate, endDate required" });
    return;
  }
  const [d] = await db.insert(leaveDelegationsTable).values({
    delegatorEmployeeId, delegateeEmployeeId, startDate, endDate,
    reason: reason ?? null,
    isActive: true,
  }).returning();
  res.status(201).json(d);
});

router.patch("/leave-delegations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { startDate, endDate, reason, isActive } = req.body;
  const [d] = await db.update(leaveDelegationsTable)
    .set({ startDate, endDate, reason, isActive })
    .where(eq(leaveDelegationsTable.id, id))
    .returning();
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  res.json(d);
});

router.delete("/leave-delegations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(leaveDelegationsTable).where(eq(leaveDelegationsTable.id, id));
  res.status(204).end();
});

export default router;
