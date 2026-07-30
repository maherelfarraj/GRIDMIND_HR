/**
 * Integration tests — health checks, installation readiness, deployment events,
 * and update packages.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, healthChecksTable } from "@workspace/db";
import app from "../app";

const createdHealthCheckIds: number[] = [];

afterAll(async () => {
  if (createdHealthCheckIds.length) {
    await db.delete(healthChecksTable)
      .where(inArray(healthChecksTable.id, createdHealthCheckIds));
  }
});

describe("health checks", () => {
  it("POST /api/health-checks/run with checkTypes:[database,disk] returns 201 with 2 results", async () => {
    const res = await request(app)
      .post("/api/health-checks/run")
      .send({ checkTypes: ["database", "disk"] });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("results");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(2);
    const checkTypes = res.body.results.map((r: any) => r.checkType);
    expect(checkTypes).toContain("database");
    expect(checkTypes).toContain("disk");
    // Track for cleanup
    res.body.results.forEach((r: any) => createdHealthCheckIds.push(r.id));
  });

  it("GET /api/health-checks/results returns array of health check results", async () => {
    const res = await request(app).get("/api/health-checks/results");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("installation readiness", () => {
  it("POST /api/installation-readiness/run returns 200 with passed/failed/warnings/results", async () => {
    const res = await request(app)
      .post("/api/installation-readiness/run")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("passed");
    expect(res.body).toHaveProperty("failed");
    expect(res.body).toHaveProperty("warnings");
    expect(res.body).toHaveProperty("results");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.passed).toBe("number");
    expect(typeof res.body.failed).toBe("number");
    expect(typeof res.body.warnings).toBe("number");
  });
});

describe("deployment events", () => {
  it("GET /api/deployment-events returns a paginated list", async () => {
    const res = await request(app).get("/api/deployment-events");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty("total");
  });
});

describe("update packages", () => {
  it("GET /api/update-packages returns an array", async () => {
    const res = await request(app).get("/api/update-packages");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
