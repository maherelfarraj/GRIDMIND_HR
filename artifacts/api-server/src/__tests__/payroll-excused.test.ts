/**
 * HR-excused no-show days — HR can review detected no-show days for a payroll
 * period, excuse a day with a reason (audit-logged), and recalculation skips
 * excused days in the ABSENCE deduction. Undoing an excusal reinstates it.
 *
 * Uses a dedicated PAST period and dedicated test employee/grade; all fixtures
 * are removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq, and, like } from "drizzle-orm";
import {
  db,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollExcusedAbsencesTable,
  salaryGradesTable,
  employeesTable,
  punchEventsTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-EXG-${SUFFIX}`;

const BASE_SALARY = 10000;
const HOUSING_PCT = 25;
const TRANSPORT_PCT = 10;

// Past period: Sun 2024-06-02 .. Sat 2024-06-08.
// Workdays (Sun–Thu): 02, 03, 04, 05, 06. Fri 07 / Sat 08 weekend.
const PERIOD_START = "2024-06-02";
const PERIOD_END = "2024-06-08";
const WORKDAYS = ["2024-06-02", "2024-06-03", "2024-06-04", "2024-06-05", "2024-06-06"];
const NO_SHOW_1 = "2024-06-05";
const NO_SHOW_2 = "2024-06-06";

let gradeId: number;
let empId: number;
let periodId: number;
const punchEventIds: number[] = [];

const round2 = (n: number) => Math.round(n * 100) / 100;
const dailyRate = (BASE_SALARY * (1 + HOUSING_PCT / 100 + TRANSPORT_PCT / 100)) / WORKDAYS.length;

async function cleanupRuns(pid: number) {
  const runs = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.payrollPeriodId, pid));
  const runIds = runs.map(r => r.id);
  if (runIds.length) {
    await db.delete(payrollRunLinesTable).where(inArray(payrollRunLinesTable.payrollRunId, runIds));
    await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, runIds));
  }
}

async function getRun(pid: number, eid: number) {
  const runsRes = await request(app).get(`/api/payroll-runs?periodId=${pid}`);
  return runsRes.body.find((r: { employeeId: number }) => r.employeeId === eid);
}

async function getAbsenceLine(runId: number) {
  const detail = await request(app).get(`/api/payroll-runs/${runId}`);
  return detail.body.lines.find((l: { codeEn: string }) => l.codeEn === "ABSENCE");
}

beforeAll(async () => {
  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST Excused Grade",
    nameAr: "درجة اختبار الإعفاء",
    baseSalary: String(BASE_SALARY),
    housingAllowancePct: String(HOUSING_PCT),
    transportAllowancePct: String(TRANSPORT_PCT),
  }).returning();
  gradeId = grade.id;

  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: `T-EXE-${SUFFIX}`,
    firstNameEn: "Test", lastNameEn: "Excused",
    firstNameAr: "اختبار", lastNameAr: "إعفاء",
    nationalId: `TE${SUFFIX}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-excused-${SUFFIX}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
  }).returning();
  empId = emp.id;

  // Punches on the first 3 workdays only → 2 no-show days (06-05, 06-06).
  for (const d of WORKDAYS.slice(0, 3)) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId: empId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-EXCUSED-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-EXPP-${SUFFIX}`,
    nameEn: "TEST Excused Period", nameAr: "فترة اختبار الإعفاء",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2024-06-09",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  if (periodId) {
    await cleanupRuns(periodId);
    await db.delete(payrollExcusedAbsencesTable)
      .where(eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId));
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "payroll_period"),
      eq(auditLogsTable.entityId, periodId),
    ));
    await db.delete(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  }
  if (punchEventIds.length) {
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  }
  if (empId) await db.delete(employeesTable).where(eq(employeesTable.id, empId));
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

describe("payroll excused no-show days", () => {
  let excusedId: number;

  it("lists detected no-show days per employee for the period", async () => {
    const res = await request(app).get(`/api/payroll-periods/${periodId}/no-shows`);
    expect(res.status).toBe(200);
    expect(res.body.periodId).toBe(periodId);
    const entry = res.body.employees.find((e: { employeeId: number }) => e.employeeId === empId);
    expect(entry).toBeDefined();
    const dates = entry.days.map((d: { date: string }) => d.date);
    expect(dates).toEqual([NO_SHOW_1, NO_SHOW_2]);
    expect(entry.days.every((d: { excused: boolean }) => d.excused === false)).toBe(true);
  });

  it("rejects excusing a day that is not a detected no-show, and requires a reason", async () => {
    // Day the employee punched in:
    const attended = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: WORKDAYS[0], reason: "not actually absent" });
    expect(attended.status).toBe(422);

    // Weekend day:
    const weekend = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: "2024-06-07", reason: "weekend" });
    expect(weekend.status).toBe(422);

    // Outside period:
    const outside = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: "2024-05-01", reason: "outside" });
    expect(outside.status).toBe(422);

    // Missing reason:
    const noReason = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: NO_SHOW_1 });
    expect(noReason.status).toBe(400);
  });

  it("excuses a no-show day with a reason and writes an audit log", async () => {
    const res = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: NO_SHOW_1, reason: "Biometric device outage at HQ" });
    expect(res.status).toBe(201);
    expect(res.body.date).toBe(NO_SHOW_1);
    expect(res.body.reason).toBe("Biometric device outage at HQ");
    excusedId = res.body.id;

    // Duplicate excusal is rejected.
    const dup = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: NO_SHOW_1, reason: "again" });
    expect(dup.status).toBe(409);

    // Audit log entry exists.
    const logs = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "payroll.absence_excused"),
      eq(auditLogsTable.entityType, "payroll_period"),
      eq(auditLogsTable.entityId, periodId),
    ));
    expect(logs.length).toBe(1);
    expect(JSON.parse(logs[0].changesJson!)).toMatchObject({
      employeeId: empId, date: NO_SHOW_1, reason: "Biometric device outage at HQ",
    });

    // Reflected in the no-shows listing.
    const list = await request(app).get(`/api/payroll-periods/${periodId}/no-shows`);
    const entry = list.body.employees.find((e: { employeeId: number }) => e.employeeId === empId);
    const day = entry.days.find((d: { date: string }) => d.date === NO_SHOW_1);
    expect(day.excused).toBe(true);
    expect(day.excusedId).toBe(excusedId);
    expect(day.reason).toBe("Biometric device outage at HQ");
  });

  it("skips excused days in the ABSENCE deduction on recalculation", async () => {
    const calc = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(calc.status).toBe(200);

    const run = await getRun(periodId, empId);
    expect(run).toBeDefined();
    // Only the remaining unexcused no-show day is deducted.
    expect(run.absentDays).toBe(1);
    expect(run.presentDays).toBe(WORKDAYS.length - 1);

    const absLine = await getAbsenceLine(run.id);
    expect(absLine).toBeDefined();
    expect(parseFloat(absLine.amount)).toBeCloseTo(round2(1 * dailyRate), 2);
  });

  it("reinstates the deduction after undoing the excusal", async () => {
    const del = await request(app)
      .delete(`/api/payroll-periods/${periodId}/excused-absences/${excusedId}`);
    expect(del.status).toBe(200);

    // Undo audit log exists.
    const logs = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "payroll.absence_unexcused"),
      eq(auditLogsTable.entityId, periodId),
    ));
    expect(logs.length).toBe(1);

    const calc = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(calc.status).toBe(200);

    const run = await getRun(periodId, empId);
    expect(run.absentDays).toBe(2);
    const absLine = await getAbsenceLine(run.id);
    expect(parseFloat(absLine.amount)).toBeCloseTo(round2(2 * dailyRate), 2);
  });

  it("excusing all no-show days removes the ABSENCE line entirely", async () => {
    for (const d of [NO_SHOW_1, NO_SHOW_2]) {
      const res = await request(app)
        .post(`/api/payroll-periods/${periodId}/excused-absences`)
        .send({ employeeId: empId, date: d, reason: "Off-site assignment" });
      expect(res.status).toBe(201);
    }
    const calc = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(calc.status).toBe(200);

    const run = await getRun(periodId, empId);
    expect(run.absentDays).toBe(0);
    expect(run.presentDays).toBe(WORKDAYS.length);
    expect(await getAbsenceLine(run.id)).toBeUndefined();
  });

  it("blocks excusal changes on a closed period", async () => {
    // Walk the period to closed: under_review → first → second → close.
    await request(app).post(`/api/payroll-periods/${periodId}/approve`).send({ note: "t1" });
    await request(app).post(`/api/payroll-periods/${periodId}/approve`).send({ note: "t2" });
    const close = await request(app).post(`/api/payroll-periods/${periodId}/close`);
    expect(close.status).toBe(200);

    const excuseRes = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: empId, date: NO_SHOW_1, reason: "too late" });
    expect(excuseRes.status).toBe(400);

    const [row] = await db.select().from(payrollExcusedAbsencesTable).where(and(
      eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId),
      eq(payrollExcusedAbsencesTable.date, NO_SHOW_1),
    ));
    const delRes = await request(app)
      .delete(`/api/payroll-periods/${periodId}/excused-absences/${row.id}`);
    expect(delRes.status).toBe(400);
  });
});
