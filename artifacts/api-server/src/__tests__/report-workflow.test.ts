/**
 * Integration tests — report definition listing and report generation workflow.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, reportOutputsTable } from "@workspace/db";
import app from "../app";

const createdOutputIds: number[] = [];

afterAll(async () => {
  if (createdOutputIds.length) {
    await db.delete(reportOutputsTable)
      .where(inArray(reportOutputsTable.id, createdOutputIds));
  }
});

describe("report definitions", () => {
  it("GET /api/report-definitions returns array with at least 5 items", async () => {
    const res = await request(app).get("/api/report-definitions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
  });

  it("GET /api/report-definitions?reportType=workforce returns only workforce reports", async () => {
    const res = await request(app).get("/api/report-definitions?reportType=workforce");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // If any workforce reports are seeded, all must have reportType == "workforce".
    for (const row of res.body) {
      expect(row.reportType).toBe("workforce");
    }
  });
});

describe("report execution workflow", () => {
  let definitionId: number;
  let outputId: number;

  it("resolves a report definition to run", async () => {
    const res = await request(app).get("/api/report-definitions");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    definitionId = res.body[0].id;
  });

  it("POST /api/report-definitions/:id/run returns 201 ReportOutput with status:ready", async () => {
    const res = await request(app)
      .post(`/api/report-definitions/${definitionId}/run`)
      .send({ exportFormat: "pdf", language: "en" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.status).toBe("ready");
    expect(res.body.outputFormat).toBe("pdf");
    expect(res.body.language).toBe("en");
    expect(res.body.reportDefinitionId).toBe(definitionId);
    outputId = res.body.id;
    createdOutputIds.push(outputId);
  });

  it("GET /api/report-outputs returns paginated list including the generated output", async () => {
    const res = await request(app).get("/api/report-outputs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((o: any) => o.id);
    expect(ids).toContain(outputId);
  });

  it("GET /api/report-outputs/:id returns 200 with correct output", async () => {
    const res = await request(app).get(`/api/report-outputs/${outputId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(outputId);
    expect(res.body.status).toBe("ready");
  });

  it("GET /api/report-outputs/:id returns 404 for a missing output", async () => {
    const res = await request(app).get("/api/report-outputs/999999");
    expect(res.status).toBe(404);
  });

  it("POST /api/report-definitions/999999/run returns 404 for missing definition", async () => {
    const res = await request(app)
      .post("/api/report-definitions/999999/run")
      .send({ exportFormat: "pdf", language: "en" });
    expect(res.status).toBe(404);
  });
});
