import {
  db, leaveRequestsTable, leaveBalancesTable, leaveApprovalStepsTable,
  rostersTable, auditLogsTable, approvalsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, isNotNull, isNull } from "drizzle-orm";

export class LeaveDecisionError extends Error {
  httpStatus: number;
  code?: string;
  constructor(message: string, httpStatus: number, code?: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function rosterMarker(requestNumber: string): string {
  return `leave:${requestNumber}`;
}

/**
 * Keep the /approvals queue entry linked to a leave request in step with
 * the request's status. Uses the indexed entity_type/entity_id columns for
 * an O(1) lookup instead of scanning and JSON-parsing the whole table.
 * Falls back to metadata scanning for legacy rows that predate the columns.
 * Only touches entries that are not already in the target status.
 */
export async function syncLinkedApprovalStatus(
  leaveRequestId: number,
  status: "approved" | "rejected" | "cancelled" | "revoked",
  decisionNote?: string | null,
): Promise<void> {
  const setClause = {
    status,
    decidedAt: new Date(),
    ...(decisionNote !== undefined ? { decisionNote: decisionNote ?? null } : {}),
  };

  // Fast path: use the indexed entity link columns.
  await db.update(approvalsTable)
    .set(setClause)
    .where(and(
      eq(approvalsTable.entityType, "leave_request"),
      eq(approvalsTable.entityId, leaveRequestId),
    ));

  // Legacy fallback: rows written before the entity columns existed (entity_id
  // is NULL but the metadata JSON still carries leave_request_id).
  const legacy = await db.select().from(approvalsTable)
    .where(and(
      eq(approvalsTable.type, "leave"),
      isNotNull(approvalsTable.metadata),
      // entity_id is null means it was never backfilled
      isNull(approvalsTable.entityId),
    ));
  for (const a of legacy) {
    if (!a.metadata) continue;
    let meta: any;
    try { meta = JSON.parse(a.metadata); } catch { continue; }
    if (meta?.leave_request_id !== leaveRequestId) continue;
    if (a.status === status) continue;
    await db.update(approvalsTable)
      .set(setClause)
      .where(eq(approvalsTable.id, a.id));
  }
}

/**
 * For partial revokes: keep the approvals entry "approved" but update the
 * metadata dates and total_days to reflect the shortened range.
 */
export async function refreshLinkedApprovalMetadata(
  leaveRequestId: number,
  patch: { dates: string; total_days: string },
): Promise<void> {
  const candidates = await db.select().from(approvalsTable)
    .where(eq(approvalsTable.type, "leave"));
  for (const a of candidates) {
    if (!a.metadata) continue;
    let meta: any;
    try { meta = JSON.parse(a.metadata); } catch { continue; }
    if (meta?.leave_request_id !== leaveRequestId) continue;
    await db.update(approvalsTable)
      .set({
        metadata: JSON.stringify({ ...meta, ...patch }),
      })
      .where(eq(approvalsTable.id, a.id));
  }
}

export interface DecideLeaveStepInput {
  leaveRequestId: number;
  stepId?: number;
  stepNumber?: number;
  decision: string; // "approved" | "approve" | "rejected" | "reject"
  notes?: string | null;
  actorUserId: number;
}

/**
 * Core decision logic for a leave approval step: row-locked transaction,
 * balance updates, roster materialization on final approval, audit log,
 * and sync of the linked /approvals queue entry.
 * Throws LeaveDecisionError with httpStatus for expected failures.
 */
export async function decideLeaveStep(input: DecideLeaveStepInput) {
  const { leaveRequestId: id, stepId, stepNumber, decision, notes, actorUserId } = input;

  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) throw new LeaveDecisionError("Leave request not found", 404);
  if (!["submitted", "under_review"].includes(r.status)) {
    throw new LeaveDecisionError("Request is not pending a decision", 400);
  }

  // Accept stepId (preferred) or stepNumber (legacy); default to the current pending step
  let step: typeof leaveApprovalStepsTable.$inferSelect | undefined;
  if (stepId) {
    const rows = await db.select().from(leaveApprovalStepsTable).where(
      and(eq(leaveApprovalStepsTable.leaveRequestId, id), eq(leaveApprovalStepsTable.id, stepId))
    );
    step = rows[0];
  } else if (stepNumber !== undefined) {
    const rows = await db.select().from(leaveApprovalStepsTable).where(
      and(eq(leaveApprovalStepsTable.leaveRequestId, id), eq(leaveApprovalStepsTable.stepNumber, stepNumber))
    );
    step = rows[0];
  } else {
    const rows = await db.select().from(leaveApprovalStepsTable).where(
      and(eq(leaveApprovalStepsTable.leaveRequestId, id), eq(leaveApprovalStepsTable.status, "pending"))
    ).orderBy(leaveApprovalStepsTable.stepNumber);
    step = rows[0];
  }
  if (!step) throw new LeaveDecisionError("Approval step not found", 404);

  const isApprove = decision === "approved" || decision === "approve";
  const isReject = decision === "rejected" || decision === "reject";
  if (!isApprove && !isReject) {
    throw new LeaveDecisionError("decision must be 'approved' or 'rejected'", 400);
  }
  const normalizedDecision = isApprove ? "approved" : "rejected";

  // Atomic transaction with SELECT FOR UPDATE to prevent concurrent overdraw
  const updated = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.id, id))
      .for("update");
    if (!locked || !["submitted", "under_review"].includes(locked.status)) {
      throw new LeaveDecisionError("Request is no longer pending a decision", 409);
    }

    // Task #14: claim the approval step with a conditional update so two
    // simultaneous decisions cannot both process the same step.
    const [claimedStep] = await tx.update(leaveApprovalStepsTable)
      .set({ status: normalizedDecision, decision: normalizedDecision, notes: notes ?? null, decidedAt: new Date() })
      .where(and(
        eq(leaveApprovalStepsTable.id, step!.id),
        eq(leaveApprovalStepsTable.status, "pending"),
      ))
      .returning();
    if (!claimedStep) {
      throw new LeaveDecisionError("This approval step has already been decided", 409, "STEP_ALREADY_DECIDED");
    }

    let newStatus = locked.status;
    let newStep = locked.currentStepNumber;
    const year = new Date(r.startDate).getFullYear();
    const balanceWhere = and(
      eq(leaveBalancesTable.employeeId, locked.employeeId),
      eq(leaveBalancesTable.leaveTypeId, locked.leaveTypeId),
      eq(leaveBalancesTable.year, year),
    );

    const days = String(parseFloat(locked.totalDays));

    if (isReject) {
      newStatus = "rejected";
      // Atomic release of the pending reservation
      await tx.update(leaveBalancesTable)
        .set({
          pending: sql`GREATEST(${leaveBalancesTable.pending} - ${days}::numeric, 0)`,
          updatedAt: new Date(),
        })
        .where(balanceWhere);
    } else {
      if (step!.stepNumber >= locked.totalApprovalSteps) {
        newStatus = "approved";
        newStep = step!.stepNumber;
        const [bal] = await tx.select().from(leaveBalancesTable).where(balanceWhere);
        if (bal) {
          // Task #14: single atomic conditional update — deduct pending → used
          // only if it would not overdraw the entitlement.
          const [deducted] = await tx.update(leaveBalancesTable)
            .set({
              pending: sql`GREATEST(${leaveBalancesTable.pending} - ${days}::numeric, 0)`,
              used: sql`${leaveBalancesTable.used} + ${days}::numeric`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(leaveBalancesTable.id, bal.id),
              sql`${leaveBalancesTable.used} + ${days}::numeric <= ${leaveBalancesTable.openingBalance} + ${leaveBalancesTable.accrued} + ${leaveBalancesTable.carriedOver} + ${leaveBalancesTable.adjustment} + 0.000000001`,
            ))
            .returning();
          if (!deducted) {
            throw new LeaveDecisionError(
              "Insufficient leave balance: approving this request would overdraw the employee's balance",
              409, "BALANCE_CONFLICT",
            );
          }
        }

        // Mark roster days in the leave range as "leave".
        // Rows created here carry a marker note so a later revoke can remove them.
        const marker = rosterMarker(locked.requestNumber);
        const dates = datesInRange(locked.startDate, locked.endDate);
        const existing = await tx.select().from(rostersTable).where(
          and(
            eq(rostersTable.employeeId, locked.employeeId),
            gte(rostersTable.date, locked.startDate),
            lte(rostersTable.date, locked.endDate),
          )
        );
        const existingByDate = new Map(existing.map(row => [row.date, row]));
        for (const d of dates) {
          const row = existingByDate.get(d);
          if (row) {
            await tx.update(rostersTable)
              .set({ status: "leave", updatedAt: new Date() })
              .where(eq(rostersTable.id, row.id));
          } else {
            await tx.insert(rostersTable).values({
              employeeId: locked.employeeId, shiftId: null, date: d,
              status: "leave", notes: marker,
            });
          }
        }
      } else {
        newStatus = "under_review";
        newStep = step!.stepNumber + 1;
      }
    }

    const [row] = await tx.update(leaveRequestsTable)
      .set({
        status: newStatus,
        currentStepNumber: newStep,
        decidedAt: ["approved", "rejected"].includes(newStatus) ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(leaveRequestsTable.id, id))
      .returning();
    return row;
  });

  await db.insert(auditLogsTable).values({
    action: `leave.${normalizedDecision}`,
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    actorUserId,
    changesJson: JSON.stringify({ stepId: step.id, stepNumber: step.stepNumber, decision: normalizedDecision, notes }),
  });

  // Task #13: keep the /approvals queue entry in sync once the request is final
  if (updated.status === "approved" || updated.status === "rejected") {
    await syncLinkedApprovalStatus(id, updated.status, notes ?? undefined);
  }

  return { request: updated, step, normalizedDecision };
}
