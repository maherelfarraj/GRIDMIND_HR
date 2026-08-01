/**
 * No-show warning notifications — when payroll calculation detects unexcused
 * no-show days, the affected employee's system user (and their manager's user)
 * receive an in-app notification so they can dispute before the period closes.
 * Repeated recalculation of the same period must not create duplicates.
 *
 * Uses a dedicated PAST period and dedicated test employees/users/grade;
 * fixtures are removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollExcusedAbsencesTable,
  salaryGradesTable,
  employeesTable,
  punchEventsTable,
  attendanceRecordsTable,
  auditLogsTable,
  systemUsersTable,
  notificationsTable,
  rolesTable,
} from "@workspace/db";
import app from "../app";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-NNG-${SUFFIX}`;

// Past period: Sun 2024-04-07 .. Sat 2024-04-13. Workdays (Sun–Thu): 07..11.
const PERIOD_START = "2024-04-07";
const PERIOD_END = "2024-04-13";
const WORKDAYS = ["2024-04-07", "2024-04-08", "2024-04-09", "2024-04-10", "2024-04-11"];
const NO_SHOW_DAYS = ["2024-04-10", "2024-04-11"]; // absent emp punches first 3 workdays

const HR_DIGEST_TYPE = "payroll_no_show_hr_digest";

let gradeId: number;
let hrRoleId: number;
let hrUserId: number;
let managerEmpId: number;
let lateEmpId: number;
let absentEmpId: number;
let managerUserId: number;
let absentUserId: number;
let periodId: number;
const punchEventIds: number[] = [];
const attendanceIds: number[] = [];

const NOTIF_TYPE = "payroll_no_show";

async function notificationsFor(userId: number) {
  return db.select().from(notificationsTable).where(and(
    eq(notificationsTable.recipientUserId, userId),
    eq(notificationsTable.notificationType, NOTIF_TYPE),
    eq(notificationsTable.entityType, "payroll_period"),
    eq(notificationsTable.entityId, periodId),
  ));
}

beforeAll(async () => {
  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();
  const [role] = await db.select().from(rolesTable).limit(1);
  expect(role).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST NoShow Notify Grade",
    nameAr: "درجة اختبار تنبيه الغياب",
    baseSalary: "9000",
    housingAllowancePct: "20",
    transportAllowancePct: "10",
  }).returning();
  gradeId = grade.id;

  const mkEmp = (n: number, managerId: number | null) => ({
    employeeNumber: `T-NNE-${SUFFIX}-${n}`,
    firstNameEn: "Test", lastNameEn: `NoShowNotify${n}`,
    firstNameAr: "اختبار", lastNameAr: `تنبيه${n}`,
    nationalId: `TNN${SUFFIX}${n}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-nsnotify-${SUFFIX}-${n}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
    managerId,
  });

  const [mgr] = await db.insert(employeesTable).values(mkEmp(1, null)).returning();
  managerEmpId = mgr.id;
  const [emp] = await db.insert(employeesTable).values(mkEmp(2, managerEmpId)).returning();
  absentEmpId = emp.id;
  // Third employee, initially hired AFTER the period so early calculations
  // detect no no-shows. A later test moves the hire date back to make all
  // workdays newly detected no-shows overlapping already-announced dates.
  const [late] = await db.insert(employeesTable).values({ ...mkEmp(3, null), hireDate: "2025-01-01" }).returning();
  lateEmpId = late.id;

  const mkUser = (n: number, employeeId: number) => ({
    username: `t-nsnotify-${SUFFIX}-${n}`,
    email: `t-nsnotify-user-${SUFFIX}-${n}@example.com`,
    fullNameEn: `Test NoShowNotify User ${n}`,
    fullNameAr: `مستخدم اختبار ${n}`,
    roleId: role.id,
    employeeId,
    isActive: true,
  });
  const [mgrUser] = await db.insert(systemUsersTable).values(mkUser(1, managerEmpId)).returning();
  managerUserId = mgrUser.id;
  const [empUser] = await db.insert(systemUsersTable).values(mkUser(2, absentEmpId)).returning();
  absentUserId = empUser.id;

  // HR/admin recipient for the digest — role name must contain "Admin"
  // (the same fanout convention as gateway device alerts).
  const [hrRole] = await db.insert(rolesTable).values({
    nameEn: `TEST NoShow HR Admin ${SUFFIX}`,
    nameAr: `دور اختبار ${SUFFIX}`,
    permissionsJson: "[]",
  }).returning();
  hrRoleId = hrRole.id;
  const [hrUser] = await db.insert(systemUsersTable).values({
    username: `t-nsnotify-hr-${SUFFIX}`,
    email: `t-nsnotify-hr-${SUFFIX}@example.com`,
    fullNameEn: "Test NoShow HR Admin",
    fullNameAr: "مسؤول اختبار",
    roleId: hrRoleId,
    isActive: true,
  }).returning();
  hrUserId = hrUser.id;

  // Manager attends every workday; absent employee punches only the first 3.
  for (const d of WORKDAYS) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId: managerEmpId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-NSNOTIFY-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }
  for (const d of WORKDAYS.slice(0, 3)) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId: absentEmpId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-NSNOTIFY-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-NNP-${SUFFIX}`,
    nameEn: "TEST NoShow Notify Period",
    nameAr: "فترة اختبار تنبيه الغياب",
    periodType: "monthly",
    startDate: PERIOD_START,
    endDate: PERIOD_END,
    payDate: PERIOD_END,
    currency: "SAR",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  if (periodId) {
    await db.delete(notificationsTable).where(and(
      eq(notificationsTable.entityType, "payroll_period"),
      eq(notificationsTable.entityId, periodId),
    ));
    const runs = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.payrollPeriodId, periodId));
    const runIds = runs.map(r => r.id);
    if (runIds.length) {
      await db.delete(payrollRunLinesTable).where(inArray(payrollRunLinesTable.payrollRunId, runIds));
      await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.id, runIds));
    }
    await db.delete(payrollExcusedAbsencesTable).where(eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId));
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "payroll_period"),
      eq(auditLogsTable.entityId, periodId),
    ));
    await db.delete(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  }
  if (punchEventIds.length) await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  if (attendanceIds.length) await db.delete(attendanceRecordsTable).where(inArray(attendanceRecordsTable.id, attendanceIds));
  const userIds = [managerUserId, absentUserId, hrUserId].filter(Boolean);
  if (userIds.length) await db.delete(systemUsersTable).where(inArray(systemUsersTable.id, userIds));
  if (hrRoleId) await db.delete(rolesTable).where(eq(rolesTable.id, hrRoleId));
  const empIds = [managerEmpId, absentEmpId, lateEmpId].filter(Boolean);
  if (empIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, empIds));
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

describe("payroll no-show warning notifications", () => {
  it("notifies the employee and their manager when unexcused no-show days are detected", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);

    const empNotifs = await notificationsFor(absentUserId);
    expect(empNotifs.length).toBe(1);
    expect(empNotifs[0].severity).toBe("warning");
    expect(empNotifs[0].requiresAction).toBe(true);
    for (const d of NO_SHOW_DAYS) expect(empNotifs[0].bodyEn).toContain(d);
    // Only the actual no-show days are mentioned.
    expect(empNotifs[0].bodyEn.match(/\d{4}-\d{2}-\d{2}/g)!.sort()).toEqual(NO_SHOW_DAYS);

    const mgrNotifs = await notificationsFor(managerUserId);
    expect(mgrNotifs.length).toBe(1);
    expect(mgrNotifs[0].bodyEn).toContain(`T-NNE-${SUFFIX}-2`);
    for (const d of NO_SHOW_DAYS) expect(mgrNotifs[0].bodyEn).toContain(d);
  });

  it("does not notify a fully attending employee", async () => {
    const rows = await db.select().from(notificationsTable).where(and(
      eq(notificationsTable.recipientUserId, managerUserId),
      eq(notificationsTable.notificationType, NOTIF_TYPE),
      eq(notificationsTable.entityId, periodId),
      eq(notificationsTable.recipientEmployeeId, managerEmpId),
    ));
    // The manager's only notification is about their report, not themselves.
    for (const row of rows) expect(row.bodyEn).toContain(`T-NNE-${SUFFIX}-2`);
  });

  it("does not create duplicates on recalculation of the same period", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);

    expect((await notificationsFor(absentUserId)).length).toBe(1);
    expect((await notificationsFor(managerUserId)).length).toBe(1);
  });

  it("does not re-notify excused days, and no new notification when nothing new", async () => {
    // HR excuses one of the two days, then recalculates.
    const ex = await request(app)
      .post(`/api/payroll-periods/${periodId}/excused-absences`)
      .send({ employeeId: absentEmpId, date: NO_SHOW_DAYS[0], reason: "TEST excuse" });
    expect(ex.status).toBe(201);

    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);

    // Remaining unexcused day was already announced — still exactly one each.
    expect((await notificationsFor(absentUserId)).length).toBe(1);
    expect((await notificationsFor(managerUserId)).length).toBe(1);
  });
});

describe("payroll no-show HR digest", () => {
  async function hrDigests() {
    return db.select().from(notificationsTable).where(and(
      eq(notificationsTable.recipientUserId, hrUserId),
      eq(notificationsTable.notificationType, HR_DIGEST_TYPE),
      eq(notificationsTable.entityType, "payroll_period"),
      eq(notificationsTable.entityId, periodId),
    ));
  }

  it("sent HR a single digest listing the affected employee and dates", async () => {
    // Calculation already ran three times in the previous describe block —
    // HR must still have exactly one digest for the period.
    const digests = await hrDigests();
    expect(digests.length).toBe(1);
    const d = digests[0];
    expect(d.severity).toBe("warning");
    expect(d.requiresAction).toBe(true);
    expect(d.bodyEn).toContain(`[T-NNE-${SUFFIX}-2]`);
    // Both originally detected days were announced (one was excused only
    // after the first calculation).
    for (const day of NO_SHOW_DAYS) expect(d.bodyEn).toContain(day);
    // The fully attending manager is not listed.
    expect(d.bodyEn).not.toContain(`[T-NNE-${SUFFIX}-1]`);
  });

  it("does not create a duplicate digest on recalculation", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);
    expect((await hrDigests()).length).toBe(1);
  });

  it("announces a new employee's no-shows even when the dates were already announced for someone else", async () => {
    // Employee 3 becomes retroactively employed: every workday is now an
    // unexcused no-show, all overlapping dates already announced for emp 2.
    await db.update(employeesTable).set({ hireDate: "2020-01-01" }).where(eq(employeesTable.id, lateEmpId));

    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);

    const digests = await hrDigests();
    expect(digests.length).toBe(2);
    const latest = digests.sort((a, b) => a.id - b.id)[1];
    // New digest lists only the new employee — emp 2's pairs stay announced.
    expect(latest.bodyEn).toContain(`[T-NNE-${SUFFIX}-3]`);
    expect(latest.bodyEn).not.toContain(`[T-NNE-${SUFFIX}-2]`);
    for (const d of WORKDAYS) expect(latest.bodyEn).toContain(d);
  });

  it("does not re-announce after removing an excuse for an already-announced date", async () => {
    // NO_SHOW_DAYS[0] was excused for emp 2 after being announced. Removing
    // the excuse makes it unexcused again — but it was already announced, so
    // recalculation must not create a new digest.
    const list = await request(app).get(`/api/payroll-periods/${periodId}/no-shows`);
    expect(list.status).toBe(200);
    const emp2 = list.body.employees.find((e: { employeeId: number }) => e.employeeId === absentEmpId);
    const excusedDay = emp2.days.find((d: { excused: boolean }) => d.excused);
    expect(excusedDay).toBeDefined();
    const del = await request(app).delete(`/api/payroll-periods/${periodId}/excused-absences/${excusedDay.excusedId}`);
    expect(del.status).toBe(200);

    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);
    expect((await hrDigests()).length).toBe(2);
  });

  it("stays duplicate-free under concurrent recalculations", async () => {
    const before = (await hrDigests()).length;
    const results = await Promise.all([
      request(app).post(`/api/payroll-periods/${periodId}/calculate`),
      request(app).post(`/api/payroll-periods/${periodId}/calculate`),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    expect((await hrDigests()).length).toBe(before);
  });
});
