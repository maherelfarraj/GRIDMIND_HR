import { Router } from "express";
import { db, payrollRunsTable, payrollRunLinesTable, payrollPeriodsTable, employeesTable, departmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /payroll-runs?periodId=&employeeId=&status=&hasException=
router.get("/payroll-runs", async (req, res): Promise<void> => {
  const { periodId, employeeId, status, hasException } = req.query as Record<string, string>;

  const conditions = [];
  if (periodId) conditions.push(eq(payrollRunsTable.payrollPeriodId, parseInt(periodId, 10)));
  if (employeeId) conditions.push(eq(payrollRunsTable.employeeId, parseInt(employeeId, 10)));
  if (status) conditions.push(eq(payrollRunsTable.status, status));
  if (hasException === "true") conditions.push(eq(payrollRunsTable.hasException, true));

  const runs = conditions.length > 0
    ? await db.select().from(payrollRunsTable).where(and(...conditions))
    : await db.select().from(payrollRunsTable);

  const emps = await db.select().from(employeesTable);
  const depts = await db.select().from(departmentsTable);
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
  const deptMap = Object.fromEntries(depts.map(d => [d.id, d]));

  const enriched = runs.map(r => {
    const emp = empMap[r.employeeId];
    const dept = emp ? deptMap[emp.departmentId] : null;
    return {
      ...r,
      employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
      employeeNumber: emp?.employeeNumber ?? "",
      jobTitleEn: emp?.jobTitleEn ?? "",
      departmentNameEn: dept?.nameEn ?? "",
      grade: emp?.grade ?? null,
      calculatedAt: r.calculatedAt ? r.calculatedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  res.json(enriched);
});

// GET /payroll-runs/:id — full run detail with lines
router.get("/payroll-runs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db.select().from(payrollRunLinesTable)
    .where(eq(payrollRunLinesTable.payrollRunId, id))
    .orderBy(payrollRunLinesTable.sortOrder);

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, run.employeeId));
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.payrollPeriodId));

  res.json({
    ...run,
    employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
    employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
    employeeNumber: emp?.employeeNumber ?? "",
    jobTitleEn: emp?.jobTitleEn ?? "",
    jobTitleAr: emp?.jobTitleAr ?? "",
    nationalId: emp?.nationalId ?? "",
    periodNameEn: period?.nameEn ?? "",
    periodNameAr: period?.nameAr ?? "",
    periodStartDate: period?.startDate ?? "",
    periodEndDate: period?.endDate ?? "",
    payDate: period?.payDate ?? "",
    currency: run.currency,
    lines,
    calculatedAt: run.calculatedAt ? run.calculatedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
  });
});

// PATCH /payroll-runs/:id — update exception note or status
router.patch("/payroll-runs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  // Check if period is closed
  const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Not found" }); return; }

  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.payrollPeriodId));
  if (period?.isClosed) { res.status(400).json({ error: "Cannot modify a run in a closed period" }); return; }

  const { exceptionNote, hasException, status } = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (exceptionNote !== undefined) updateData.exceptionNote = exceptionNote;
  if (hasException !== undefined) updateData.hasException = hasException;
  if (status !== undefined) updateData.status = status;

  const [updated] = await db.update(payrollRunsTable).set(updateData)
    .where(eq(payrollRunsTable.id, id)).returning();
  res.json(updated);
});

// GET /payroll-runs/:id/payslip — payslip-ready view
router.get("/payroll-runs/:id/payslip", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db.select().from(payrollRunLinesTable)
    .where(eq(payrollRunLinesTable.payrollRunId, id))
    .orderBy(payrollRunLinesTable.sortOrder);

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, run.employeeId));
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.payrollPeriodId));
  const [dept] = emp ? await db.select().from(departmentsTable).where(eq(departmentsTable.id, emp.departmentId)) : [null];

  const earnings = lines.filter(l => l.type === "earning");
  const deductions = lines.filter(l => l.type === "deduction");

  res.json({
    runId: run.id,
    employee: {
      id: emp?.id,
      employeeNumber: emp?.employeeNumber ?? "",
      fullNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      fullNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
      jobTitleEn: emp?.jobTitleEn ?? "",
      jobTitleAr: emp?.jobTitleAr ?? "",
      nationalId: emp?.nationalId ?? "",
      grade: emp?.grade ?? null,
      departmentNameEn: dept?.nameEn ?? "",
      departmentNameAr: dept?.nameAr ?? "",
    },
    period: {
      periodCode: period?.periodCode ?? "",
      nameEn: period?.nameEn ?? "",
      nameAr: period?.nameAr ?? "",
      startDate: period?.startDate ?? "",
      endDate: period?.endDate ?? "",
      payDate: period?.payDate ?? "",
    },
    summary: {
      baseSalary: run.baseSalary,
      grossSalary: run.grossSalary,
      totalEarnings: run.totalEarnings,
      totalDeductions: run.totalDeductions,
      netSalary: run.netSalary,
      overtimeHours: run.overtimeHours,
      overtimePay: run.overtimePay,
      workingDays: run.workingDays,
      presentDays: run.presentDays,
      currency: run.currency,
    },
    earnings,
    deductions,
    hasException: run.hasException,
    exceptionNote: run.exceptionNote,
    calculatedAt: run.calculatedAt ? run.calculatedAt.toISOString() : null,
  });
});

export default router;
