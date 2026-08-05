import { Router } from "express";
import { db, approvalsTable, employeesTable, systemUsersTable, auditLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateApprovalBody, DecideApprovalBody, ListApprovalsQueryParams } from "@workspace/api-zod";
import { decideLeaveStep } from "../lib/leaveDecision.js";
import { requireActorPermission, ForbiddenError } from "../lib/permissions.js";

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
  // Deciding any queue item is a supervisory action: require approvals.decide
  // and attribute everything to the authenticated actor.
  let actor: Awaited<ReturnType<typeof requireActorPermission>>;
  try {
    actor = await requireActorPermission(req, "approvals.decide");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  const id = parseId(req.params.id);
  const parsed = DecideApprovalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Task #13: deciding a leave-type approval also advances the underlying
  // leave request's current approval step, so the two views never drift.
  if (["approved", "rejected"].includes(parsed.data.status)) {
    const [existing] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.type === "leave" && existing.metadata) {
      let leaveRequestId: number | undefined;
      try { leaveRequestId = JSON.parse(existing.metadata)?.leave_request_id; } catch { /* ignore */ }
      if (typeof leaveRequestId === "number") {
        try {
          const { request: leaveReq } = await decideLeaveStep({
            leaveRequestId,
            decision: parsed.data.status,
            notes: parsed.data.decisionNote ?? null,
            actorUserId: actor.userId,
          });
          if (!["approved", "rejected"].includes(leaveReq.status)) {
            // Intermediate step decided (request still under_review): keep the
            // queue entry pending so the next approver still sees it.
            const [pending] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, id));
            res.json(await buildApprovalResponse(pending));
            return;
          }
          // Terminal: persist the request's final status (decideLeaveStep already
          // synced it; fall through to record decisionNote/decidedAt uniformly).
          parsed.data.status = leaveReq.status;
        } catch (err: any) {
          if (err?.httpStatus) {
            res.status(err.httpStatus).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
            return;
          }
          throw err;
        }
      }
    }
  }

  const [approval] = await db.update(approvalsTable)
    .set({ status: parsed.data.status, decisionNote: parsed.data.decisionNote ?? null, decidedAt: new Date() })
    .where(eq(approvalsTable.id, id))
    .returning();
  if (!approval) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(auditLogsTable).values({
    actorUserId: actor.userId,
    action: `approval.${parsed.data.status}`,
    entityType: "approval",
    entityId: id,
    entityLabel: approval.titleEn,
    changesJson: JSON.stringify({ status: parsed.data.status }),
  });
  res.json(await buildApprovalResponse(approval));
});

export default router;
