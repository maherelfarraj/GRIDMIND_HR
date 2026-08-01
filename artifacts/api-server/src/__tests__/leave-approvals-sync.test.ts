/**
 * Task #13 — keep the /approvals queue entry linked to a leave request
 * (metadata.leave_request_id) in sync:
 *  - decide/cancel on the leave request updates the approvals entry
 *  - deciding the approvals entry advances the underlying leave request
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, approvalsTable, leaveRequestsTable, leaveApprovalStepsTable } from "@workspace/db";
import app from "../app";
import {
  createFixtures, cleanupFixtures, setBalance,
  TEST_EMPLOYEE_ID, TEST_YEAR, type TestFixtures,
} from "./helpers";

let f: TestFixtures;
const createdRequestIds: number[] = [];

async function createSubmittedRequest(startDate: string, endDate: string, totalDays: number) {
  const create = await request(app).post("/api/leave-requests").send({
    employeeId: TEST_EMPLOYEE_ID,
    leaveTypeId: f.annualTypeId,
    startDate, endDate, totalDays,
  });
  expect(create.status).toBe(201);
  const id: number = create.body.id;
  createdRequestIds.push(id);
  const submit = await request(app).post(`/api/leave-requests/${id}/submit`);
  expect(submit.status).toBe(200);
  return { id, steps: create.body.steps as Array<{ id: number; stepNumber: number }> };
}

async function linkedApproval(leaveRequestId: number) {
  const rows = await db.select().from(approvalsTable).where(eq(approvalsTable.type, "leave"));
  return rows.find(a => {
    try { return JSON.parse(a.metadata ?? "{}").leave_request_id === leaveRequestId; }
    catch { return false; }
  });
}

beforeAll(async () => {
  f = await createFixtures();
  await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "30");
});

afterAll(async () => {
  // Remove approvals rows created by submits in this file
  const rows = await db.select().from(approvalsTable).where(eq(approvalsTable.type, "leave"));
  const ids = rows.filter(a => {
    try { return createdRequestIds.includes(JSON.parse(a.metadata ?? "{}").leave_request_id); }
    catch { return false; }
  }).map(a => a.id);
  if (ids.length) await db.delete(approvalsTable).where(inArray(approvalsTable.id, ids));
  if (createdRequestIds.length) {
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, createdRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, createdRequestIds));
  }
  await cleanupFixtures(f);
});

describe("approvals queue stays in sync with leave decisions", () => {
  it("marks the approvals entry rejected when the leave request is rejected", async () => {
    const { id, steps } = await createSubmittedRequest(`${TEST_YEAR}-10-05`, `${TEST_YEAR}-10-06`, 2);
    const before = await linkedApproval(id);
    expect(before?.status).toBe("pending");

    const res = await request(app).post(`/api/leave-requests/${id}/decide`)
      .send({ stepId: steps[0].id, decision: "rejected", notes: "no coverage" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");

    const after = await linkedApproval(id);
    expect(after?.status).toBe("rejected");
    expect(after?.decidedAt).not.toBeNull();
  });

  it("marks the approvals entry approved when the final step is approved", async () => {
    const { id, steps } = await createSubmittedRequest(`${TEST_YEAR}-10-12`, `${TEST_YEAR}-10-13`, 2);

    const s1 = await request(app).post(`/api/leave-requests/${id}/decide`)
      .send({ stepId: steps[0].id, decision: "approved" });
    expect(s1.status).toBe(200);
    expect(s1.body.status).toBe("under_review");
    // Not final yet — approvals entry still pending
    expect((await linkedApproval(id))?.status).toBe("pending");

    const s2 = await request(app).post(`/api/leave-requests/${id}/decide`)
      .send({ stepId: steps[1].id, decision: "approved" });
    expect(s2.status).toBe(200);
    expect(s2.body.status).toBe("approved");
    expect((await linkedApproval(id))?.status).toBe("approved");
  });

  it("marks the approvals entry cancelled when the leave request is cancelled", async () => {
    const { id } = await createSubmittedRequest(`${TEST_YEAR}-10-19`, `${TEST_YEAR}-10-20`, 2);

    const res = await request(app).post(`/api/leave-requests/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect((await linkedApproval(id))?.status).toBe("cancelled");
  });

  it("deciding the approvals entry advances the underlying leave request", async () => {
    const { id } = await createSubmittedRequest(`${TEST_YEAR}-10-26`, `${TEST_YEAR}-10-27`, 2);
    const approval = await linkedApproval(id);
    expect(approval).toBeDefined();

    // Approve from /approvals — advances step 1 → under_review, but the
    // queue entry must stay pending until the request is finally decided
    const d1 = await request(app).patch(`/api/approvals/${approval!.id}/decision`)
      .send({ status: "approved", decisionNote: "ok by manager" });
    expect(d1.status).toBe(200);
    expect(d1.body.status).toBe("pending");
    expect((await linkedApproval(id))?.status).toBe("pending");

    let [lr] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
    expect(lr.status).toBe("under_review");
    expect(lr.currentStepNumber).toBe(2);

    // Reject from /approvals at step 2 — request becomes rejected, entry rejected
    const d2 = await request(app).patch(`/api/approvals/${approval!.id}/decision`)
      .send({ status: "rejected", decisionNote: "denied" });
    expect(d2.status).toBe(200);
    expect(d2.body.status).toBe("rejected");

    [lr] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
    expect(lr.status).toBe("rejected");
    const finalEntry = await linkedApproval(id);
    expect(finalEntry?.status).toBe("rejected");
  });

  it("rejects deciding a leave approval whose request is no longer pending", async () => {
    const { id } = await createSubmittedRequest(`${TEST_YEAR}-11-02`, `${TEST_YEAR}-11-03`, 2);
    const approval = await linkedApproval(id);
    await request(app).post(`/api/leave-requests/${id}/cancel`);

    const res = await request(app).patch(`/api/approvals/${approval!.id}/decision`)
      .send({ status: "approved" });
    expect(res.status).toBe(400);
  });
});
