/**
 * Proration tests — employees hired or terminated inside a payroll period are
 * paid base salary and allowances only for the working days they were employed.
 *
 * Uses a dedicated past period and dedicated test employees/grade/contract;
 * all fixtures are removed in afterAll.
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
} from "@workspace/db";
import app from "../app";

const SUFFIX = `${Date.now() % 1000000}`;
const GRADE_CODE = `T-PRG-${SUFFIX}`;

const BASE_SALARY = 10000;
const HOUSING_PCT = 25;
const TRANSPORT_PCT = 10;
const HOUSING = BASE_SALARY * (HOUSING_PCT / 100);
const TRANSPORT = BASE_SALARY * (TRANSPORT_PCT / 100);

// Past period: Sun 2024-03-03 .. Sat 2024-03-09.
// Workdays (Sun–Thu): 03, 04, 05, 06, 07. Fri 08 / Sat 09 are weekend.
const PERIOD_START = "2024-03-03";
const PERIOD_END = "2024-03-09";
const WORKDAYS = ["2024-03-03", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07"];

// Mid-period hire: starts Tue 2024-03-05 → employed 3 of 5 workdays.
const HIRE_DATE_MID = "2024-03-05";
// Mid-period leaver: terminated Tue 2024-03-05 → employed 3 of 5 workdays (03, 04, 05).
const TERMINATION_DATE = "2024-03-05";

let gradeId: number;
let empFullId: number;
let empHireId: number;
let empLeaverId: number;
let empRehireId: number;
const contractIds: number[] = [];
let periodId: number;
const punchEventIds: number[] = [];

const round2 = (n: number) => Math.round(n * 100) / 100;

async function addPunches(employeeId: number, days: string[]) {
  for (const d of days) {
    const [ev] = await db.insert(punchEventsTable).values({
      employeeId,
      eventTime: new Date(`${d}T08:00:00Z`),
      eventType: "CLOCK_IN",
      source: "MANUAL",
      notes: `TEST-PRORATE-${SUFFIX}`,
    }).returning();
    punchEventIds.push(ev.id);
  }
}

beforeAll(async () => {
  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  expect(seedEmp).toBeDefined();

  const [grade] = await db.insert(salaryGradesTable).values({
    gradeCode: GRADE_CODE,
    nameEn: "TEST Prorate Grade",
    nameAr: "درجة اختبار التناسب",
    baseSalary: String(BASE_SALARY),
    housingAllowancePct: String(HOUSING_PCT),
    transportAllowancePct: String(TRANSPORT_PCT),
  }).returning();
  gradeId = grade.id;

  const mkEmp = (n: number, hireDate: string) => ({
    employeeNumber: `T-PRE-${SUFFIX}-${n}`,
    firstNameEn: "Test", lastNameEn: `Prorate${n}`,
    firstNameAr: "اختبار", lastNameAr: `تناسب${n}`,
    nationalId: `TP${SUFFIX}${n}`,
    jobTitleEn: "Test Engineer", jobTitleAr: "مهندس اختبار",
    departmentId: seedEmp.departmentId,
    roleId: seedEmp.roleId,
    status: "active",
    grade: GRADE_CODE,
    email: `test-prorate-${SUFFIX}-${n}@example.com`,
    hireDate,
    nationality: "SA",
  });

  const [eFull] = await db.insert(employeesTable).values(mkEmp(1, "2020-01-01")).returning();
  const [eHire] = await db.insert(employeesTable).values(mkEmp(2, HIRE_DATE_MID)).returning();
  const [eLeaver] = await db.insert(employeesTable).values(mkEmp(3, "2020-01-01")).returning();
  const [eRehire] = await db.insert(employeesTable).values(mkEmp(4, "2020-01-01")).returning();
  empFullId = eFull.id;
  empHireId = eHire.id;
  empLeaverId = eLeaver.id;
  empRehireId = eRehire.id;

  // Terminated contract for the leaver.
  const [contract] = await db.insert(employmentContractsTable).values({
    contractNumber: `T-PRC-${SUFFIX}`,
    employeeId: empLeaverId,
    offerId: 0,
    startDate: "2020-01-01",
    status: "terminated",
    terminationDate: TERMINATION_DATE,
    terminationReason: "TEST fixture — resignation",
  }).returning();
  contractIds.push(contract.id);

  // Rehire: an old terminated contract PLUS a current active contract — must be paid in full.
  const [oldContract] = await db.insert(employmentContractsTable).values({
    contractNumber: `T-PRC-${SUFFIX}-OLD`,
    employeeId: empRehireId,
    offerId: 0,
    startDate: "2020-01-01",
    status: "terminated",
    terminationDate: "2023-06-30",
    terminationReason: "TEST fixture — old contract",
  }).returning();
  contractIds.push(oldContract.id);
  const [activeContract] = await db.insert(employmentContractsTable).values({
    contractNumber: `T-PRC-${SUFFIX}-NEW`,
    employeeId: empRehireId,
    offerId: 0,
    startDate: "2023-07-01",
    status: "active",
  }).returning();
  contractIds.push(activeContract.id);

  // Punches so nobody accrues no-show deductions inside their employment window.
  await addPunches(empFullId, WORKDAYS);
  await addPunches(empHireId, WORKDAYS.slice(2));   // 05, 06, 07
  await addPunches(empLeaverId, WORKDAYS.slice(0, 3)); // 03, 04, 05
  await addPunches(empRehireId, WORKDAYS);

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-PRPP-${SUFFIX}`,
    nameEn: "TEST Prorate Period", nameAr: "فترة اختبار التناسب",
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
  if (contractIds.length) await db.delete(employmentContractsTable).where(inArray(employmentContractsTable.id, contractIds));
  if (punchEventIds.length) {
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  }
  const empIds = [empFullId, empHireId, empLeaverId, empRehireId].filter(Boolean);
  if (empIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, empIds));
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
});

type Line = { codeEn: string; nameEn: string; amount: string; type: string };

async function getRunAndLines(employeeId: number) {
  const runsRes = await request(app).get(`/api/payroll-runs?periodId=${periodId}`);
  const run = runsRes.body.find((r: { employeeId: number }) => r.employeeId === employeeId);
  expect(run).toBeDefined();
  const detail = await request(app).get(`/api/payroll-runs/${run.id}`);
  return { run, lines: detail.body.lines as Line[] };
}

describe("payroll proration for mid-period hires and leavers", () => {
  it("calculates the period", async () => {
    const res = await request(app).post(`/api/payroll-periods/${periodId}/calculate`);
    expect(res.status).toBe(200);
  });

  it("pays a full-period employee the full base salary and allowances", async () => {
    const { run, lines } = await getRunAndLines(empFullId);
    const base = lines.find(l => l.codeEn === "BASE")!;
    const housing = lines.find(l => l.codeEn === "HOUSING")!;
    const transport = lines.find(l => l.codeEn === "TRANSPORT")!;
    expect(parseFloat(base.amount)).toBeCloseTo(BASE_SALARY, 2);
    expect(parseFloat(housing.amount)).toBeCloseTo(HOUSING, 2);
    expect(parseFloat(transport.amount)).toBeCloseTo(TRANSPORT, 2);
    expect(base.nameEn).not.toContain("Prorated");
    expect(run.presentDays).toBe(WORKDAYS.length);
    expect(run.absentDays).toBe(0);
  });

  it("prorates base salary and allowances for a mid-period hire", async () => {
    const { run, lines } = await getRunAndLines(empHireId);
    const factor = 3 / 5; // employed Tue–Thu of 5 workdays
    const base = lines.find(l => l.codeEn === "BASE")!;
    const housing = lines.find(l => l.codeEn === "HOUSING")!;
    const transport = lines.find(l => l.codeEn === "TRANSPORT")!;
    expect(parseFloat(base.amount)).toBeCloseTo(round2(BASE_SALARY * factor), 2);
    expect(parseFloat(housing.amount)).toBeCloseTo(round2(HOUSING * factor), 2);
    expect(parseFloat(transport.amount)).toBeCloseTo(round2(TRANSPORT * factor), 2);
    // Payslip line items say so explicitly.
    expect(base.nameEn).toContain("Prorated 3/5 days");
    expect(housing.nameEn).toContain("Prorated 3/5 days");
    expect(transport.nameEn).toContain("Prorated 3/5 days");
    // Days before hire are not counted as no-shows or absences.
    expect(run.absentDays).toBe(0);
    expect(run.presentDays).toBe(3);
    expect(run.exceptionNote).toContain("Prorated");
  });

  it("prorates base salary and allowances for a mid-period leaver (terminated contract)", async () => {
    const { run, lines } = await getRunAndLines(empLeaverId);
    const factor = 3 / 5; // employed Sun–Tue of 5 workdays
    const base = lines.find(l => l.codeEn === "BASE")!;
    const housing = lines.find(l => l.codeEn === "HOUSING")!;
    const transport = lines.find(l => l.codeEn === "TRANSPORT")!;
    expect(parseFloat(base.amount)).toBeCloseTo(round2(BASE_SALARY * factor), 2);
    expect(parseFloat(housing.amount)).toBeCloseTo(round2(HOUSING * factor), 2);
    expect(parseFloat(transport.amount)).toBeCloseTo(round2(TRANSPORT * factor), 2);
    expect(base.nameEn).toContain("Prorated 3/5 days");
    // Days after termination are not counted as no-shows.
    expect(run.absentDays).toBe(0);
    expect(run.presentDays).toBe(3);
  });

  it("pays a rehired employee (old terminated contract + current active contract) in full", async () => {
    const { run, lines } = await getRunAndLines(empRehireId);
    const base = lines.find(l => l.codeEn === "BASE")!;
    expect(parseFloat(base.amount)).toBeCloseTo(BASE_SALARY, 2);
    expect(base.nameEn).not.toContain("Prorated");
    expect(run.presentDays).toBe(WORKDAYS.length);
    expect(run.absentDays).toBe(0);
    const { run: full } = await getRunAndLines(empFullId);
    expect(parseFloat(run.netSalary)).toBeCloseTo(parseFloat(full.netSalary), 2);
  });

  it("hire and leaver with the same employed-day count net the same pay", async () => {
    const { run: hire } = await getRunAndLines(empHireId);
    const { run: leaver } = await getRunAndLines(empLeaverId);
    expect(parseFloat(hire.netSalary)).toBeCloseTo(parseFloat(leaver.netSalary), 2);
    // And strictly less than the full-period employee.
    const { run: full } = await getRunAndLines(empFullId);
    expect(parseFloat(hire.netSalary)).toBeLessThan(parseFloat(full.netSalary));
  });
});
