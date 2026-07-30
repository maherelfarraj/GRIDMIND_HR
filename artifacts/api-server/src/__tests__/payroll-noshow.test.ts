/**
 * No-show absence deduction tests — workdays in a payroll period with no punch
 * activity, no attendance record showing presence, and no approved leave are
 * deducted from pay and counted in absentDays.
 *
 * Uses a dedicated PAST period (no-show detection never counts future days) and
 * dedicated test employees/grade; all fixtures are removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  salaryGradesTable,
  employeesTable,
  punchEventsTable,
  attendanceRecordsTable,
  auditLogsTable,
  leaveRequestsTable,
  leaveTypesTable,
} from "@workspace/db";
import app from "../app";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-NSG-${SUFFIX}`;

const BASE_SALARY = 11000;
const HOUSING_PCT = 20;
const TRANSPORT_PCT = 10;

// Past period: Sun 2024-03-03 .. Sat 2024-03-09.
// Workdays (Sun–Thu): 03, 04, 05, 06, 07. Fri 08 / Sat 09 are weekend.
const PERIOD_START = "2024-03-03";
const PERIOD_END = "2024-03-09";
const WORKDAYS = ["2024-03-03", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07"];

let gradeId: number;
let empAbsentId: number;   // punches 3 days, leave 1 day, no-show 1 day
let empPresentId: number;  // punches 4 days + attendance record on the 5th
let periodId: number;
let paidTypeId: number;
let leaveId: number;
const punchEventIds: number[] = [];
const attendanceIds: number[] = [];

const round2 = (n: number) => Math.round(n * 100) / 100;

beforeAll(async () => {
  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST NoShow Grade",
    nameAr: "درجة اختبار الغياب",
    baseSalary: String(BASE_SALARY),
    housingAllowancePct: String(HOUSING_PCT),
    transportAllowancePct: String(TRANSPORT_PCT),
  }).returning();
  gradeId = grade.id;

  const mkEmp = (n: number) => ({
    employeeNumber: `T-NSE-${SUFFIX}-${n}`,
    firstNameEn: "Test", lastNameEn: `NoShow${n}`,
    firstNameAr: "اختبار", lastNameAr: `غياب${n}`,
    nationalId: `TN${SUFFIX}${n}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-noshow-${SUFFIX}-${n}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
  });

  const [e1] = await db.insert(employeesTable).values(mkEmp(1)).returning();
  const [e2] = await db.insert(employeesTable).values(mkEmp(2)).returning();
  empAbsentId = e1.id;
  empPresentId = e2.id;

  // empAbsent: punches on the first 3 workdays only.
  for (const d of WORKDAYS.slice(0, 3)) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId: empAbsentId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-NOSHOW-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }

  // empAbsent: approved PAID leave on workday 4 (2024-03-06) — covered, not a no-show.
  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: `T-NSP-${SUFFIX}`,
    nameEn: "TEST Paid Leave", nameAr: "إجازة مدفوعة اختبار",
    category: "paid",
    isActive: false, // keep out of annual-reset sweeps
  }).returning();
  paidTypeId = lt.id;
  const [lr] = await db.insert(leaveRequestsTable).values({
    requestNumber: `T-NSLR-${SUFFIX}`,
    employeeId: empAbsentId,
    leaveTypeId: paidTypeId,
    startDate: "2024-03-06", endDate: "2024-03-06",
    totalDays: "1",
    status: "approved",
  }).returning();
  leaveId = lr.id;
  // → workday 5 (2024-03-07) has no punch, no leave: exactly 1 no-show day.

  // empPresent: punches on 4 workdays, attendance record (present) on the 5th.
  for (const d of WORKDAYS.slice(0, 4)) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId: empPresentId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-NOSHOW-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }
  const [ar] = await db.insert(attendanceRecordsTable).values({
    employeeId: empPresentId,
    departmentId: seedEmp.departmentId,
    date: WORKDAYS[4],
    status: "present",
    checkInTime: "08:00",
    notes: `TEST-NOSHOW-${SUFFIX}`,
  }).returning();
  attendanceIds.push(ar.id);

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-NSPP-${SUFFIX}`,
    nameEn: "TEST NoShow Period", nameAr: "فترة اختبار الغياب",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2024-03-10",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  if (periodId) {
    const runs = await db.select().from(payrollRunsTable)
      .where(eq(payrollRunsTable.payrollPeriodId, periodId));
    const runIds = runs.map(r => r.id);
    if (runIds.length) {
      await db.delete(payrollRunLinesTable).where(inArray(payrollRunLinesTable.payrollRunId, runIds));
      await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, runIds));
    }
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "payroll_period"),
      eq(auditLogsTable.entityId, periodId),
    ));
    await db.delete(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  }
  if (leaveId) await db.delete(leaveRequestsTable).where(eq(leaveRequestsTable.id, leaveId));
  if (paidTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, paidTypeId));
  if (punchEventIds.length) {
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  }
  if (attendanceIds.length) {
    await db.delete(attendanceRecordsTable).where(inArray(attendanceRecordsTable.id, attendanceIds));
  }
  if (empAbsentId || empPresentId) {
    await db.delete(employeesTable).where(inArray(employeesTable.id, [empAbsentId, empPresentId].filter(Boolean)));
  }
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

describe("payroll no-show absence deduction", () => {
  it("deducts pay for workdays with no punches, no attendance and no approved leave", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);

    const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
    const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empAbsentId);
    expect(run).toBeDefined();

    const housing = BASE_SALARY * (HOUSING_PCT / 100);
    const transport = BASE_SALARY * (TRANSPORT_PCT / 100);
    // The period has 5 working days (Sun–Thu); daily rate is based on that.
    const dailyRate = (BASE_SALARY + housing + transport) / WORKDAYS.length;
    const expectedDeduction = round2(1 * dailyRate); // exactly 1 no-show day (2024-03-07)

    expect(run.workingDays).toBe(WORKDAYS.length);
    expect(run.absentDays).toBe(1);
    expect(run.presentDays).toBe(WORKDAYS.length - 1);
    // Paid leave day is not deducted as unpaid leave.
    expect(parseFloat(run.deductedLeaveDays)).toBe(0);

    const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
    const lines: { codeEn: string; amount: string; type: string }[] = detail.body.lines;
    const absLine = lines.find(l => l.codeEn === "ABSENCE");
    expect(absLine).toBeDefined();
    expect(absLine!.type).toBe("deduction");
    expect(parseFloat(absLine!.amount)).toBeCloseTo(expectedDeduction, 2);

    // Reflected in totals: net = gross − deductions, deduction ≥ absence line.
    expect(parseFloat(run.netSalary)).toBeCloseTo(parseFloat(run.grossSalary) - parseFloat(run.totalDeductions), 2);
    expect(parseFloat(run.totalDeductions)).toBeGreaterThanOrEqual(expectedDeduction);
  });

  it("does not deduct for an employee covered by punches and attendance records every workday", async () => {
    const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
    const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empPresentId);
    expect(run).toBeDefined();
    expect(run.absentDays).toBe(0);
    expect(run.presentDays).toBe(WORKDAYS.length);

    const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
    expect(detail.body.lines.find((l: { codeEn: string }) => l.codeEn === "ABSENCE")).toBeUndefined();

    // Peer comparison: absent employee nets exactly one daily rate less.
    const absent = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empAbsentId);
    const dailyRate = (BASE_SALARY * (1 + HOUSING_PCT / 100 + TRANSPORT_PCT / 100)) / WORKDAYS.length;
    expect(parseFloat(run.netSalary) - parseFloat(absent.netSalary)).toBeCloseTo(round2(dailyRate), 1);
  });

  it("never counts weekend days or future days as no-shows", async () => {
    // Both employees had zero activity on Fri 2024-03-08 and Sat 2024-03-09 —
    // absentDays already asserted above excludes them. Also verify a far-future
    // period yields no no-show deductions at all.
    const [future] = await db.insert(payrollPeriodsTable).values({
      periodCode: `T-NSFP-${SUFFIX}`,
      nameEn: "TEST Future NoShow Period", nameAr: "فترة مستقبلية اختبار",
      startDate: "2097-05-01", endDate: "2097-05-31", payDate: "2097-06-01",
      status: "draft",
    }).returning();

    try {
      const res = await request(app).post(`/api/payroll-periods/${future.id}/calculate`);
      expect(res.status).toBe(200);
      const runsRes = await request(app).get(`/api/payroll-runs?periodId=${future.id}`);
      const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empAbsentId);
      expect(run).toBeDefined();
      expect(run.absentDays).toBe(0);
      const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
      expect(detail.body.lines.find((l: { codeEn: string }) => l.codeEn === "ABSENCE")).toBeUndefined();
    } finally {
      const runs = await db.select().from(payrollRunsTable)
        .where(eq(payrollRunsTable.payrollPeriodId, future.id));
      const runIds = runs.map(r => r.id);
      if (runIds.length) {
        await db.delete(payrollRunLinesTable).where(inArray(payrollRunLinesTable.payrollRunId, runIds));
        await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, runIds));
      }
      await db.delete(auditLogsTable).where(and(
        eq(auditLogsTable.entityType, "payroll_period"),
        eq(auditLogsTable.entityId, future.id),
      ));
      await db.delete(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, future.id));
    }
  });
});
