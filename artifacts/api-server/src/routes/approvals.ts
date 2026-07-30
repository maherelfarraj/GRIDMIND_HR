import { Router } from "express";
import { db, approvalsTable, employeesTable, systemUsersTable, auditLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateApprovalBody, DecideApprovalBody, ListApprovalsQueryParams } from "@workspace/api-zod";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildApprovalResponse(a: typeof approvalsTable.$inferSelect) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, a.requestedByEmployeeId));
  let assignedUserName: string | null = null;
  if (a.assignedToUserId) {
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, a.assignedToUserId));
    if (user) assignedUserName = user.fullNameEn;
  }
  return {
    ...a,
    requestedByEmployeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
    assignedToUserName: assignedUserName,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/approvals", async (req, res): Promise<void> => {
  const parsed = ListApprovalsQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const conditions = [];
  if (q.status) conditions.push(eq(approvalsTable.status, q.status));
  if (q.type) conditions.push(eq(approvalsTable.type, q.type));
  if (q.assignedToUserId) conditions.push(eq(approvalsTable.assignedToUserId, q.assignedToUserId));

  const approvals = conditions.length > 0
    ? await db.select().from(approvalsTable).where(and(...conditions))
    : await db.select().from(approvalsTable);

  const emps = await db.select().from(employeesTable);
  const users = await db.select().from(systemUsersTable);
  const empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const result = approvals.map((a) => {
    const emp = empMap[a.requestedByEmployeeId];
    const user = a.assignedToUserId ? userMap[a.assignedToUserId] : null;
    return {
      ...a,
      requestedByEmployeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      assignedToUserName: user?.fullNameEn ?? null,
      decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    };
  });
  res.json(result);
});

router.post("/approvals", async (req, res): Promise<void> => {
  const parsed = CreateApprovalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [approval] = await db.insert(approvalsTable).values(parsed.data).returning();
  res.status(201).json(await buildApprovalResponse(approval));
});

router.get("/approvals/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [approval] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, id));
  if (!approval) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildApprovalResponse(approval));
});

router.patch("/approvals/:id/decision", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = DecideApprovalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [approval] = await db.update(approvalsTable)
    .set({ status: parsed.data.status, decisionNote: parsed.data.decisionNote ?? null, decidedAt: new Date() })
    .where(eq(approvalsTable.id, id))
    .returning();
  if (!approval) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(auditLogsTable).values({
    actorUserId: (req as any).session?.userId ?? null,
    action: `approval.${parsed.data.status}`,
    entityType: "approval",
    entityId: id,
    entityLabel: approval.titleEn,
    changesJson: JSON.stringify({ status: parsed.data.status }),
  });
  res.json(await buildApprovalResponse(approval));
});

export default router;
