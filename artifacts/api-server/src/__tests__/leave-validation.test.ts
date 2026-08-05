/**
 * Validation tests — medical certificate gating and balance overdraw protection.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createFixtures, cleanupFixtures, setBalance, getBalance,
  TEST_EMPLOYEE_ID, TEST_ORG_ID, TEST_YEAR, type TestFixtures,
} from "./helpers";

// All API calls include the org context header so resolveOrgId returns org 1
// (the org that test employee 1 belongs to).
const ORG = { "X-Org-Id": String(TEST_ORG_ID) };

let f: TestFixtures;

beforeAll(async () => { f = await createFixtures(); });
afterAll(async () => { await cleanupFixtures(f); });

describe("medical certificate gating (sick leave)", () => {
  it("submitting sick leave without a certificate returns 422 ATTACHMENT_REQUIRED", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.sickTypeId, TEST_YEAR, "15");
    const created = await request(app).post("/api/leave-requests").set(ORG).send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.sickTypeId,
      startDate: `${TEST_YEAR}-11-02`, endDate: `${TEST_YEAR}-11-03`, totalDays: 2,
    });
    expect(created.status).toBe(201);
    f.createdRequestIds.push(created.body.id);

    const res = await request(app).post(`/api/leave-requests/${created.body.id}/submit`).set(ORG).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ATTACHMENT_REQUIRED");

    // Nothing reserved on a failed submit
    const bal = await getBalance(TEST_EMPLOYEE_ID, f.sickTypeId, TEST_YEAR);
    expect(parseFloat(bal.pending)).toBeCloseTo(0);
  });

  it("submitting sick leave with a certificate attached succeeds", async () => {
    const created = await request(app).post("/api/leave-requests").set(ORG).send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.sickTypeId,
      startDate: `${TEST_YEAR}-11-09`, endDate: `${TEST_YEAR}-11-10`, totalDays: 2,
    });
    f.createdRequestIds.push(created.body.id);

    const att = await request(app).post(`/api/leave-requests/${created.body.id}/attachments`).set(ORG).send({
      fileName: "medical-certificate.pdf", fileType: "application/pdf", fileSize: 1024,
    });
    expect(att.status).toBe(201);

    const res = await request(app).post(`/api/leave-requests/${created.body.id}/submit`).set(ORG).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");
  });
});

describe("balance overdraw protection", () => {
  it("rejects a request exceeding available balance with 422", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "5");
    const created = await request(app).post("/api/leave-requests").set(ORG).send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-11-16`, endDate: `${TEST_YEAR}-11-22`, totalDays: 7,
    });
    f.createdRequestIds.push(created.body.id);

    const res = await request(app).post(`/api/leave-requests/${created.body.id}/submit`).set(ORG).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Insufficient/i);
  });

  it("pending reservations count against availability — a second request cannot overdraw", async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "5");

    const first = await request(app).post("/api/leave-requests").set(ORG).send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-12-01`, endDate: `${TEST_YEAR}-12-04`, totalDays: 4,
    });
    f.createdRequestIds.push(first.body.id);
    const firstSubmit = await request(app).post(`/api/leave-requests/${first.body.id}/submit`).set(ORG).send({});
    expect(firstSubmit.status).toBe(200);

    const second = await request(app).post("/api/leave-requests").set(ORG).send({
      employeeId: TEST_EMPLOYEE_ID, leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-12-07`, endDate: `${TEST_YEAR}-12-10`, totalDays: 4,
    });
    f.createdRequestIds.push(second.body.id);
    const secondSubmit = await request(app).post(`/api/leave-requests/${second.body.id}/submit`).set(ORG).send({});
    expect(secondSubmit.status).toBe(422);

    const bal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR);
    expect(parseFloat(bal.pending)).toBeCloseTo(4); // only the first reservation
  });
});
