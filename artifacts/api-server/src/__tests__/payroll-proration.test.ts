/**
 * Proration tests — employees hired or terminated inside a payroll period are
 * paid base salary and allowances only for the working days they were employed.
 *
 * Uses a dedicated past period and dedicated test employees/grade/contract;
 * all fixtures are removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inArray, eq, and, sql as sqlRaw } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  payComponentsTable,
} from "@workspace/db";
import app from "../app";
import { WEEKEND_CONFIG_KEY } from "../routes/payrollPeriods.js";

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

// Fixed pay components: a recurring stipend (prorated) and a one-time payment (not prorated).
const STIPEND_CODE = `T-STIP-${SUFFIX}`;
const ONETIME_CODE = `T-ONCE-${SUFFIX}`;
const STIPEND_AMOUNT = 500;
const ONETIME_AMOUNT = 300;
const componentIds: number[] = [];

let gradeId: number;
let empFullId: number;
let empHireId: number;
let empLeaverId: number;
let empRehireId: number;
const contractIds: number[] = [];
let periodId: number;
const punchEventIds: number[] = [];
// Weekend config state — saved before the test, restored after.
let prevWeekendConfig: string | null = null;

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
  // Pin weekend to Fri+Sat ([5,6]) so test assertions are deterministic
  // regardless of what the DB config was set to by other tests or seeds.
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
  }).onConflictDoUpdate({
    target: systemConfigTable.key,
    set: { value: "[5,6]" },
  });

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

  // Fixed pay components — recurring stipend vs one-time payment.
  const [stipend] = await db.insert(payComponentsTable).values({
    codeEn: STIPEND_CODE,
    nameEn: "TEST Recurring Stipend", nameAr: "بدل شهري اختبار",
    type: "earning", calculationMethod: "fixed", value: String(STIPEND_AMOUNT),
    isRecurring: true, applicableTo: "all", isActive: true,
  }).returning();
  componentIds.push(stipend.id);
  const [onetime] = await db.insert(payComponentsTable).values({
    codeEn: ONETIME_CODE,
    nameEn: "TEST One-Time Payment", nameAr: "دفعة لمرة واحدة اختبار",
    type: "earning", calculationMethod: "fixed", value: String(ONETIME_AMOUNT),
    isRecurring: false, applicableTo: "all", isActive: true,
  }).returning();
  componentIds.push(onetime.id);

  const [period] = await db.insert(payrollPeriodsTable).values({
    periodCode: `T-PRPP-${SUFFIX}`,
    nameEn: "TEST Prorate Period", nameAr: "فترة اختبار التناسب",
    startDate: PERIOD_START, endDate: PERIOD_END, payDate: "2024-03-10",
    status: "draft",
  }).returning();
  periodId = period.id;
});

afterAll(async () => {
  // Restore previous weekend config, or delete the key if it didn't exist before
  if (prevWeekendConfig !== null) {
    await db.update(systemConfigTable)
      .set({ value: prevWeekendConfig })
      .where(eq(systemConfigTable.key, WEEKEND_CONFIG_KEY));
  } else {
    await db.delete(systemConfigTable)
      .where(eq(systemConfigTable.key, WEEKEND_CONFIG_KEY));
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
  if (contractIds.length) await db.delete(employmentContractsTable).where(inArray(employmentContractsTable.id, contractIds));
  if (punchEventIds.length) {
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchEventIds));
  }
  const empIds = [empFullId, empHireId, empLeaverId, empRehireId].filter(Boolean);
  if (empIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, empIds));
  if (gradeId) await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, gradeId));
  if (componentIds.length) await db.delete(payComponentsTable).where(inArray(payComponentsTable.id, componentIds));
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

  it("prorates a fixed recurring stipend for a mid-period hire but pays a one-time component in full", async () => {
    const { lines } = await getRunAndLines(empHireId);
    const factor = 3 / 5;
    const stipend = lines.find(l => l.codeEn === STIPEND_CODE)!;
    const onetime = lines.find(l => l.codeEn === ONETIME_CODE)!;
    expect(stipend).toBeDefined();
    expect(onetime).toBeDefined();
    expect(parseFloat(stipend.amount)).toBeCloseTo(round2(STIPEND_AMOUNT * factor), 2);
    expect(stipend.nameEn).toContain("Prorated 3/5 days");
    expect(parseFloat(onetime.amount)).toBeCloseTo(ONETIME_AMOUNT, 2);
    expect(onetime.nameEn).not.toContain("Prorated");
  });

  it("pays a full-period employee the fixed recurring stipend in full", async () => {
    const { lines } = await getRunAndLines(empFullId);
    const stipend = lines.find(l => l.codeEn === STIPEND_CODE)!;
    expect(parseFloat(stipend.amount)).toBeCloseTo(STIPEND_AMOUNT, 2);
    expect(stipend.nameEn).not.toContain("Prorated");
  });

  it("persists the isRecurring flag through the pay-components API", async () => {
    const code = `T-API-${SUFFIX}`;
    const created = await request(app).post("/api/pay-components").send({
      codeEn: code, nameEn: "TEST API One-Time", nameAr: "اختبار لمرة واحدة",
      type: "earning", calculationMethod: "fixed", value: 100,
      isRecurring: false, isActive: false,
    });
    expect(created.status).toBe(201);
    componentIds.push(created.body.id);
    expect(created.body.isRecurring).toBe(false);

    const patched = await request(app).patch(`/api/pay-components/${created.body.id}`).send({ isRecurring: true });
    expect(patched.status).toBe(200);
    expect(patched.body.isRecurring).toBe(true);

    // Default is recurring when the flag is omitted.
    const defaulted = await request(app).post("/api/pay-components").send({
      codeEn: `${code}-D`, nameEn: "TEST API Default", nameAr: "اختبار افتراضي",
      type: "earning", calculationMethod: "fixed", value: 100, isActive: false,
    });
    expect(defaulted.status).toBe(201);
    componentIds.push(defaulted.body.id);
    expect(defaulted.body.isRecurring).toBe(true);
  });

  it("applies the is_recurring startup migration idempotently", async () => {
    // The committed migration must be safe to re-run against an already
    // migrated database (the startup runner executes every file on every boot).
    const migrationPath = path.resolve(__dirname, "../../../../lib/db/migrations/004_pay_components_is_recurring.sql");
    const ddl = readFileSync(migrationPath, "utf8");
    await db.execute(sqlRaw.raw(ddl));
    await db.execute(sqlRaw.raw(ddl));
    const result = await db.execute(sqlRaw`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'pay_components' AND column_name = 'is_recurring'
    `);
    const rows = result.rows as { column_default: string; is_nullable: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].column_default).toBe("true");
    expect(rows[0].is_nullable).toBe("NO");
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
