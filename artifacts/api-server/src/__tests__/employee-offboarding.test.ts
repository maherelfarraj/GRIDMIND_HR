/**
 * Offboarding tests — HR records an explicit last working day on the employee
 * record; status transitions are tied to that date, and payroll proration
 * prefers it over contract-derived termination dates.
 *
 * Uses dedicated fixtures cleaned up in afterAll.
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
  auditLogsTable,
  employmentContractsTable,
  systemConfigTable,
} from "@workspace/db";
import app from "../app";
import { WEEKEND_CONFIG_KEY } from "../routes/payrollPeriods.js";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-OFG-${SUFFIX}`;
const BASE_SALARY = 10000;

// Past period: Sun 2024-03-03 .. Sat 2024-03-09; Fri/Sat weekend → 5 workdays.
const PERIOD_START = "2024-03-03";
const PERIOD_END = "2024-03-09";
const WORKDAYS = ["2024-03-03", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07"];

let gradeId: number;
let empExplicitId: number;   // terminated status + explicit terminationDate, NO contract
let empPreferId: number;     // explicit terminationDate that differs from contract's
let empPatchId: number;      // exercised via the PATCH API
let contractId: number;
let periodId: number;
const punchEventIds: number[] = [];
let prevWeekendConfig: string | null = null;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function addPunches(employeeId: number, days: string[]) {
  for (const d of days) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-OFFBOARD-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }
}

beforeAll(async () => {
  const [existing] = await db.select().from(systemConfigTable)
    .where(eq(systemConfigTable.key, WEEKEND_CONFIG_KEY));
  prevWeekendConfig = existing?.value ?? null;
  await db.insert(systemConfigTable).values({
    key: WEEKEND_CONFIG_KEY,
    value: "[5,6]",
    valueType: "json",
    category: "payroll",
    labelEn: "Weekend Days",
    labelAr: "أيام عطلة نهاية الأسبوع",
    isPublic: true,
    isReadonly: false,
  }).onConflictDoUpdate({ target: systemConfigTable.key, set: { value: "[5,6]" } });

  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST Offboard Grade",
    nameAr: "درجة اختبار إنهاء الخدمة",
    baseSalary: String(BASE_SALARY),
    housingAllowancePct: "25",
    transportAllowancePct: "10",
  }).returning();
  gradeId = grade.id;

  const mkEmp = (n: number, extra: Record<string, unknown> = {}) => ({
    employeeNumber: `T-OFB-${SUFFIX}-${n}`,
    firstNameEn: "Test", lastNameEn: `Offboard${n}`,
    firstNameAr: "اختبار", lastNameAr: `إنهاء${n}`,
    nationalId: `TO${SUFFIX}${n}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-offboard-${SUFFIX}-${n}@example.com`,
    hireDate: "2020-01-01",
    nationality: "SA",
    ...extra,
  });

  // 1) Terminated with an explicit last working day but NO terminated contract.
  //    Previously this employee silently dropped out of payroll.
  const [e1] = await db.insert(employeesTable).values(
    mkEmp(1, { status: "terminated", terminationDate: "2024-03-05" })
  ).returning();
  empExplicitId = e1.id;

  // 2) Explicit date (Mon 03-04, → 2 workdays) that must beat a contract saying 03-06.
  const [e2] = await db.insert(employeesTable).values(
    mkEmp(2, { terminationDate: "2024-03-04" })
  ).returning();
  empPreferId = e2.id;
  const [contract] = await db.insert(employmentContractsTable).values({
    contractNumber: `T-OFC-${SUFFIX}`,
    employeeId: empPreferId,
    offerId: 0,
    startDate: "2020-01-01",
    status: "terminated",
    terminationDate: "2024-03-06",
    terminationReason: "TEST fixture",
  }).returning();
  contractId = contract.id;

  // 3) Plain active employee, offboarded through the PATCH API in the tests.
  const [e3] = await db.insert(employeesTable).values(mkEmp(3)).returning();
  empPatchId = e3.id;

  await addPunches(empExplicitId, WORKDAYS.slice(0, 3)); // 03, 04, 05
  await addPunches(empPreferId, WORKDAYS.slice(0, 2));   // 03, 04

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-OFPP-${SUFFIX}`,
    nameEn: "TEST Offboard Period", nameAr: "فترة اختبار إنهاء الخدمة",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2024-03-10",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  if (prevWeekendConfig !== null) {
    await db.update(systemConfigTable).set({ value: prevWeekendConfig })
      .where(eq(systemConfigTable.key, WEEKEND_CONFIG_KEY));
  } else {
    await db.delete(systemConfigTable).where(eq(systemConfigTable.key, WEEKEND_CONFIG_KEY));
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
  if (contractId) await db.delete(employmentContractsTable).where(eq(employmentContractsTable.id, contractId));
  if (punchEventIds.length) await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  const empIds = [empExplicitId, empPreferId, empPatchId].filter(Boolean);
  if (empIds.length) {
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "employee"),
      inArray(auditLogsTable.entityId, empIds),
    ));
    await db.delete(employeesTable).where(inArray(employeesTable.id, empIds));
  }
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

type Line = { codeEn: string; nameEn: string; amount: string; type: string };

async function getRunAndLines(employeeId: number) {
  const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
  const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === employeeId);
  return run
    ? { run, lines: (await request(app).get(`/api/payroll-runs/${run.id}`)).body.lines as Line[] }
    : { run: undefined, lines: [] as Line[] };
}

describe("offboarding API — status transitions tied to last working day", () => {
  it("rejects marking an employee terminated without a last working day", async () => {
    const res = await request(app).patch(`/api/employees/${empPatchId}`)
      .send({ status: "terminated" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terminationDate/i);
  });

  it("setting a past last working day flips an active employee to terminated", async () => {
    const res = await request(app).patch(`/api/employees/${empPatchId}`)
      .send({ terminationDate: "2024-03-05" });
    expect(res.status).toBe(200);
    expect(res.body.terminationDate).toBe("2024-03-05");
    expect(res.body.status).toBe("terminated");
  });

  it("clearing the last working day reinstates the employee", async () => {
    const res = await request(app).patch(`/api/employees/${empPatchId}`)
      .send({ terminationDate: null });
    expect(res.status).toBe(200);
    expect(res.body.terminationDate).toBeNull();
    expect(res.body.status).toBe("active");
  });

  it("a future last working day does not flip status yet", async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const res = await request(app).patch(`/api/employees/${empPatchId}`)
      .send({ terminationDate: future });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    // reset for cleanliness
    await request(app).patch(`/api/employees/${empPatchId}`).send({ terminationDate: null });
  });

  it("rejects explicitly marking terminated while the last working day is in the future", async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const res = await request(app).patch(`/api/employees/${empPatchId}`)
      .send({ status: "terminated", terminationDate: future });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/before their last working day/i);
  });

  it("rejects forcing status back to active while a past last working day is recorded", async () => {
    await request(app).patch(`/api/employees/${empPatchId}`).send({ terminationDate: "2024-03-05" });
    const res = await request(app).patch(`/api/employees/${empPatchId}`)
      .send({ status: "active" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/clear the terminationDate/i);
    await request(app).patch(`/api/employees/${empPatchId}`).send({ terminationDate: null });
  });

  it("an active employee whose future date has since passed is reconciled to terminated on read", async () => {
    // Simulate a previously future-dated offboarding whose date has now passed:
    // write the row directly (bypassing the PATCH state machine).
    await db.update(employeesTable)
      .set({ status: "active", terminationDate: "2024-03-05" })
      .where(eq(employeesTable.id, empPatchId));
    const res = await request(app).get(`/api/employees/${empPatchId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("terminated");
    await request(app).patch(`/api/employees/${empPatchId}`).send({ terminationDate: null });
  });

  it("the committed migration is idempotent against an already-migrated database", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { sql } = await import("drizzle-orm");
    const { fileURLToPath } = await import("url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const ddl = fs.readFileSync(
      path.resolve(here, "../../../../lib/db/migrations/005_employees_termination_date.sql"),
      "utf8",
    );
    // Column already exists — running the migration again must be a no-op.
    await db.execute(sql.raw(ddl));
    await db.execute(sql.raw(ddl));
    const [row] = await db.select().from(employeesTable).limit(1);
    expect(row).toHaveProperty("terminationDate");
  });

  it("returns terminationDate on GET", async () => {
    const res = await request(app).get(`/api/employees/${empExplicitId}`);
    expect(res.status).toBe(200);
    expect(res.body.terminationDate).toBe("2024-03-05");
  });
});

describe("payroll uses the explicit last working day", () => {
  it("calculates the period", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);
  });

  it("pays a terminated employee (no contract) prorated instead of dropping them", async () => {
    const { run, lines } = await getRunAndLines(empExplicitId);
    expect(run).toBeDefined();
    const base = lines.find(l => l.codeEn === "BASE")!;
    // employed 03, 04, 05 of 5 workdays
    expect(parseFloat(base.amount)).toBeCloseTo(round2(BASE_SALARY * 3 / 5), 2);
    expect(base.nameEn).toContain("Prorated 3/5 days");
    expect(run.absentDays).toBe(0);
  });

  it("prefers the employee's explicit date over the contract-derived one", async () => {
    const { run, lines } = await getRunAndLines(empPreferId);
    expect(run).toBeDefined();
    const base = lines.find(l => l.codeEn === "BASE")!;
    // explicit 2024-03-04 (2/5 days) beats contract's 2024-03-06 (4/5 days)
    expect(parseFloat(base.amount)).toBeCloseTo(round2(BASE_SALARY * 2 / 5), 2);
    expect(base.nameEn).toContain("Prorated 2/5 days");
    expect(run.absentDays).toBe(0);
  });
});
