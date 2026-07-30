/**
 * Integration tests — leave request lifecycle:
 * create → submit (pending reserved) → approvals (balance deducted) →
 * revoke (balance restored + roster reverted).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, rostersTable } from "@workspace/db";
import app from "../app";
import {
  createFixtures, cleanupFixtures, cleanupTestRosters, setBalance, getBalance,
  findAuditEntries, TEST_EMPLOYEE_ID, TEST_YEAR, type TestFixtures,
} from "./helpers";

let f: TestFixtures;
const testRosterIds: number[] = [];

async function purgeTestRosterDates() {
  // Remove any roster rows (including leftovers from prior runs) on the
  // dedicated test dates for the test employee.
  await db.delete(rostersTable).where(and(
    eq(rostersTable.employeeId, TEST_EMPLOYEE_ID),
    inArray(rostersTable.date, [`${TEST_YEAR}-09-07`, `${TEST_YEAR}-09-08`]),
  ));
}

beforeAll(async () => {
  f = await createFixtures();
  await purgeTestRosterDates();
});

afterAll(async () => {
  if (testRosterIds.length) {
    await db.delete(rostersTable).where(inArray(rostersTable.id, testRosterIds));
  }
  await purgeTestRosterDates();
  await cleanupTestRosters(TEST_EMPLOYEE_ID, "TEST-ROSTER");
  await cleanupFixtures(f);
});

describe("leave request lifecycle", () => {
  let requestId: number;
  let steps: Array<{ id: number; stepNumber: number }>;

  it("creates a draft request and writes an audit entry", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "10");

    const res = await request(app).post("/api/leave-requests").send({
      employeeId: TEST_EMPLOYEE_ID,
      leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-09-07`,
      endDate: `${TEST_YEAR}-09-09`,
      totalDays: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.steps).toHaveLength(2);
    requestId = res.body.id;
    steps = res.body.steps;
    f.createdRequestIds.push(requestId);

    const audit = await findAuditEntries("leave.created", requestId);
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects required fields missing", async () => {
    const res = await request(app).post("/api/leave-requests").send({ employeeId: TEST_EMPLOYEE_ID });
    expect(res.status).toBe(400);
  });

  it("submit reserves days as pending and audits", async () => {
    const res = await request(app).post(`/api/leave-requests/${requestId}/submit`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.pending)).toBeCloseTo(3);
    expect(parseFloat(bal.used)).toBeCloseTo(0);

    const audit = await findAuditEntries("leave.submitted", requestId);
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("cannot submit a non-draft request", async () => {
    const res = await request(app).post(`/api/leave-requests/${requestId}/submit`).send({});
    expect(res.status).toBe(400);
  });

  it("first approval moves request to under_review without touching used", async () => {
    const step1 = steps.find(s => s.stepNumber === 1)!;
    const res = await request(app).post(`/api/leave-requests/${requestId}/decide`).send({
      stepId: step1.id, decision: "approved",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("under_review");

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.used)).toBeCloseTo(0);
    expect(parseFloat(bal.pending)).toBeCloseTo(3);
  });

  it("final approval deducts balance: pending → used", async () => {
    const step2 = steps.find(s => s.stepNumber === 2)!;
    const res = await request(app).post(`/api/leave-requests/${requestId}/decide`).send({
      stepId: step2.id, decision: "approved",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.used)).toBeCloseTo(3);
    expect(parseFloat(bal.pending)).toBeCloseTo(0);
  });

  it("deciding an already-decided request returns 400 and does not double-deduct", async () => {
    const step2 = steps.find(s => s.stepNumber === 2)!;
    const res = await request(app).post(`/api/leave-requests/${requestId}/decide`).send({
      stepId: step2.id, decision: "approved",
    });
    expect(res.status).toBe(400);

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.used)).toBeCloseTo(3);
  });

  it("revoke restores balance, reverts roster, and audits", async () => {
    // Roster rows marked as leave inside the request date range
    const inserted = await db.insert(rostersTable).values([
      { employeeId: TEST_EMPLOYEE_ID, date: `${TEST_YEAR}-09-07`, status: "leave", notes: "TEST-ROSTER" },
      { employeeId: TEST_EMPLOYEE_ID, date: `${TEST_YEAR}-09-08`, status: "leave", notes: "TEST-ROSTER" },
    ]).returning();
    testRosterIds.push(...inserted.map(r => r.id));

    const res = await request(app).post(`/api/leave-requests/${requestId}/revoke`).send({ reason: "test revoke" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.used)).toBeCloseTo(0);

    // Assert strictly on the rows this test created
    const rows = await db.select().from(rostersTable)
      .where(inArray(rostersTable.id, inserted.map(r => r.id)));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("scheduled");
      expect(row.notes ?? "").toContain("leave revoked");
    }

    const audit = await findAuditEntries("leave.revoked", requestId);
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("revoke on a non-approved request returns 400", async () => {
    const res = await request(app).post(`/api/leave-requests/${requestId}/revoke`).send({});
    expect(res.status).toBe(400);
  });
});

describe("rejection and cancellation release pending balance", () => {
  it("rejection releases reserved days", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "10");
    const created = await request(app).post("/api/leave-requests").send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-10-05`, endDate: `${TEST_YEAR}-10-06`, totalDays: 2,
    });
    f.createdRequestIds.push(created.body.id);
    await request(app).post(`/api/leave-requests/${created.body.id}/submit`).send({});

    const step1 = created.body.steps.find((s: any) => s.stepNumber === 1);
    const res = await request(app).post(`/api/leave-requests/${created.body.id}/decide`).send({
      stepId: step1.id, decision: "rejected", notes: "test",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.pending)).toBeCloseTo(0);
    expect(parseFloat(bal.used)).toBeCloseTo(0);
  });

  it("cancelling a submitted request releases reserved days", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "10");
    const created = await request(app).post("/api/leave-requests").send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-10-12`, endDate: `${TEST_YEAR}-10-13`, totalDays: 2,
    });
    f.createdRequestIds.push(created.body.id);
    await request(app).post(`/api/leave-requests/${created.body.id}/submit`).send({});

    const res = await request(app).post(`/api/leave-requests/${created.body.id}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.pending)).toBeCloseTo(0);
  });

  it("cannot cancel an already-decided request", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "10");
    const created = await request(app).post("/api/leave-requests").send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-10-19`, endDate: `${TEST_YEAR}-10-19`, totalDays: 1,
    });
    f.createdRequestIds.push(created.body.id);
    await request(app).post(`/api/leave-requests/${created.body.id}/submit`).send({});
    const step1 = created.body.steps.find((s: any) => s.stepNumber === 1);
    await request(app).post(`/api/leave-requests/${created.body.id}/decide`).send({ stepId: step1.id, decision: "rejected" });

    const res = await request(app).post(`/api/leave-requests/${created.body.id}/cancel`).send({});
    expect(res.status).toBe(400);
  });
});
