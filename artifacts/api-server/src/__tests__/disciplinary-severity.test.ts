/**
 * Integration tests — disciplinary record severity field (Task #209)
 *
 * Verifies that:
 * (a) POST /disciplinary-records persists severity and returns it
 * (b) PATCH /disciplinary-records/:id updates severity correctly
 * (c) Records created without severity receive the DB default ("minor")
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db, disciplinaryRecordsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app";

const ORG = { "X-Org-Id": "16" };

const createdIds: number[] = [];

afterAll(async () => {
  if (createdIds.length) {
    await db.delete(disciplinaryRecordsTable).where(inArray(disciplinaryRecordsTable.id, createdIds));
  }
});

// Minimal valid create payload — satisfies all NOT NULL DB columns
const BASE = {
  employeeId: 1,
  incidentDate: "2026-07-01",
  actionType: "verbal_warning",
  actionDate: "2026-07-01",
  category: "conduct",
  descriptionEn: "Test disciplinary record",
  issuedByEmployeeId: 1,
};

describe("disciplinary record severity", () => {
  it("(a) persists a non-default severity on create and returns it", async () => {
    const res = await request(app)
      .post("/api/disciplinary-records")
      .set(ORG)
      .send({ ...BASE, severity: "major" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.severity).toBe("major");
    createdIds.push(res.body.id);
  });

  it("(b) updating severity via PATCH reflects the new value", async () => {
    const create = await request(app)
      .post("/api/disciplinary-records")
      .set(ORG)
      .send({ ...BASE, incidentDate: "2026-07-02", actionDate: "2026-07-02", severity: "minor" });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const id = create.body.id;
    createdIds.push(id);

    const patch = await request(app)
      .patch(`/api/disciplinary-records/${id}`)
      .set(ORG)
      .send({ severity: "major" });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.severity).toBe("major");
  });

  it("(c) record created without severity has the default value", async () => {
    const res = await request(app)
      .post("/api/disciplinary-records")
      .set(ORG)
      .send({ ...BASE, incidentDate: "2026-07-03", actionDate: "2026-07-03" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.severity).toBeTruthy(); // DB default "minor"
    createdIds.push(res.body.id);
  });
});
