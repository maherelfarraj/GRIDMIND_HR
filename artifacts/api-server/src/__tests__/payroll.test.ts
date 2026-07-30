/**
 * Payroll tests — run listing, payslip shape, and closed-period protection.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, payrollPeriodsTable, payrollRunsTable } from "@workspace/db";
import app from "../app";

const createdPeriodIds: number[] = [];
const createdRunIds: number[] = [];

afterAll(async () => {
  if (createdRunIds.length) await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, createdRunIds));
  if (createdPeriodIds.length) await db.delete(payrollPeriodsTable).where(inArray(payrollPeriodsTable.id, createdPeriodIds));
});

describe("payroll runs API", () => {
  it("lists payroll runs with employee enrichment", async () => {
    const res = await request(app).get("/api/payroll-runs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty("employeeNameEn");
      expect(res.body[0]).toHaveProperty("netSalary");
    }
  });

  it("returns a payslip with employee, period, summary, earnings and deductions", async () => {
    const runs = await request(app).get("/api/payroll-runs");
    if (runs.body.length === 0) return; // no seeded runs — shape test not applicable
    const res = await request(app).get(`/api/payroll-runs/${runs.body[0].id}/payslip`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("employee.fullNameEn");
    expect(res.body).toHaveProperty("period.periodCode");
    expect(res.body).toHaveProperty("summary.netSalary");
    expect(Array.isArray(res.body.earnings)).toBe(true);
    expect(Array.isArray(res.body.deductions)).toBe(true);
  });

  it("404s for a missing run", async () => {
    const res = await request(app).get("/api/payroll-runs/999999");
    expect(res.status).toBe(404);
  });

  it("blocks modifying a run in a closed period", async () => {
    const [period] = await db.insert(payrollPeriodsTable).values({
      periodCode: `TEST-${Date.now() % 1000000}`,
      nameEn: "TEST Closed Period", nameAr: "فترة مغلقة للاختبار",
      startDate: "2099-01-01", endDate: "2099-01-31", payDate: "2099-02-01",
      status: "closed", isClosed: true,
    }).returning();
    createdPeriodIds.push(period.id);

    const [run] = await db.insert(payrollRunsTable).values({
      payrollPeriodId: period.id, employeeId: 1, baseSalary: "10000",
    }).returning();
    createdRunIds.push(run.id);

    const res = await request(app).patch(`/api/payroll-runs/${run.id}`).send({ exceptionNote: "should fail" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed period/i);
  });
});
