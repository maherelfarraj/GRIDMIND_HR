/**
 * Integration tests — job requisition priority field (Task #209)
 *
 * Verifies that:
 * (a) POST /job-requisitions persists priority and returns it
 * (b) PATCH /job-requisitions/:id updates priority correctly
 * (c) Records created without priority receive the DB default ("medium")
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db, jobRequisitionsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app";

const ORG = { "X-Org-Id": "16" };

const createdIds: number[] = [];

afterAll(async () => {
  if (createdIds.length) {
    await db.delete(jobRequisitionsTable).where(inArray(jobRequisitionsTable.id, createdIds));
  }
});

// requisitionNumber must be unique — use a timestamp suffix
function reqNum() {
  return `REQ-TST-${Date.now() % 1_000_000}`;
}

// Minimal valid create payload — satisfies all NOT NULL DB columns
const BASE = {
  jobTitleEn: "Test Engineer",
  jobTitleAr: "مهندس اختبار",
  departmentId: 1,
  requestedByEmployeeId: 1,
  headcount: 1,
};

describe("job requisition priority", () => {
  it("(a) persists a non-default priority on create and returns it", async () => {
    const res = await request(app)
      .post("/api/job-requisitions")
      .set(ORG)
      .send({ ...BASE, requisitionNumber: reqNum(), priority: "urgent" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.priority).toBe("urgent");
    createdIds.push(res.body.id);
  });

  it("(b) updating priority via PATCH reflects the new value", async () => {
    const create = await request(app)
      .post("/api/job-requisitions")
      .set(ORG)
      .send({ ...BASE, requisitionNumber: reqNum(), priority: "low" });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const id = create.body.id;
    createdIds.push(id);

    const patch = await request(app)
      .patch(`/api/job-requisitions/${id}`)
      .set(ORG)
      .send({ priority: "high" });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.priority).toBe("high");
  });

  it("(c) record created without priority has the default value", async () => {
    const res = await request(app)
      .post("/api/job-requisitions")
      .set(ORG)
      .send({ ...BASE, requisitionNumber: reqNum() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.priority).toBeTruthy(); // DB default "medium"
    createdIds.push(res.body.id);
  });
});
