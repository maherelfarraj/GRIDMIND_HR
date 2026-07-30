/**
 * Dual-authorization tests — separation of duties on sensitive actions
 * (e.g. security clearance changes) requires two distinct approvers.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, dualAuthRequestsTable } from "@workspace/db";
import app from "../app";

const createdIds: number[] = [];

afterAll(async () => {
  if (createdIds.length) {
    await db.delete(dualAuthRequestsTable).where(inArray(dualAuthRequestsTable.id, createdIds));
  }
});

describe("dual-auth workflow", () => {
  it("requires actionType, descriptionEn and initiator", async () => {
    const res = await request(app).post("/api/dual-auth").send({ actionType: "clearance_change" });
    expect(res.status).toBe(400);
  });

  it("enforces separation of duties: same user cannot approve both steps", async () => {
    const created = await request(app).post("/api/dual-auth").send({
      actionType: "clearance_change",
      targetEntityType: "security_clearance",
      descriptionEn: "TEST — upgrade clearance (integration test)",
      justification: "test",
      initiatedByUserId: 1,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    createdIds.push(created.body.id);
    const id = created.body.id;

    const first = await request(app).post(`/api/dual-auth/${id}/approve`).send({ approverUserId: 2 });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("first_approved");

    // Same approver again → rejected by separation-of-duties rule
    const sameAgain = await request(app).post(`/api/dual-auth/${id}/approve`).send({ approverUserId: 2 });
    expect(sameAgain.status).toBe(400);
    expect(sameAgain.body.error).toMatch(/Separation of duties/i);

    // Distinct second approver completes the request
    const second = await request(app).post(`/api/dual-auth/${id}/approve`).send({ approverUserId: 3 });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("approved");

    // No further approvals allowed
    const third = await request(app).post(`/api/dual-auth/${id}/approve`).send({ approverUserId: 4 });
    expect(third.status).toBe(400);
  });

  it("a rejected dual-auth request cannot be approved afterwards", async () => {
    const created = await request(app).post("/api/dual-auth").send({
      actionType: "clearance_change",
      descriptionEn: "TEST — to be rejected",
      initiatedByUserId: 1,
    });
    createdIds.push(created.body.id);

    const rej = await request(app).post(`/api/dual-auth/${created.body.id}/reject`)
      .send({ approverUserId: 2, notes: "test rejection" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("rejected");

    const approve = await request(app).post(`/api/dual-auth/${created.body.id}/approve`)
      .send({ approverUserId: 3 });
    expect(approve.status).toBe(400);
  });
});
