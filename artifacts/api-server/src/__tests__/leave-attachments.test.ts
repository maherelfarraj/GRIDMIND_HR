/**
 * Regression tests for POST /leave-requests/:id/attachments hardening (Task #12):
 * (a) Attachments appear in the GET /leave-requests list response after POSTing one to a draft.
 * (b) POST attachments to a non-draft request returns 409.
 * (c) Unknown id returns 404.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createFixtures, cleanupFixtures, setBalance,
  TEST_EMPLOYEE_ID, TEST_ORG_ID, TEST_YEAR, type TestFixtures,
} from "./helpers";

const ORG = { "X-Org-Id": String(TEST_ORG_ID) };

let f: TestFixtures;

beforeAll(async () => { f = await createFixtures(); });
afterAll(async () => { await cleanupFixtures(f); });

describe("leave request attachments", () => {
  let draftId: number;

  beforeAll(async () => {
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, TEST_YEAR, "10");
    const res = await request(app).post("/api/leave-requests").set(ORG).send({
      employeeId: TEST_EMPLOYEE_ID,
      leaveTypeId: f.annualTypeId,
      startDate: `${TEST_YEAR}-08-04`,
      endDate: `${TEST_YEAR}-08-05`,
      totalDays: 2,
    });
    expect(res.status).toBe(201);
    draftId = res.body.id;
    f.createdRequestIds.push(draftId);
  });

  it("(c) unknown leave request id returns 404", async () => {
    const res = await request(app)
      .post("/api/leave-requests/999999999/attachments")
      .set(ORG)
      .send({ fileName: "doc.pdf" });
    expect(res.status).toBe(404);
  });

  it("(a) attachment appears in the GET /leave-requests list after POSTing to a draft", async () => {
    // Post an attachment to the draft
    const att = await request(app)
      .post(`/api/leave-requests/${draftId}/attachments`)
      .set(ORG)
      .send({ fileName: "medical-cert.pdf", fileType: "application/pdf", fileSize: 2048 });
    expect(att.status).toBe(201);
    expect(att.body.fileName).toBe("medical-cert.pdf");

    // The list endpoint should include the attachment for this request
    const list = await request(app)
      .get(`/api/leave-requests?status=draft`)
      .set(ORG);
    expect(list.status).toBe(200);
    const found = list.body.find((r: any) => r.id === draftId);
    expect(found).toBeDefined();
    expect(Array.isArray(found.attachments)).toBe(true);
    expect(found.attachments.length).toBeGreaterThanOrEqual(1);
    expect(found.attachments.some((a: any) => a.fileName === "medical-cert.pdf")).toBe(true);
  });

  it("(b) POST attachments to a submitted (non-draft) request returns 409", async () => {
    // Submit the request first
    const submit = await request(app)
      .post(`/api/leave-requests/${draftId}/submit`)
      .set(ORG)
      .send({});
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe("submitted");

    // Now attaching should be rejected
    const res = await request(app)
      .post(`/api/leave-requests/${draftId}/attachments`)
      .set(ORG)
      .send({ fileName: "late-doc.pdf" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/draft/i);
  });
});
