import { Router } from "express";
import {
  db, payrollPeriodsTable, payrollRunsTable, payrollRunLinesTable,
  employeesTable, salaryGradesTable, payComponentsTable, auditLogsTable,
  overtimeRulesTable, punchEventsTable, leaveRequestsTable, leaveTypesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";

/** Count days of a leave request that fall inside [periodStart, periodEnd] (inclusive, date strings). */
function overlapDays(leaveStart: string, leaveEnd: string, periodStart: string, periodEnd: string, halfDay: boolean): number {
  const start = leaveStart > periodStart ? leaveStart : periodStart;
  const end = leaveEnd < periodEnd ? leaveEnd : periodEnd;
  if (start > end) return 0;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (halfDay && days === 1) return 0.5;
  return days;
}

const router = Router();

// GET /payroll-periods?status=&year=
router.get("/payroll-periods", async (req, res): Promise<void> => {
  const { status, year } = req.query as Record<string, string>;
  let rows = await db.select().from(payrollPeriodsTable).orderBy(payrollPeriodsTable.startDate);
  if (status) rows = rows.filter(r => r.status === status);
  if (year) rows = rows.filter(r => r.startDate.startsWith(year));
  res.json(rows);
});

router.post("/payroll-periods", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const { periodCode, nameEn, nameAr, periodType, startDate, endDate, payDate, currency, notes } = req.body;
  if (!periodCode || !nameEn || !nameAr || !startDate || !endDate || !payDate) {
    res.status(400).json({ error: "periodCode, nameEn, nameAr, startDate, endDate, payDate required" });
    return;
  }
  const [p] = await db.insert(payrollPeriodsTable).values({
    periodCode, nameEn, nameAr,
    periodType: periodType ?? "monthly",
    startDate, endDate, payDate,
    status: "draft",
    currency: currency ?? "SAR",
    notes: notes ?? null,
  }).returning();
  res.status(201).json(p);
});

router.get("/payroll-periods/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [p] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  res.json(p);
});

