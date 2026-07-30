/**
 * Weekend-day configuration tests — payroll working-day calculation must read
 * "payroll.weekendDays" from system_config instead of hardcoding Fri/Sat.
 *
 * Uses a dedicated far-future period (Feb 2098; Feb 1 is a Saturday) plus a
 * dedicated grade/employee. The config value is mutated during the test and
 * restored to its original value in afterAll so other suites (which run
 * sequentially) see the default again.
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
  auditLogsTable,
  leaveRequestsTable,
  leaveTypesTable,
  systemConfigTable,
} from "@workspace/db";
import app from "../app";

const CONFIG_KEY = "payroll.weekendDays";
const SUFFIX = `${Date.now() % 1000000}W`;
const GRADE_CODE = `T-WKD-${SUFFIX}`;
const BASE_SALARY = 10000;
const HOUSING_PCT = 20;
const TRANSPORT_PCT = 10;

// Feb 2098: 28 days, Feb 1 is a Saturday → exactly 4 of every weekday.
const PERIOD_START = "2098-02-01";
const PERIOD_END = "2098-02-28";
const DEFAULT_WORKING_DAYS = 20;      // Fri/Sat weekend
const FRIDAY_ONLY_WORKING_DAYS = 24;  // [5] — single-day weekend

let gradeId: number;
let empId: number;
let periodId: number;
let unpaidTypeId: number;
let leaveId: number;
let originalConfigValue: string | null = null; // null → row didn't exist
let configRowCreated = false;

async function setWeekendConfig(value: string) {
  await db.update(systemConfigTable)
    .set({ value, updatedAt: new Date() })
    .where(eq(systemConfigTable.key, CONFIG_KEY));
}

async function calculateAndGetRun() {
  const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
  expect(res.status).toBe(200);
  const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
  expect(runsRes.status).toBe(200);
  const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === empId);
  expect(run).toBeDefined();
  return run;
}

beforeAll(async () => {
  // Snapshot (or create) the config row so we can mutate it safely.
  const [existing] = await db.select().from(systemConfigTable)
    .where(eq(systemConfigTable.key, CONFIG_KEY));
  if (existing) {
    originalConfigValue = existing.value;
  } else {
    configRowCreated = true;
    await db.insert(systemConfigTable).values({
      key: CONFIG_KEY, value: "[5,6]", valueType: "json", category: "payroll",
      labelEn: "Weekend Days", labelAr: "أيام عطلة نهاية الأسبوع",
      isPublic: true, isReadonly: false,
    });
  }

  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST Weekend Grade", nameAr: "درجة اختبار العطلة",
    baseSalary: String(BASE_SALARY),
    housingAllowancePct: String(HOUSING_PCT),
    transportAllowancePct: String(TRANSPORT_PCT),
  }).returning();
  gradeId = grade.id;

  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: `T-EMP-${SUFFIX}`,
    firstNameEn: "Test", lastNameEn: "Weekend",
    firstNameAr: "اختبار", lastNameAr: "عطلة",
    nationalId: `TW${SUFFIX}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-weekend-${SUFFIX}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
  }).returning();
  empId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: `T-WUNP-${SUFFIX}`,
    nameEn: "TEST Unpaid Weekend", nameAr: "إجازة بدون راتب اختبار",
    category: "unpaid",
    isActive: false, // keep out of annual-reset sweeps
  }).returning();
  unpaidTypeId = lt.id;

  // Leave Feb 12 (Wed) – Feb 15 (Sat). Working days inside depend on the
  // configured weekend — see the per-test expectations.
  const [lr] = await db.insert(leaveRequestsTable).values({
    requestNumber: `T-LR-${SUFFIX}`,
    employeeId: empId,
    leaveTypeId: unpaidTypeId,
    startDate: "2098-02-12", endDate: "2098-02-15",
    totalDays: "4",
    status: "approved",
  }).returning();
  leaveId = lr.id;

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-PPW-${SUFFIX}`,
    nameEn: "TEST Weekend Period", nameAr: "فترة اختبار العطلة",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2098-03-01",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  // Restore the weekend config exactly as we found it.
  if (configRowCreated) {
    await db.delete(systemConfigTable).where(eq(systemConfigTable.key, CONFIG_KEY));
  } else if (originalConfigValue !== null) {
    await setWeekendConfig(originalConfigValue);
  }

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
  if (unpaidTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, unpaidTypeId));
  if (empId) await db.delete(employeesTable).where(eq(employeesTable.id, empId));
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

describe("configurable weekend days in payroll calculation", () => {
  it("uses the default Fri/Sat weekend when the config holds the default", async () => {
    await setWeekendConfig("[5,6]");
    const run = await calculateAndGetRun();
    expect(run.workingDays).toBe(DEFAULT_WORKING_DAYS);
    // Leave Feb 12 (Wed) – 15 (Sat): Wed, Thu, Sun-start? → Fri 14 & Sat 15 are weekend → 2 working days.
    expect(parseFloat(run.deductedLeaveDays)).toBeCloseTo(2, 1);
    const dailyRate = (BASE_SALARY * (1 + (HOUSING_PCT + TRANSPORT_PCT) / 100)) / DEFAULT_WORKING_DAYS;
    expect(parseFloat(run.leaveDeductionAmount)).toBeCloseTo(Math.round(2 * dailyRate * 100) / 100, 2);
  });

  it("recomputes working days and deductions under a non-default weekend", async () => {
    // Friday-only weekend: 24 working days; leave Feb 12–15 now spans
    // Wed, Thu, (Fri off), Sat → 3 working days.
    await setWeekendConfig("[5]");
    const run = await calculateAndGetRun();
    expect(run.workingDays).toBe(FRIDAY_ONLY_WORKING_DAYS);
    expect(parseFloat(run.deductedLeaveDays)).toBeCloseTo(3, 1);
    const dailyRate = (BASE_SALARY * (1 + (HOUSING_PCT + TRANSPORT_PCT) / 100)) / FRIDAY_ONLY_WORKING_DAYS;
    expect(parseFloat(run.leaveDeductionAmount)).toBeCloseTo(Math.round(3 * dailyRate * 100) / 100, 2);
  });

  it("handles a Sat/Sun weekend configuration", async () => {
    await setWeekendConfig("[6,0]");
    const run = await calculateAndGetRun();
    expect(run.workingDays).toBe(DEFAULT_WORKING_DAYS); // still 20 in a 28-day month
    // Leave Feb 12 (Wed) – 15 (Sat): Wed, Thu, Fri working; Sat off → 3 days.
    expect(parseFloat(run.deductedLeaveDays)).toBeCloseTo(3, 1);
  });

  it("falls back to Fri/Sat when the config value is invalid", async () => {
    await setWeekendConfig("not-json");
    const run = await calculateAndGetRun();
    expect(run.workingDays).toBe(DEFAULT_WORKING_DAYS);
    expect(parseFloat(run.deductedLeaveDays)).toBeCloseTo(2, 1);
  });

  it("falls back to Fri/Sat when all 7 days are marked as weekend", async () => {
    await setWeekendConfig("[0,1,2,3,4,5,6]"); // would make workingDays 0 → division by zero
    const run = await calculateAndGetRun();
    expect(run.workingDays).toBe(DEFAULT_WORKING_DAYS);
  });
});
