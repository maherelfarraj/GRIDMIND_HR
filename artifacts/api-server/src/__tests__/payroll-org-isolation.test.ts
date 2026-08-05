/**
 * Cross-org payroll isolation — payroll calculation and no-show detection for
 * an org A period must be completely unaffected by org B data, even when org B
 * rows reference the same employee id or fall on the same dates:
 *   - an org B attendance record "present" on org A's no-show day,
 *   - an approved org B leave request covering that day,
 *   - an org B public holiday on that workday.
 * If any of those leak into org A's calculation, absentDays would drop to 0
 * (attendance/leave leak) or the workday count would shrink (holiday leak).
 *
 * Self-cleaning; runs against the live seeded DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  salaryGradesTable,
  employeesTable,
  punchEventsTable,
  attendanceRecordsTable,
  leaveRequestsTable,
  leaveTypesTable,
  publicHolidaysTable,
  organizationsTable,
  organizationBrandingTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-POI-${SUFFIX}`;

// Past period: Sun 2024-03-03 .. Sat 2024-03-09. Workdays Sun–Thu (Fri/Sat weekend).
const PERIOD_START = "2024-03-03";
const PERIOD_END = "2024-03-09";
const WORKDAYS = ["2024-03-03", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07"];
const NOSHOW_DAY = WORKDAYS[4]; // 2024-03-07 — no punch, no attendance in org A

let orgAId: number;
let orgBId: number;
let gradeId: number;
let empId: number;
let periodId: number;
let leaveTypeId: number;
let seedDeptId: number;
const punchEventIds: number[] = [];
const pollutionIds: { attendance?: number; leave?: number; holiday?: number } = {};

const hdr = (orgId: number) => ({ "X-Org-Id": String(orgId) });

async function createOrg(tag: string): Promise<number> {
  const res = await request(app).post("/api/organizations").send({
    nameEn: `Test PayIso ${tag} ${SUFFIX}`,
    nameAr: `اختبار عزل الرواتب ${tag}`,
    orgCode: `TPI-${tag}-${SUFFIX}`,
    orgType: "company",
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function calculateAndGetRun() {
  const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`).set(hdr(orgAId));
  expect(res.status).toBe(200);
  const runs = await db.select().from(payrollRunsTable)
    .where(eq(payrollRunsTable.payrollPeriodId, periodId));
  expect(runs.length).toBe(1);
  return runs[0];
}

beforeAll(async () => {
  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();
  seedDeptId = seedEmp.departmentId;

  orgAId = await createOrg("A");
  orgBId = await createOrg("B");

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST PayIso Grade", nameAr: "درجة اختبار العزل",
    baseSalary: "10000", housingAllowancePct: "20", transportAllowancePct: "10",
  }).returning();
  gradeId = grade.id;

  const [emp] = await db.insert(employeesTable).values({
    orgId: orgAId,
    employeeNumber: `T-POI-${SUFFIX}`,
    firstNameEn: "Test", lastNameEn: "PayIso",
    firstNameAr: "اختبار", lastNameAr: "عزل",
    nationalId: `TP${SUFFIX}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-payiso-${SUFFIX}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
  }).returning();
  empId = emp.id;

  // Punches on the first 4 workdays; NOSHOW_DAY has no activity in org A.
  for (const d of WORKDAYS.slice(0, 4)) {
    for (const [type, hour] of [["CLOCK_IN", "08"], ["CLOCK_OUT", "16"]] as const) {
      const [ev] = await db.insert(punchEventsTable).values({
        employeeId: empId,
        eventTime: new Date(`${d}T${hour}:00:00Z`),
        eventType: type,
        source: "test",
      }).returning();
      punchEventIds.push(ev.id);
    }
  }

  const [period] = await db.insert(payrollPeriodsTable).values({
    orgId: orgAId,
    periodCode: `T-POIP-${SUFFIX}`,
    nameEn: "TEST PayIso Period", nameAr: "فترة اختبار العزل",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2024-03-10",
    status: "draft",
  }).returning();
  periodId = period.id;

  const [lt] = await db.select().from(leaveTypesTable).limit(1);
  expect(lt).toBeDefined();
  leaveTypeId = lt.id;
});

afterAll(async () => {
  const runs = await db.select().from(payrollRunsTable)
    .where(eq(payrollRunsTable.payrollPeriodId, periodId));
  for (const r of runs) {
    await db.delete(payrollRunLinesTable).where(eq(payrollRunLinesTable.payrollRunId, r.id));
  }
  await db.delete(payrollRunsTable).where(eq(payrollRunsTable.payrollPeriodId, periodId));
  await db.delete(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (pollutionIds.attendance) await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, pollutionIds.attendance));
  if (pollutionIds.leave) await db.delete(leaveRequestsTable).where(eq(leaveRequestsTable.id, pollutionIds.leave));
  if (pollutionIds.holiday) await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, pollutionIds.holiday));
  if (punchEventIds.length) await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.entityType, "payroll_period")).catch(() => {});
  await db.delete(employeesTable).where(eq(employeesTable.id, empId));
  await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
  for (const orgId of [orgAId, orgBId]) {
    await db.delete(organizationBrandingTable).where(eq(organizationBrandingTable.orgId, orgId));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  }
});

describe("cross-org payroll isolation", () => {
  let baselineAbsent: number;
  let baselineNet: string;

  it("baseline: org A employee has exactly one no-show day", async () => {
    const run = await calculateAndGetRun();
    expect(run.absentDays).toBe(1);
    baselineAbsent = run.absentDays;
    baselineNet = String(run.netSalary);
  });

  it("org B attendance, approved leave, and holiday on the same day/employee do not change org A payroll", async () => {
    // Pollution: org B rows that would erase the no-show if org filtering leaked.
    const [att] = await db.insert(attendanceRecordsTable).values({
      orgId: orgBId,
      employeeId: empId,
      departmentId: seedDeptId,
      date: NOSHOW_DAY,
      status: "present",
    }).returning();
    pollutionIds.attendance = att.id;

    const [lv] = await db.insert(leaveRequestsTable).values({
      orgId: orgBId,
      employeeId: empId,
      leaveTypeId,
      requestNumber: `TPI-${SUFFIX}`,
      startDate: NOSHOW_DAY,
      endDate: NOSHOW_DAY,
      totalDays: "1",
      status: "approved",
      reasonEn: "cross-org pollution fixture",
    }).returning();
    pollutionIds.leave = lv.id;

    const [hol] = await db.insert(publicHolidaysTable).values({
      orgId: orgBId,
      nameEn: `TEST PayIso Holiday ${SUFFIX}`,
      nameAr: "عطلة اختبار العزل",
      date: NOSHOW_DAY,
      year: 2024,
      isRecurring: false,
      applicableTo: "all",
    }).returning();
    pollutionIds.holiday = hol.id;

    const run = await calculateAndGetRun();
    // Still exactly one unexcused no-show day: org B attendance/leave ignored,
    // and org B's holiday does not shrink org A's workday set.
    expect(run.absentDays).toBe(baselineAbsent);
    expect(String(run.netSalary)).toBe(baselineNet);
  });
});
