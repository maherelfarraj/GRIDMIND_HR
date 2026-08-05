/**
 * Authorization tests — leave request decide/revoke/cancel are limited to
 * roles holding the "approvals.decide" permission; employees may cancel
 * only their own requests; audit entries record the authenticated actor.
 *
 * Seeded users (demo mode accepts any password, sessions are still real):
 *   - fatima.zahrani → HR Manager (has approvals.decide), userId 2
 *   - hassan.qahtani → HR Clerk (no approvals.decide), userId 5, employeeId 7
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createFixtures, cleanupFixtures, setBalance, findAuditEntries,
  TEST_EMPLOYEE_ID, TEST_YEAR, type TestFixtures,
} from "./helpers";

const CLERK_EMPLOYEE_ID = 7; // hassan.qahtani's own employee record

let f: TestFixtures;

const hrManager = request.agent(app);
const clerk = request.agent(app);

async function createSubmitted(employeeId: number): Promise<number> {
  const create = await request(app).post("/api/leave-requests").send({
    employeeId, leaveTypeId: f.annualTypeId,
    startDate: `${TEST_YEAR}-10-05`, endDate: `${TEST_YEAR}-10-06`, totalDays: 2,
  });
  expect(create.status).toBe(201);
  f.createdRequestIds.push(create.body.id);
  const submit = await request(app).post(`/api/leave-requests/${create.body.id}/submit`);
  expect(submit.status).toBe(200);
  return create.body.id;
}

async function approveFully(id: number): Promise<void> {
  const get = await request(app).get(`/api/leave-requests/${id}`);
  for (const step of get.body.steps) {
    const res = await hrManager.post(`/api/leave-requests/${id}/decide`)
      .send({ stepId: step.id, decision: "approved" });
    expect(res.status).toBe(200);
  }
}

beforeAll(async () => {
  f = await createFixtures();
  await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "30");
  await setBalance(CLERK_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "30");
  const l1 = await hrManager.post("/api/auth/login").send({ username: "fatima.zahrani", password: "x" });
  expect(l1.status).toBe(200);
  const l2 = await clerk.post("/api/auth/login").send({ username: "hassan.qahtani", password: "x" });
  expect(l2.status).toBe(200);
});

afterAll(async () => {
  await cleanupFixtures(f);
});

describe("leave decide authorization", () => {
  it("rejects decide from a user without approvals.decide", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    const get = await request(app).get(`/api/leave-requests/${id}`);
    const res = await clerk.post(`/api/leave-requests/${id}/decide`)
      .send({ stepId: get.body.steps[0].id, decision: "approved" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("allows decide from a user with approvals.decide and audits the real actor", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    const get = await request(app).get(`/api/leave-requests/${id}`);
    const res = await hrManager.post(`/api/leave-requests/${id}/decide`)
      .send({ stepId: get.body.steps[0].id, decision: "approved" });
    expect(res.status).toBe(200);
    const audits = await findAuditEntries("leave.approved", id);
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[audits.length - 1].actorUserId).toBe(2); // fatima.zahrani
  });
});

describe("leave revoke authorization", () => {
  it("rejects revoke from a user without approvals.decide", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    await approveFully(id);
    const res = await clerk.post(`/api/leave-requests/${id}/revoke`)
      .send({ reason: "not allowed" });
    expect(res.status).toBe(403);
  });

  it("allows revoke for authorized users and attributes it to the session actor", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    await approveFully(id);
    const res = await hrManager.post(`/api/leave-requests/${id}/revoke`)
      .send({ reason: "operational need", revokedByEmployeeId: 999 });
    expect(res.status).toBe(200);
    const audits = await findAuditEntries("leave.revoked", id);
    expect(audits.length).toBe(1);
    expect(audits[0].actorUserId).toBe(2);
    // Client-supplied revokedByEmployeeId must be ignored.
    const changes = JSON.parse(audits[0].changesJson ?? "{}");
    expect(changes.revokedByEmployeeId).not.toBe(999);
  });
});

describe("approvals queue authorization (leave bypass)", () => {
  it("rejects a queue decision from a user without approvals.decide and leaves the request untouched", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    const approvals = await request(app).get("/api/approvals").query({ status: "pending", type: "leave" });
    const entry = approvals.body.find((a: any) => {
      try { return JSON.parse(a.metadata)?.leave_request_id === id; } catch { return false; }
    });
    expect(entry).toBeTruthy();
    const res = await clerk.patch(`/api/approvals/${entry.id}/decision`)
      .send({ status: "approved" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    const after = await request(app).get(`/api/leave-requests/${id}`);
    expect(["submitted", "under_review"]).toContain(after.body.status);
  });

  it("allows a queue decision from a user with approvals.decide", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    const approvals = await request(app).get("/api/approvals").query({ status: "pending", type: "leave" });
    const entry = approvals.body.find((a: any) => {
      try { return JSON.parse(a.metadata)?.leave_request_id === id; } catch { return false; }
    });
    expect(entry).toBeTruthy();
    const res = await hrManager.patch(`/api/approvals/${entry.id}/decision`)
      .send({ status: "approved" });
    expect(res.status).toBe(200);
  });
});

describe("leave cancel authorization", () => {
  it("rejects cancelling someone else's request without approvals.decide", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    const res = await clerk.post(`/api/leave-requests/${id}/cancel`);
    expect(res.status).toBe(403);
  });

  it("allows an employee to cancel their own request", async () => {
    const id = await createSubmitted(CLERK_EMPLOYEE_ID);
    const res = await clerk.post(`/api/leave-requests/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("allows a supervisor to cancel any pending request", async () => {
    const id = await createSubmitted(TEST_EMPLOYEE_ID);
    const res = await hrManager.post(`/api/leave-requests/${id}/cancel`);
    expect(res.status).toBe(200);
  });
});
