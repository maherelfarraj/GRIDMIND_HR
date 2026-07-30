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
  leaveRequestsTable,
  leaveTypesTable,
  publicHolidaysTable,
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
// Feb 2098 has 20 working days (Fri/Sat weekends excluded; Feb 1 is a Saturday).
const PERIOD_WORKING_DAYS = 20;

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
    // OT is split per day-type bucket; these events are all weekday.
    expect(lineAmount("OT_WEEKDAY")).toBeCloseTo(otPay, 2);
    expect(lines.find(l => l.codeEn === "OT_WEEKEND")).toBeUndefined();
    expect(lines.find(l => l.codeEn === "OT_HOLIDAY")).toBeUndefined();
    // Bucket lines sum to the stored overtimePay.
    const otLineSum = lines.filter(l => l.codeEn.startsWith("OT_")).reduce((s, l) => s + parseFloat(l.amount), 0);
    expect(otLineSum).toBeCloseTo(parseFloat(run.overtimePay), 2);
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

  describe("unpaid leave deduction", () => {
    let emp3Id: number;
    let unpaidTypeId: number;
    let leaveId: number;
    const UNPAID_DAYS = 4; // 2098-02-10 (Mon) .. 2098-02-13 (Thu) — all working days

    beforeAll(async () => {
      const [seedEmp] = await db.select().from(employeesTable).limit(1);
      const [e3] = await db.insert(employeesTable).values({
        employeeNumber: `T-EMP-${SUFFIX}-3`,
        firstNameEn: "Test", lastNameEn: "Payroll3",
        firstNameAr: "اختبار", lastNameAr: "رواتب3",
        nationalId: `T${SUFFIX}3`,
        jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
        departmentId: seedEmp.departmentId,
        roleId: seedEmp.roleId,
        status: "active",
        grade: GRADE_CODE,
        email: `test-payroll-${SUFFIX}-3@example.com`,
        hireDate: "2020-01-01",
        nationality: "SA",
      }).returning();
      emp3Id = e3.id;

      const [lt] = await db.insert(leaveTypesTable).values({
        codeEn: `T-UNP-${SUFFIX}`,
        nameEn: "TEST Unpaid Leave", nameAr: "إجازة بدون راتب اختبار",
        category: "unpaid",
        isActive: false, // keep out of annual-reset sweeps
      }).returning();
      unpaidTypeId = lt.id;

      const [lr] = await db.insert(leaveRequestsTable).values({
        requestNumber: `T-LR-${SUFFIX}`,
        employeeId: emp3Id,
        leaveTypeId: unpaidTypeId,
        startDate: "2098-02-10", endDate: "2098-02-13",
        totalDays: String(UNPAID_DAYS),
        status: "approved",
      }).returning();
      leaveId = lr.id;
    });

    afterAll(async () => {
      // Remove emp3's runs first so the employee row can be deleted.
      if (emp3Id) {
        const runs = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.employeeId, emp3Id));
        const runIds = runs.map(r => r.id);
        if (runIds.length) {
          await db.delete(payrollRunLinesTable).where(inArray(payrollRunLinesTable.payrollRunId, runIds));
          await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, runIds));
        }
      }
      if (leaveId) await db.delete(leaveRequestsTable).where(eq(leaveRequestsTable.id, leaveId));
      if (unpaidTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, unpaidTypeId));
      if (emp3Id) await db.delete(employeesTable).where(eq(employeesTable.id, emp3Id));
    });

    it("deducts approved unpaid leave days proportionally from the payslip", async () => {
      const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
      expect(res.status).toBe(200);

      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === emp3Id);
      expect(run).toBeDefined();

      const housing = BASE_SALARY * (HOUSING_PCT / 100);
      const transport = BASE_SALARY * (TRANSPORT_PCT / 100);
      const dailyRate = (BASE_SALARY + housing + transport) / PERIOD_WORKING_DAYS;
      const expectedDeduction = round2(UNPAID_DAYS * dailyRate);

      expect(parseFloat(run.deductedLeaveDays)).toBeCloseTo(UNPAID_DAYS, 1);
      expect(parseFloat(run.leaveDeductionAmount)).toBeCloseTo(expectedDeduction, 2);
      expect(run.workingDays).toBe(PERIOD_WORKING_DAYS);
      expect(run.presentDays).toBe(PERIOD_WORKING_DAYS - UNPAID_DAYS);
      expect(run.absentDays).toBe(UNPAID_DAYS);

      // The deduction line item exists and is reflected in totals.
      const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
      const lines: { codeEn: string; amount: string; type: string }[] = detail.body.lines;
      const dedLine = lines.find(l => l.codeEn === "UNPAID_LEAVE");
      expect(dedLine).toBeDefined();
      expect(dedLine!.type).toBe("deduction");
      expect(parseFloat(dedLine!.amount)).toBeCloseTo(expectedDeduction, 2);

      expect(parseFloat(run.netSalary)).toBeCloseTo(parseFloat(run.grossSalary) - parseFloat(run.totalDeductions), 2);
      expect(parseFloat(run.totalDeductions)).toBeGreaterThanOrEqual(expectedDeduction);

      // Peer with same grade and no unpaid leave nets exactly the deduction more.
      const peer = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
      const peerNetNoOt = parseFloat(peer.netSalary) - parseFloat(peer.overtimePay);
      expect(peerNetNoOt - parseFloat(run.netSalary)).toBeCloseTo(expectedDeduction, 1);
    });

    it("does not deduct anything for employees without unpaid leave", async () => {
      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
      expect(parseFloat(run.deductedLeaveDays)).toBe(0);
      expect(parseFloat(run.leaveDeductionAmount)).toBe(0);
      expect(run.presentDays).toBe(PERIOD_WORKING_DAYS);
      expect(run.absentDays).toBe(0);
      const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
      expect(detail.body.lines.find((l: { codeEn: string }) => l.codeEn === "UNPAID_LEAVE")).toBeUndefined();
    });

    it("only counts the working days of a leave that overlap the period", async () => {
      // Extend the leave beyond the period end: 2098-02-25 .. 2098-03-05.
      // In-period slice is Feb 25 (Tue) – Feb 28 (Fri); Feb 28 is a weekend day → 3 working days.
      await db.update(leaveRequestsTable)
        .set({ startDate: "2098-02-25", endDate: "2098-03-05", totalDays: "9" })
        .where(eq(leaveRequestsTable.id, leaveId));

      const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
      expect(res.status).toBe(200);
      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === emp3Id);
      expect(parseFloat(run.deductedLeaveDays)).toBeCloseTo(3, 1); // Feb 25–27 working days only
    });
  });

  describe("public holidays excluded from working days", () => {
    let holidayId: number;
    // 2098-02-16 is a Sunday — a working day under the Fri/Sat weekend.
    const HOLIDAY_DATE = "2098-02-16";

    beforeAll(async () => {
      const [h] = await db.insert(publicHolidaysTable).values({
        nameEn: `TEST Holiday ${SUFFIX}`,
        nameAr: `عطلة اختبار ${SUFFIX}`,
        date: HOLIDAY_DATE,
        year: 2098,
        applicableTo: "all",
      }).returning();
      holidayId = h.id;
    });

    afterAll(async () => {
      if (holidayId) await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, holidayId));
    });

    it("drops workingDays by one when a public holiday falls in the period", async () => {
      const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
      expect(res.status).toBe(200);

      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
      expect(run).toBeDefined();
      expect(run.workingDays).toBe(PERIOD_WORKING_DAYS - 1);
      expect(run.presentDays).toBe(PERIOD_WORKING_DAYS - 1);
    });
  });

  describe("sector-specific and recurring holidays", () => {
    const extraHolidayIds: number[] = [];
    // 2098-02-17 is a Monday; 2098-02-18 is a Tuesday — both working days.
    const MILITARY_DATE = "2098-02-17";
    const RECURRING_MONTH_DAY = "-02-18"; // stored as 2050-02-18, recurring

    beforeAll(async () => {
      const rows = await db.insert(publicHolidaysTable).values([
        {
          nameEn: `TEST Military Holiday ${SUFFIX}`,
          nameAr: `عطلة عسكرية اختبار ${SUFFIX}`,
          date: MILITARY_DATE,
          year: 2098,
          applicableTo: "military",
        },
        {
          nameEn: `TEST Recurring Holiday ${SUFFIX}`,
          nameAr: `عطلة متكررة اختبار ${SUFFIX}`,
          date: `2050${RECURRING_MONTH_DAY}`,
          year: 2050,
          isRecurring: true,
          applicableTo: "all",
        },
      ]).returning();
      extraHolidayIds.push(...rows.map(r => r.id));
    });

    afterAll(async () => {
      if (extraHolidayIds.length) {
        await db.delete(publicHolidaysTable).where(inArray(publicHolidaysTable.id, extraHolidayIds));
      }
    });

    it("ignores a military-only holiday for commercial employees but honors an all-sector recurring holiday from another year", async () => {
      const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
      expect(res.status).toBe(200);

      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
      expect(run).toBeDefined();
      // Test employees are commercial (default organizationType). Only the
      // recurring all-sector holiday (2098-02-18) reduces working days; the
      // military-only holiday on 2098-02-17 must not.
      expect(run.workingDays).toBe(PERIOD_WORKING_DAYS - 1);
    });

    it("counts the military holiday for a military-sector employee", async () => {
      await db.update(employeesTable)
        .set({ organizationType: "military" })
        .where(eq(employeesTable.id, empWithGradeId));
      try {
        const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
        expect(res.status).toBe(200);

        const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
        const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
        expect(run).toBeDefined();
        // Military employee gets both the recurring all-sector holiday and the
        // military-only one excluded: 2 fewer working days.
        expect(run.workingDays).toBe(PERIOD_WORKING_DAYS - 2);
      } finally {
        await db.update(employeesTable)
          .set({ organizationType: "commercial" })
          .where(eq(employeesTable.id, empWithGradeId));
      }
    });
  });

  describe("overtime multipliers by day type", () => {
    // 2098-02-07 is a Friday (configured weekend); 2098-02-11 is a Tuesday.
    const WEEKEND_OT_DATE = "2098-02-07";
    const HOLIDAY_OT_DATE = "2098-02-11";
    const extraPunchIds: number[] = [];
    let otHolidayId: number;

    beforeAll(async () => {
      const [h] = await db.insert(publicHolidaysTable).values({
        nameEn: `TEST OT Holiday ${SUFFIX}`,
        nameAr: `عطلة وقت إضافي اختبار ${SUFFIX}`,
        date: HOLIDAY_OT_DATE,
        year: 2098,
        applicableTo: "all",
      }).returning();
      otHolidayId = h.id;

      for (const date of [WEEKEND_OT_DATE, HOLIDAY_OT_DATE]) {
        const [ev] = await db.insert(punchEventsTable).values({
          employeeId: empWithGradeId,
          eventTime: new Date(`${date}T18:00:00Z`),
          eventType: "OVERTIME_START",
          source: "MANUAL",
          notes: `TEST-PAYROLL-OT-${SUFFIX}`,
        }).returning();
        extraPunchIds.push(ev.id);
      }
    });

    afterAll(async () => {
      if (extraPunchIds.length) {
        await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, extraPunchIds));
      }
      if (otHolidayId) await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, otHolidayId));
    });

    it("pays weekend and holiday overtime at their own multipliers", async () => {
      const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
      expect(res.status).toBe(200);

      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empWithGradeId);
      expect(run).toBeDefined();

      const otRules = await db.select().from(overtimeRulesTable).where(eq(overtimeRulesTable.isActive, true));
      const otRule = otRules.find(r => r.nameEn.includes("Standard")) ?? otRules[0];
      const weekdayRate = otRule ? parseFloat(String(otRule.multiplierWeekday)) : 1.5;
      const weekendRate = otRule ? parseFloat(String(otRule.multiplierWeekend)) : 2.0;
      const holidayRate = otRule ? parseFloat(String(otRule.multiplierHoliday)) : 2.5;
      // Sanity: seeded rule must actually differentiate the rates for this test to be meaningful.
      expect(weekendRate).toBeGreaterThan(weekdayRate);

      const hourly = BASE_SALARY / 176;
      // Original OT_EVENTS weekday events (2h each) + 2h weekend + 2h holiday.
      const expectedHours = OT_EVENTS * 2 + 2 + 2;
      // Each bucket is rounded independently, then summed (matches the payslip lines exactly).
      const expectedPay = round2(
        round2(hourly * OT_EVENTS * 2 * weekdayRate) +
        round2(hourly * 2 * weekendRate) +
        round2(hourly * 2 * holidayRate)
      );

      expect(parseFloat(run.overtimeHours)).toBeCloseTo(expectedHours, 2);
      expect(parseFloat(run.overtimePay)).toBeCloseTo(expectedPay, 2);

      // Payslip shows one line per non-zero bucket, each at its own rate,
      // and the bucket amounts sum to the stored overtimePay.
      const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
      expect(detail.status).toBe(200);
      const lines: { codeEn: string; nameEn: string; amount: string }[] = detail.body.lines;
      const lineAmount = (code: string) => parseFloat(lines.find(l => l.codeEn === code)?.amount ?? "NaN");
      expect(lineAmount("OT_WEEKDAY")).toBeCloseTo(round2(hourly * OT_EVENTS * 2 * weekdayRate), 2);
      expect(lineAmount("OT_WEEKEND")).toBeCloseTo(round2(hourly * 2 * weekendRate), 2);
      expect(lineAmount("OT_HOLIDAY")).toBeCloseTo(round2(hourly * 2 * holidayRate), 2);
      const otLineSum = lines.filter(l => l.codeEn.startsWith("OT_")).reduce((s, l) => s + parseFloat(l.amount), 0);
      expect(otLineSum).toBeCloseTo(parseFloat(run.overtimePay), 2);
      // Hours are visible in the line names for auditability.
      expect(lines.find(l => l.codeEn === "OT_WEEKEND")?.nameEn).toMatch(/2h/);
    });
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