// POST /payroll-periods/:id/calculate — generate/recalculate all payroll runs
router.post("/payroll-periods/:id/calculate", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const actorUserId: number = (req as any).session?.userId ?? 1; // demo fallback
  const periodId = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period is closed and cannot be recalculated" }); return; }

  // Get all active employees
  const employees = await db.select().from(employeesTable).where(eq(employeesTable.status, "active"));
  const grades = await db.select().from(salaryGradesTable);
  const components = await db.select().from(payComponentsTable).where(eq(payComponentsTable.isActive, true));
  const overtimeRules = await db.select().from(overtimeRulesTable).where(eq(overtimeRulesTable.isActive, true));

  // Clear existing runs for this period
  const existingRuns = await db.select().from(payrollRunsTable)
    .where(eq(payrollRunsTable.payrollPeriodId, periodId));
  for (const run of existingRuns) {
    await db.delete(payrollRunLinesTable).where(eq(payrollRunLinesTable.payrollRunId, run.id));
  }
  await db.delete(payrollRunsTable).where(eq(payrollRunsTable.payrollPeriodId, periodId));

  // Get punch events for this period (for OT)
  const punchEvents = await db.select().from(punchEventsTable)
    .where(and(
      gte(punchEventsTable.eventTime, new Date(period.startDate)),
      lte(punchEventsTable.eventTime, new Date(period.endDate + "T23:59:59Z")),
    ));

  // Approved leave requests overlapping this period, with their leave type category.
  const approvedLeaves = await db.select({
    employeeId: leaveRequestsTable.employeeId,
    startDate: leaveRequestsTable.startDate,
    endDate: leaveRequestsTable.endDate,
    halfDay: leaveRequestsTable.halfDay,
    category: leaveTypesTable.category,
  })
    .from(leaveRequestsTable)
    .innerJoin(leaveTypesTable, eq(leaveRequestsTable.leaveTypeId, leaveTypesTable.id))
    .where(and(
      eq(leaveRequestsTable.status, "approved"),
      lte(leaveRequestsTable.startDate, period.endDate),
      gte(leaveRequestsTable.endDate, period.startDate),
    ));

  const gradeMap = Object.fromEntries(grades.map(g => [g.gradeCode, g]));
  let totalGross = 0, totalDeductions = 0, totalNet = 0, exceptionCount = 0;

  const runs = [];

  for (const emp of employees) {
    const grade = emp.grade ? gradeMap[emp.grade] : null;
    const baseSalary = grade ? parseFloat(grade.baseSalary) : 5000; // fallback base

    // Calculate OT hours from punch events
    const empOtEvents = punchEvents.filter(e =>
      e.employeeId === emp.id && e.eventType === "OVERTIME_START"
    );
    const overtimeHours = empOtEvents.length * 2; // approximate 2h per OT event

    // Apply OT rule (use standard by default)
    const otRule = overtimeRules.find(r => r.nameEn.includes("Standard")) ?? overtimeRules[0];
    const otRate = otRule ? parseFloat(otRule.multiplierWeekday) : 1.5;
    const hourlyRate = baseSalary / 176; // 22 working days × 8h
    const overtimePay = overtimeHours * hourlyRate * otRate;

    // Calculate allowances from pay components
    const lines: { codeEn: string; nameEn: string; nameAr: string; type: string; amount: number; sortOrder: number; payComponentId?: number }[] = [];

    // Base salary line
    lines.push({ codeEn: "BASE", nameEn: "Basic Salary", nameAr: "الراتب الأساسي", type: "earning", amount: baseSalary, sortOrder: 0 });

    // Housing allowance from grade or default 25%
    const housingPct = grade ? parseFloat(grade.housingAllowancePct) : 25;
    const housingAmount = baseSalary * (housingPct / 100);
    lines.push({ codeEn: "HOUSING", nameEn: "Housing Allowance", nameAr: "بدل السكن", type: "earning", amount: housingAmount, sortOrder: 1 });

    // Transport allowance from grade or default 10%
    const transportPct = grade ? parseFloat(grade.transportAllowancePct) : 10;
    const transportAmount = baseSalary * (transportPct / 100);
    lines.push({ codeEn: "TRANSPORT", nameEn: "Transport Allowance", nameAr: "بدل المواصلات", type: "earning", amount: transportAmount, sortOrder: 2 });

    // OT pay
    if (overtimePay > 0) {
      lines.push({ codeEn: "OT_PAY", nameEn: "Overtime Pay", nameAr: "أجر الوقت الإضافي", type: "earning", amount: Math.round(overtimePay * 100) / 100, sortOrder: 3 });
    }

    // Unpaid leave / absence deduction: proportional to days of approved
    // unpaid-category leave that fall inside this period.
    const WORKING_DAYS = 22;
    const unpaidDays = approvedLeaves
      .filter(l => l.employeeId === emp.id && l.category === "unpaid")
      .reduce((sum, l) => sum + overlapDays(l.startDate, l.endDate, period.startDate, period.endDate, l.halfDay), 0);
    const deductedLeaveDays = Math.min(unpaidDays, WORKING_DAYS);
    const dailyRate = (baseSalary + housingAmount + transportAmount) / WORKING_DAYS;
    const leaveDeductionAmount = Math.round(deductedLeaveDays * dailyRate * 100) / 100;
    if (leaveDeductionAmount > 0) {
      lines.push({
        codeEn: "UNPAID_LEAVE", nameEn: "Unpaid Leave Deduction", nameAr: "خصم إجازة بدون راتب",
        type: "deduction", amount: leaveDeductionAmount, sortOrder: 4,
      });
    }

    // Apply pay components
    let compSortOrder = 10;
    for (const comp of components.filter(c => c.applicableTo === "all" || c.applicableTo === "commercial")) {
      let amount = 0;
      if (comp.calculationMethod === "fixed") {
        amount = parseFloat(comp.value);
      } else if (comp.calculationMethod === "percentage") {
        const base = comp.percentageBase === "gross_salary"
          ? baseSalary + housingAmount + transportAmount
          : baseSalary;
        amount = base * (parseFloat(comp.value) / 100);
      }
      if (amount > 0) {
        lines.push({
          codeEn: comp.codeEn, nameEn: comp.nameEn, nameAr: comp.nameAr,
          type: comp.type, amount: Math.round(amount * 100) / 100,
          sortOrder: compSortOrder++,
          payComponentId: comp.id,
        });
      }
    }

    const totalEarnings = lines.filter(l => l.type === "earning").reduce((sum, l) => sum + l.amount, 0);
    const totalDeductionsEmp = lines.filter(l => l.type === "deduction").reduce((sum, l) => sum + l.amount, 0);
    const grossSalary = totalEarnings;
    const netSalary = grossSalary - totalDeductionsEmp;

    const hasException = !grade;
    if (hasException) exceptionCount++;

    const [run] = await db.insert(payrollRunsTable).values({
      payrollPeriodId: periodId,
      employeeId: emp.id,
      salaryGradeId: grade?.id ?? null,
      baseSalary: String(Math.round(baseSalary * 100) / 100),
      grossSalary: String(Math.round(grossSalary * 100) / 100),
      totalEarnings: String(Math.round(totalEarnings * 100) / 100),
      totalDeductions: String(Math.round(totalDeductionsEmp * 100) / 100),
      netSalary: String(Math.round(netSalary * 100) / 100),
      overtimeHours: String(overtimeHours),
      overtimePay: String(Math.round(overtimePay * 100) / 100),
      deductedLeaveDays: String(deductedLeaveDays),
      leaveDeductionAmount: String(leaveDeductionAmount),
      workingDays: WORKING_DAYS,
      presentDays: WORKING_DAYS - Math.ceil(deductedLeaveDays),
      absentDays: Math.ceil(deductedLeaveDays), // integer column; half-days round up
      hasException,
      exceptionNote: hasException ? "No salary grade assigned — using default base salary" : null,
      status: hasException ? "exception" : "calculated",
      calculatedAt: new Date(),
    }).returning();

    // Insert run lines
    for (const line of lines) {
      await db.insert(payrollRunLinesTable).values({
        payrollRunId: run.id,
        payComponentId: line.payComponentId ?? null,
        codeEn: line.codeEn,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        type: line.type,
        amount: String(line.amount),
        sortOrder: line.sortOrder,
      });
    }

    totalGross += grossSalary;
    totalDeductions += totalDeductionsEmp;
    totalNet += netSalary;
    runs.push(run);
  }

  // Update period totals
  const [updated] = await db.update(payrollPeriodsTable)
    .set({
      status: "under_review",
      totalEmployees: employees.length,
      totalGrossSalary: String(Math.round(totalGross * 100) / 100),
      totalDeductions: String(Math.round(totalDeductions * 100) / 100),
      totalNetSalary: String(Math.round(totalNet * 100) / 100),
      exceptionCount,
      updatedAt: new Date(),
    })
    .where(eq(payrollPeriodsTable.id, periodId))
    .returning();

  await db.insert(auditLogsTable).values({
    action: "payroll.calculated",
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ employeesProcessed: employees.length, exceptionCount }),
  });

  res.json({
    period: updated,
    runsCreated: runs.length,
    exceptionCount,
    totalGross: Math.round(totalGross * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    runs: runs.map(r => ({ runId: r.id, employeeId: r.employeeId, grossSalary: r.grossSalary, netSalary: r.netSalary, hasException: r.hasException })),
  });
});

