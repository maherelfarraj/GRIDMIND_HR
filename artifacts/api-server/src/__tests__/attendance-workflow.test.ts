/**
 * Integration tests — attendance punch-in / punch-out / correction workflow.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, punchEventsTable, attendanceCorrectionsTable } from "@workspace/db";
import app from "../app";

const TEST_EMPLOYEE_ID = 1;
const createdPunchIds: number[] = [];
const createdCorrectionIds: number[] = [];

// Use a fixed ISO timestamp for today so query filter works.
const todayDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const clockInTime = `${todayDate}T08:00:00.000Z`;
const clockOutTime = `${todayDate}T16:00:00.000Z`;

afterAll(async () => {
  if (createdCorrectionIds.length) {
    await db.delete(attendanceCorrectionsTable)
      .where(inArray(attendanceCorrectionsTable.id, createdCorrectionIds));
  }
  if (createdPunchIds.length) {
    await db.delete(punchEventsTable)
      .where(inArray(punchEventsTable.id, createdPunchIds));
  }
});

describe("punch-in / punch-out workflow", () => {
  let clockInId: number;
  let clockOutId: number;

  it("POST /api/punch-events with CLOCK_IN returns 201", async () => {
    const res = await request(app)
      .post("/api/punch-events")
      .send({
        employeeId: TEST_EMPLOYEE_ID,
        eventType: "CLOCK_IN",
        eventTime: clockInTime,
        source: "MANUAL",
        notes: "TEST punch-in",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.eventType).toBe("CLOCK_IN");
    expect(res.body.employeeId).toBe(TEST_EMPLOYEE_ID);
    clockInId = res.body.id;
    createdPunchIds.push(clockInId);
  });

  it("POST /api/punch-events with CLOCK_OUT returns 201", async () => {
    const res = await request(app)
      .post("/api/punch-events")
      .send({
        employeeId: TEST_EMPLOYEE_ID,
        eventType: "CLOCK_OUT",
        eventTime: clockOutTime,
        source: "MANUAL",
        notes: "TEST punch-out",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.eventType).toBe("CLOCK_OUT");
    clockOutId = res.body.id;
    createdPunchIds.push(clockOutId);
  });

  it("GET /api/punch-events?employeeId=1 returns list including both events", async () => {
    const res = await request(app)
      .get(`/api/punch-events?employeeId=${TEST_EMPLOYEE_ID}&limit=200`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);

    const ids = res.body.data.map((e: any) => e.id);
    expect(ids).toContain(clockInId);
    expect(ids).toContain(clockOutId);
  });

  it("GET /api/punch-events/:id returns the individual clock-in event", async () => {
    const res = await request(app).get(`/api/punch-events/${clockInId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(clockInId);
    expect(res.body.eventType).toBe("CLOCK_IN");
  });

  it("GET /api/punch-events/missing returns an array", async () => {
    const res = await request(app).get("/api/punch-events/missing");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/attendance?date=&departmentId= filters on the server", async () => {
    const all = await request(app).get("/api/attendance?limit=50");
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body)).toBe(true);
    const sample = all.body[0];
    if (!sample) return; // no seeded data — nothing to assert against

    const byDate = await request(app).get(`/api/attendance?date=${sample.date}&limit=200`);
    expect(byDate.status).toBe(200);
    expect(byDate.body.length).toBeGreaterThan(0);
    for (const r of byDate.body) expect(r.date).toBe(sample.date);

    const byBoth = await request(app)
      .get(`/api/attendance?date=${sample.date}&departmentId=${sample.departmentId}&limit=200`);
    expect(byBoth.status).toBe(200);
    for (const r of byBoth.body) {
      expect(r.date).toBe(sample.date);
      expect(r.departmentId).toBe(sample.departmentId);
    }
  });

  // NOTE: POST /api/attendance/:id/correction enforces req.session?.userId and
  // returns 401 when no session is present. In demo mode there is no session
  // cookie mechanism wired to supertest, so these tests are skipped.
  it.skip("POST /api/attendance/:id/correction with valid body returns 201 (requires session — demo mode)", async () => {
    const res = await request(app)
      .post("/api/attendance/1/correction")
      .send({
        employeeId: TEST_EMPLOYEE_ID,
        correctionType: "check_in",
        originalValue: "08:00",
        requestedValue: "07:55",
        reason: "TEST correction",
        requestedByUserId: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.correctionType).toBe("check_in");
    expect(res.body.status).toBe("pending");
    createdCorrectionIds.push(res.body.id);
  });

  it.skip("POST /api/attendance/:id/correction without required fields returns 400 (requires session — demo mode)", async () => {
    const res = await request(app)
      .post("/api/attendance/1/correction")
      .send({ employeeId: TEST_EMPLOYEE_ID });
    expect(res.status).toBe(400);
  });
});
