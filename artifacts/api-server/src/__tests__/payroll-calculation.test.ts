/**
 * Payroll calculation engine tests — line-item math (base salary from grade,
 * allowance percentages, overtime pay, pay components, net = gross − deductions)
 * and exception flagging for employees whose grade has no matching salary grade.
 *
 * Uses a dedicated far-future payroll period and dedicated test employees/grade
 * so seeded demo data is never disturbed; all fixtures are removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payComponentsTable,
  overtimeRulesTable,
  salaryGradesTable,
  employeesTable,
  punchEventsTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-GRD-${SUFFIX}`;
const MISSING_GRADE_CODE = `T-NOGRD-${SUFFIX}`;

// Grade values chosen so every derived amount is exact to the cent.
const BASE_SALARY = 12000;
const HOUSING_PCT = 20;
const TRANSPORT_PCT = 8;
const OT_EVENTS = 3; // engine counts 2h per OVERTIME_START event → 6 OT hours

// Far-future period — no seeded punch events or rosters can leak in.
const PERIOD_START = "2098-02-01";
const PERIOD_END = "2098-02-28";

let gradeId: number;
let empWithGradeId: number;
let empNoGradeId: number;
let periodId: number;
let closedPeriodId: number;
const punchEventIds: number[] = [];

const round2 = (n: number) => Math.round(n * 100) / 100;

beforeAll(async () => {
  // Reuse a seeded employee's department/role so FKs are valid.
  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST Grade",
    nameAr: "درجة اختبار",
    baseSalary: String(BASE_SALARY),
    housingAllowancePct: String(HOUSING_PCT),
    transportAllowancePct: String(TRANSPORT_PCT),
  }).returning();
  gradeId = grade.id;

  const mkEmp = (n: number, gradeCode: string) => ({
    employeeNumber: `T-EMP-${SUFFIX}-${n}`,
    firstNameEn: "Test", lastNameEn: `Payroll${n}`,
    firstNameAr: "اختبار", lastNameAr: `رواتب${n}`,
    nationalId: `T${SUFFIX}${n}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: gradeCode,
    email: `test-payroll-${SUFFIX}-${n}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
  });

  const [e1] = await db.insert(employeesTable).values(mkEmp(1, GRADE_CODE)).returning();
  const [e2] = await db.insert(employeesTable).values(mkEmp(2, MISSING_GRADE_CODE)).returning();
  empWithGradeId = e1.id;
  empNoGradeId = e2.id;

  // Overtime punch events inside the period for employee 1.
  for (let i = 0; i < OT_EVENTS; i++) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId: empWithGradeId,
      eventTime: new Date(`2098-02-0${i + 2}T18:00:00Z`),
      eventType: "OVERTIME_START",
      source: "MANUAL",
      notes: `TEST-PAYROLL-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-PP-${SUFFIX}`,
    nameEn: "TEST Calc Period", nameAr: "فترة اختبار الحساب",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2098-03-01",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  const periodIds = [periodId, closedPeriodId].filter(Boolean);
  if (periodIds.length) {
    const runs = await db.select().from(payrollRunsTable)
      .where(inArray(payrollRunsTable.payrollPeriodId, periodIds));
    const runIds = runs.map(r => r.id);
    if (runIds.length) {
      await db.delete(payrollRunLinesTable).where(inArray(payrollRunLinesTable.payrollRunId, runIds));
      await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, runIds));
    }
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "payroll_period"),
      inArray(auditLogsTable.entityId, periodIds),
    ));
    await db.delete(payrollPeriodsTable).where(inArray(payrollPeriodsTable.id, periodIds));
  }
  if (punchEventIds.length) {
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  }
  if (empWithGradeId || empNoGradeId) {
    await db.delete(employeesTable).where(inArray(employeesTable.id, [empWithGradeId, empNoGradeId].filter(Boolean)));
  }
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

describe("payroll calculation engine", () => {
  it("calculates line-item math from the salary grade", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);
    expect(res.body.runsCreated).toBeGreaterThanOrEqual(2);

    const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
    expect(runsRes.status).toBe(200);
    const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
    expect(run).toBeDefined();
    expect(run.hasException).toBe(false);
    expect(run.status).toBe("calculated");

    // --- Expected math, mirroring the engine's rules ---
    const housing = BASE_SALARY * (HOUSING_PCT / 100);   // 2400
    const transport = BASE_SALARY * (TRANSPORT_PCT / 100); // 960

    // Overtime: 2h per OVERTIME_START event, hourly = base/176, standard weekday rate.
    const otRules = await db.select().from(overtimeRulesTable).where(eq(overtimeRulesTable.isActive, true));
    const otRule = otRules.find(r => r.nameEn.includes("Standard")) ?? otRules[0];
    const otRate = otRule ? parseFloat(otRule.multiplierWeekday) : 1.5;
    const otHours = OT_EVENTS * 2;
    const otPay = round2(otHours * (BASE_SALARY / 176) * otRate);

    // Active pay components applicable to all/commercial employees.
    const components = await db.select().from(payComponentsTable).where(eq(payComponentsTable.isActive, true));
    let compEarnings = 0, compDeductions = 0;
    for (const comp of components.filter(c => c.applicableTo === "all" || c.applicableTo === "commercial")) {
      let amount = 0;
      if (comp.calculationMethod === "fixed") {
        amount = parseFloat(comp.value);
      } else if (comp.calculationMethod === "percentage") {
        const base = comp.percentageBase === "gross_salary" ? BASE_SALARY + housing + transport : BASE_SALARY;
        amount = base * (parseFloat(comp.value) / 100);
      }
      if (amount > 0) {
        if (comp.type === "earning") compEarnings += round2(amount);
        if (comp.type === "deduction") compDeductions += round2(amount);
      }
    }

    const expectedGross = BASE_SALARY + housing + transport + otPay + compEarnings;
    const expectedNet = expectedGross - compDeductions;

    expect(parseFloat(run.baseSalary)).toBeCloseTo(BASE_SALARY, 2);
    expect(parseFloat(run.overtimeHours)).toBeCloseTo(otHours, 2);
    expect(parseFloat(run.overtimePay)).toBeCloseTo(otPay, 2);
    expect(parseFloat(run.grossSalary)).toBeCloseTo(expectedGross, 2);
    expect(parseFloat(run.totalDeductions)).toBeCloseTo(compDeductions, 2);
    expect(parseFloat(run.netSalary)).toBeCloseTo(expectedNet, 2);
    // Invariant: net = gross − deductions, as stored.
    expect(parseFloat(run.netSalary)).toBeCloseTo(parseFloat(run.grossSalary) - parseFloat(run.totalDeductions), 2);

    // Line items: base, housing and transport allowances, and OT pay.
    const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
    expect(detail.status).toBe(200);
    const lines: { codeEn: string; amount: string; type: string }[] = detail.body.lines;
    const lineAmount = (code: string) => parseFloat(lines.find(l => l.codeEn === code)?.amount ?? "NaN");
    expect(lineAmount("BASE")).toBeCloseTo(BASE_SALARY, 2);
    expect(lineAmount("HOUSING")).toBeCloseTo(housing, 2);
    expect(lineAmount("TRANSPORT")).toBeCloseTo(transport, 2);
    expect(lineAmount("OT_PAY")).toBeCloseTo(otPay, 2);
    // Sum of earning lines equals gross; earnings − deductions equals net.
    const sumEarnings = lines.filter(l => l.type === "earning").reduce((s, l) => s + parseFloat(l.amount), 0);
    const sumDeductions = lines.filter(l => l.type === "deduction").reduce((s, l) => s + parseFloat(l.amount), 0);
    expect(sumEarnings).toBeCloseTo(parseFloat(run.grossSalary), 1);
    expect(sumEarnings - sumDeductions).toBeCloseTo(parseFloat(run.netSalary), 1);
  });

  it("flags an exception when the employee's grade has no matching salary grade", async () => {
    const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
    const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empNoGradeId);
    expect(run).toBeDefined();
    expect(run.hasException).toBe(true);
    expect(run.status).toBe("exception");
    expect(run.exceptionNote).toMatch(/no salary grade/i);
    expect(parseFloat(run.baseSalary)).toBeCloseTo(5000, 2); // documented fallback base

    // Period rolls up the exception count and moves to review.
    const periodRes = await request(app).get(`/api/payroll-periods/${periodId}`);
    expect(periodRes.body.exceptionCount).toBeGreaterThanOrEqual(1);
    expect(periodRes.body.status).toBe("under_review");
  });

  it("recalculating replaces prior runs instead of duplicating them", async () => {
    const before = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);
    const after = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
    expect(after.body.length).toBe(before.body.length);
    const mine = after.body.filter((r: { employeeId: number }) =>
      r.employeeId === empWithGradeId || r.employeeId === empNoGradeId);
    expect(mine.length).toBe(2);
  });

  it("refuses to recalculate a closed period", async () => {
    const [closed] = await db.insert(payrollPeriodsTable).values({
      periodCode: `T-PPC-${SUFFIX}`,
      nameEn: "TEST Closed Calc Period", nameAr: "فترة مغلقة للاختبار",
      startDate: "2099-02-01", endDate: "2099-02-28", payDate: "2099-03-01",
      status: "closed", isClosed: true,
    }).returning();
    closedPeriodId = closed.id;

    const res = await request(app).post(`/api/payroll-periods/${closedPeriodId}/calculate`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
  });
});
