/**
 * Body validation — unknown field rejection
 *
 * Proves that POST and PATCH handlers covered by validateBody() return 400
 * with a list of the unexpected keys rather than silently discarding them.
 *
 * Auth is disabled for the test suite via PILOT_AUTH=false (see vitest.config.ts).
 * No DB rows are created because the requests are rejected before the handler
 * runs its INSERT/UPDATE.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";

describe("validateBody middleware — unknown field rejection", () => {
  // ── Disciplinary records (POST create) ──────────────────────────────────
  it("rejects POST /api/disciplinary-records with an unrecognized field", async () => {
    const res = await request(app)
      .post("/api/disciplinary-records")
      .send({
        employeeId: 1,
        incidentDate: "2026-01-01",
        category: "misconduct",
        descriptionEn: "Test incident",
        typoField: "this key is not in the schema", // <-- unknown
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Request body contains unrecognized fields",
      unknownFields: expect.arrayContaining(["typoField"]),
    });
  });

  // ── Disciplinary records (PATCH update) ─────────────────────────────────
  it("rejects PATCH /api/disciplinary-records/:id with an unrecognized field", async () => {
    const res = await request(app)
      .patch("/api/disciplinary-records/999")
      .send({
        status: "resolved",
        misspeltKey: "oops", // <-- unknown
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Request body contains unrecognized fields",
      unknownFields: expect.arrayContaining(["misspeltKey"]),
    });
  });

  // ── Multiple unknown fields are all listed ──────────────────────────────
  it("lists all unrecognized fields when multiple are sent", async () => {
    const res = await request(app)
      .post("/api/training-programs")
      .send({
        nameEn: "Safety Course",
        unknownA: 1,
        unknownB: "bad",
      });

    expect(res.status).toBe(400);
    expect(res.body.unknownFields).toEqual(
      expect.arrayContaining(["unknownA", "unknownB"]),
    );
  });

  // ── Recruitment: applicants ──────────────────────────────────────────────
  it("rejects POST /api/applicants with an unrecognized field", async () => {
    const res = await request(app)
      .post("/api/applicants")
      .send({
        firstNameEn: "Jane",
        lastNameEn: "Doe",
        extraColumn: "not in spec", // <-- unknown
      });

    expect(res.status).toBe(400);
    expect(res.body.unknownFields).toEqual(
      expect.arrayContaining(["extraColumn"]),
    );
  });

  // ── Self-service: employee requests ─────────────────────────────────────
  it("rejects POST /api/employee-requests with an unrecognized field", async () => {
    const res = await request(app)
      .post("/api/employee-requests")
      .send({
        employeeId: 1,
        requestType: "equipment",
        ghostKey: "should not pass", // <-- unknown
      });

    expect(res.status).toBe(400);
    expect(res.body.unknownFields).toEqual(
      expect.arrayContaining(["ghostKey"]),
    );
  });

  // ── Reporting: report definitions ───────────────────────────────────────
  it("rejects POST /api/report-definitions with an unrecognized field", async () => {
    const res = await request(app)
      .post("/api/report-definitions")
      .send({
        nameEn: "Headcount",
        reportType: "employee",
        strayField: "not a real column", // <-- unknown
      });

    expect(res.status).toBe(400);
    expect(res.body.unknownFields).toEqual(
      expect.arrayContaining(["strayField"]),
    );
  });

  // ── Known fields only: request passes validation (may fail on DB constraints) ─
  it("passes validation when only known fields are sent to POST /api/disciplinary-records", async () => {
    const res = await request(app)
      .post("/api/disciplinary-records")
      .send({
        // Valid schema fields only — no unknown keys.
        // The request may fail with a DB FK error (employee 999999 doesn't
        // exist) but the important thing is it is NOT a 400 from the
        // validateBody middleware.
        employeeId: 999999,
        incidentDate: "2026-01-01",
        category: "misconduct",
        descriptionEn: "Test incident",
      });

    // Must not be rejected for unknown fields
    expect(res.status).not.toBe(400);
    expect(res.body.unknownFields).toBeUndefined();
  });
});