// POST /payroll-periods/:id/approve — first or second approval
router.post("/payroll-periods/:id/approve", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const actorUserId: number = (req as any).session?.userId ?? 1; // demo fallback
  const periodId = parseInt(req.params.id, 10);
  const { approverId, note } = req.body;
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period already closed" }); return; }

  let updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (period.status === "under_review") {
    updateData = {
      ...updateData,
      status: "first_approved",
      firstApprovedBy: approverId ?? null,
      firstApprovedAt: new Date(),
      firstApproverNote: note ?? null,
    };
  } else if (period.status === "first_approved") {
    updateData = {
      ...updateData,
      status: "second_approved",
      secondApprovedBy: approverId ?? null,
      secondApprovedAt: new Date(),
      secondApproverNote: note ?? null,
    };
  } else {
    res.status(400).json({ error: `Cannot approve period in status: ${period.status}` });
    return;
  }

  const [updated] = await db.update(payrollPeriodsTable).set(updateData)
    .where(eq(payrollPeriodsTable.id, periodId)).returning();

  await db.insert(auditLogsTable).values({
    action: `payroll.${updateData.status}`,
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ approverId, note }),
  });

  res.json(updated);
});

// POST /payroll-periods/:id/close — immutable close (no rollback)
router.post("/payroll-periods/:id/close", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const actorUserId: number = (req as any).session?.userId ?? 1; // demo fallback
  const periodId = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period already closed" }); return; }
  if (period.status !== "second_approved") {
    res.status(400).json({ error: "Period must have second approval before closing" });
    return;
  }

  const [closed] = await db.update(payrollPeriodsTable)
    .set({ status: "closed", isClosed: true, closedAt: new Date(), updatedAt: new Date() })
    .where(eq(payrollPeriodsTable.id, periodId))
    .returning();

  await db.insert(auditLogsTable).values({
    action: "payroll.closed",
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ closedAt: new Date().toISOString() }),
  });

  res.json(closed);
});

router.patch("/payroll-periods/:id", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, id));
  if (!period) { res.status(404).json({ error: "Not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Cannot edit a closed payroll period" }); return; }
  const { nameEn, nameAr, payDate, notes } = req.body;
  const [updated] = await db.update(payrollPeriodsTable)
    .set({ nameEn, nameAr, payDate, notes, updatedAt: new Date() })
    .where(eq(payrollPeriodsTable.id, id))
    .returning();
  res.json(updated);
});

export default router;
