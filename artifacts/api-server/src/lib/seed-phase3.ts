/**
 * Phase 3 seed: Leave Management + Payroll Foundations
 * Run: npx tsx artifacts/api-server/src/lib/seed-phase3.ts
 */
import { db } from "@workspace/db";
import {
  leaveTypesTable, leaveBalancesTable, leaveRequestsTable,
  leaveApprovalStepsTable, leaveDelegationsTable, publicHolidaysTable,
  salaryGradesTable, payComponentsTable, payrollPeriodsTable,
  payrollRunsTable, payrollRunLinesTable, employeesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  console.log("🌱 Seeding Phase 3: Leave Management + Payroll…");

  // ── 1. Public Holidays (2026) ──────────────────────────────────────────────
  const existingHolidays = await db.select().from(publicHolidaysTable);
  if (existingHolidays.length === 0) {
    await db.insert(publicHolidaysTable).values([
      { nameEn: "New Year's Day",         nameAr: "رأس السنة الميلادية",      date: "2026-01-01", year: 2026, isRecurring: true,  applicableTo: "commercial" },
      { nameEn: "Founding Day",           nameAr: "يوم التأسيس",              date: "2026-02-22", year: 2026, isRecurring: true,  applicableTo: "all" },
      { nameEn: "Eid Al-Fitr Day 1",      nameAr: "أول أيام عيد الفطر",       date: "2026-03-20", year: 2026, isRecurring: false, applicableTo: "all" },
      { nameEn: "Eid Al-Fitr Day 2",      nameAr: "ثاني أيام عيد الفطر",      date: "2026-03-21", year: 2026, isRecurring: false, applicableTo: "all" },
      { nameEn: "Eid Al-Fitr Day 3",      nameAr: "ثالث أيام عيد الفطر",      date: "2026-03-22", year: 2026, isRecurring: false, applicableTo: "all" },
      { nameEn: "National Day",           nameAr: "اليوم الوطني",              date: "2026-09-23", year: 2026, isRecurring: true,  applicableTo: "all" },
      { nameEn: "Eid Al-Adha Day 1",      nameAr: "أول أيام عيد الأضحى",      date: "2026-05-27", year: 2026, isRecurring: false, applicableTo: "all" },
      { nameEn: "Eid Al-Adha Day 2",      nameAr: "ثاني أيام عيد الأضحى",     date: "2026-05-28", year: 2026, isRecurring: false, applicableTo: "all" },
      { nameEn: "Eid Al-Adha Day 3",      nameAr: "ثالث أيام عيد الأضحى",     date: "2026-05-29", year: 2026, isRecurring: false, applicableTo: "all" },
      { nameEn: "Arafat Day (Half Day)",  nameAr: "يوم عرفة (نصف يوم)",        date: "2026-05-26", year: 2026, isRecurring: false, applicableTo: "all" },
    ]);
    console.log("✔ Public holidays inserted (10)");
  }

  // ── 2. Leave Types ─────────────────────────────────────────────────────────
  const existingTypes = await db.select().from(leaveTypesTable);
  if (existingTypes.length === 0) {
    await db.insert(leaveTypesTable).values([
      {
        codeEn: "ANNUAL",    nameEn: "Annual Leave",      nameAr: "إجازة سنوية",
        category: "general", defaultDaysPerYear: 30, accrualFrequency: "monthly",
        accrualAmount: "2.5", maxCarryoverDays: 15, requiresApproval: true,
        requiresAttachment: false, minAdvanceNoticeDays: 7, color: "#6366F1",
      },
      {
        codeEn: "SICK",      nameEn: "Sick Leave",         nameAr: "إجازة مرضية",
        category: "sick",    defaultDaysPerYear: 30, accrualFrequency: "annual",
        accrualAmount: "30", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: true, minAdvanceNoticeDays: 0, color: "#EF4444",
        descriptionEn: "Requires medical certificate for absences exceeding 2 days",
        descriptionAr: "تتطلب شهادة طبية للغياب الذي يتجاوز يومين",
      },
      {
        codeEn: "EMERGENCY", nameEn: "Emergency Leave",    nameAr: "إجازة طارئة",
        category: "emergency", defaultDaysPerYear: 5, accrualFrequency: "annual",
        accrualAmount: "5", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: false, minAdvanceNoticeDays: 0, maxConsecutiveDays: 3,
        color: "#F97316",
      },
      {
        codeEn: "MATERNITY", nameEn: "Maternity Leave",    nameAr: "إجازة أمومة",
        category: "maternity", defaultDaysPerYear: 70, accrualFrequency: "none",
        accrualAmount: "0", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: true, minAdvanceNoticeDays: 30,
        applicableToGender: "female", color: "#EC4899",
      },
      {
        codeEn: "PATERNITY", nameEn: "Paternity Leave",    nameAr: "إجازة أبوة",
        category: "paternity", defaultDaysPerYear: 3, accrualFrequency: "none",
        accrualAmount: "0", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: false, minAdvanceNoticeDays: 0, maxConsecutiveDays: 3,
        applicableToGender: "male", color: "#3B82F6",
      },
      {
        codeEn: "STUDY",     nameEn: "Study / Exam Leave", nameAr: "إجازة دراسية",
        category: "study",   defaultDaysPerYear: 14, accrualFrequency: "annual",
        accrualAmount: "14", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: true, minAdvanceNoticeDays: 14, color: "#8B5CF6",
      },
      {
        codeEn: "HAJJ",      nameEn: "Hajj Leave",         nameAr: "إجازة الحج",
        category: "general", defaultDaysPerYear: 14, accrualFrequency: "none",
        accrualAmount: "0", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: false, minAdvanceNoticeDays: 30, maxConsecutiveDays: 14,
        color: "#10B981",
        descriptionEn: "Once in a lifetime — employee must not have performed Hajj before",
        descriptionAr: "مرة واحدة في العمر — يجب ألا يكون الموظف قد أدى فريضة الحج من قبل",
      },
      {
        codeEn: "UNPAID",    nameEn: "Unpaid Leave",       nameAr: "إجازة بدون راتب",
        category: "unpaid",  defaultDaysPerYear: 0, accrualFrequency: "none",
        accrualAmount: "0", maxCarryoverDays: 0, requiresApproval: true,
        requiresAttachment: false, minAdvanceNoticeDays: 14, color: "#6B7280",
      },
    ]);
    console.log("✔ Leave types inserted (8)");
  }

  // ── 3. Leave Balances (2026, all 15 employees × key leave types) ───────────
  const existingBalances = await db.select().from(leaveBalancesTable);
  if (existingBalances.length === 0) {
    const employees = await db.select().from(employeesTable);
    const leaveTypes = await db.select().from(leaveTypesTable);
    const typeMap = Object.fromEntries(leaveTypes.map(t => [t.codeEn, t.id]));

    const balanceRows = [];
    for (const emp of employees) {
      // Annual leave – each employee has different usage
      const annualUsed = (emp.id % 5) * 3 + 2;
      balanceRows.push({
        employeeId: emp.id, leaveTypeId: typeMap["ANNUAL"], year: 2026,
        openingBalance: "5.00", accrued: "17.50", used: String(annualUsed.toFixed(2)),
        pending: "0.00", adjustment: "0.00", carriedOver: "3.00",
      });
      // Sick leave
      const sickUsed = emp.id % 3 === 0 ? 2 : 0;
      balanceRows.push({
        employeeId: emp.id, leaveTypeId: typeMap["SICK"], year: 2026,
        openingBalance: "0.00", accrued: "30.00", used: String(sickUsed.toFixed(2)),
        pending: "0.00", adjustment: "0.00", carriedOver: "0.00",
      });
      // Emergency leave
      balanceRows.push({
        employeeId: emp.id, leaveTypeId: typeMap["EMERGENCY"], year: 2026,
        openingBalance: "0.00", accrued: "5.00", used: "0.00",
        pending: "0.00", adjustment: "0.00", carriedOver: "0.00",
      });
    }
    await db.insert(leaveBalancesTable).values(balanceRows);
    console.log(`✔ Leave balances inserted (${balanceRows.length})`);
  }

  // ── 4. Leave Requests (realistic mix of statuses) ──────────────────────────
  const existingRequests = await db.select().from(leaveRequestsTable);
  if (existingRequests.length === 0) {
    const employees = await db.select().from(employeesTable);
    const leaveTypes = await db.select().from(leaveTypesTable);
    const annualId = leaveTypes.find(t => t.codeEn === "ANNUAL")!.id;
    const sickId   = leaveTypes.find(t => t.codeEn === "SICK")!.id;
    const emergId  = leaveTypes.find(t => t.codeEn === "EMERGENCY")!.id;

    const requestSeed = [
      { empIdx: 0, typeId: annualId, start: "2026-07-01", end: "2026-07-05", days: 5, status: "approved",      reason: "Family vacation" },
      { empIdx: 1, typeId: sickId,   start: "2026-07-08", end: "2026-07-09", days: 2, status: "approved",      reason: "Flu and fever" },
      { empIdx: 2, typeId: annualId, start: "2026-07-14", end: "2026-07-18", days: 5, status: "under_review",  reason: "Personal travel" },
      { empIdx: 3, typeId: emergId,  start: "2026-07-21", end: "2026-07-22", days: 2, status: "submitted",     reason: "Family emergency" },
      { empIdx: 4, typeId: annualId, start: "2026-08-01", end: "2026-08-10", days: 10, status: "draft",        reason: "Summer holiday" },
      { empIdx: 5, typeId: sickId,   start: "2026-07-15", end: "2026-07-17", days: 3, status: "approved",      reason: "Medical procedure" },
      { empIdx: 6, typeId: annualId, start: "2026-08-15", end: "2026-08-19", days: 5, status: "submitted",     reason: "Rest and recovery" },
      { empIdx: 7, typeId: annualId, start: "2026-06-22", end: "2026-06-26", days: 5, status: "approved",      reason: "Travel abroad" },
      { empIdx: 8, typeId: emergId,  start: "2026-07-28", end: "2026-07-28", days: 1, status: "under_review",  reason: "Child illness" },
      { empIdx: 9, typeId: annualId, start: "2026-09-01", end: "2026-09-05", days: 5, status: "draft",         reason: "Pre-approved annual" },
      { empIdx: 0, typeId: sickId,   start: "2026-06-10", end: "2026-06-11", days: 2, status: "approved",      reason: "Dental surgery" },
      { empIdx: 2, typeId: emergId,  start: "2026-05-05", end: "2026-05-06", days: 2, status: "rejected",      reason: "Personal matter" },
    ];

    for (let i = 0; i < requestSeed.length; i++) {
      const s = requestSeed[i];
      const emp = employees[s.empIdx];
      if (!emp) continue;
      const rn = `LV-2026${String(i + 1).padStart(4, "0")}`;

      const [req] = await db.insert(leaveRequestsTable).values({
        requestNumber: rn,
        employeeId: emp.id,
        leaveTypeId: s.typeId,
        startDate: s.start,
        endDate: s.end,
        totalDays: String(s.days),
        halfDay: false,
        reasonEn: s.reason,
        status: s.status as string,
        currentStepNumber: s.status === "approved" ? 2 : s.status === "under_review" ? 2 : 1,
        totalApprovalSteps: 2,
        submittedAt: s.status !== "draft" ? new Date(`${s.start}T08:00:00Z`) : null,
        decidedAt: ["approved", "rejected"].includes(s.status) ? new Date(`${s.end}T14:00:00Z`) : null,
        returnedToWork: s.status === "approved" && s.end < "2026-07-20",
        returnDate: s.status === "approved" && s.end < "2026-07-20" ? null : null,
      }).returning();

      // Create approval steps
      const step1Decision = ["approved", "rejected", "under_review"].includes(s.status) ? (s.status === "rejected" ? "reject" : "approve") : null;
      const step2Decision = s.status === "approved" ? "approve" : null;

      await db.insert(leaveApprovalStepsTable).values([
        {
          leaveRequestId: req.id, stepNumber: 1,
          roleRequired: "department_manager",
          status: step1Decision ? (step1Decision === "approve" ? "approved" : "rejected") : "pending",
          decision: step1Decision,
          decidedAt: step1Decision ? new Date(`${s.start}T10:00:00Z`) : null,
        },
        {
          leaveRequestId: req.id, stepNumber: 2,
          roleRequired: "hr_director",
          status: step2Decision ? "approved" : (step1Decision === "reject" ? "skipped" : "pending"),
          decision: step2Decision,
          decidedAt: step2Decision ? new Date(`${s.end}T14:00:00Z`) : null,
        },
      ]);

      // Update balances for approved requests
      if (s.status === "approved") {
        const year = new Date(s.start).getFullYear();
        const [bal] = await db.select().from(leaveBalancesTable).where(
          eq(leaveBalancesTable.employeeId, emp.id)
        );
        if (bal) {
          await db.update(leaveBalancesTable)
            .set({ used: String(parseFloat(bal.used) + s.days) })
            .where(eq(leaveBalancesTable.id, bal.id));
        }
      }
    }
    console.log(`✔ Leave requests inserted (${requestSeed.length})`);
  }

  // ── 5. Leave Delegations ───────────────────────────────────────────────────
  const existingDelegations = await db.select().from(leaveDelegationsTable);
  if (existingDelegations.length === 0) {
    const employees = await db.select().from(employeesTable);
    if (employees.length >= 4) {
      await db.insert(leaveDelegationsTable).values([
        {
          delegatorEmployeeId: employees[0].id,
          delegateeEmployeeId: employees[1].id,
          startDate: "2026-07-25",
          endDate: "2026-08-05",
          reason: "Annual leave — delegating approval authority",
          isActive: true,
        },
        {
          delegatorEmployeeId: employees[2].id,
          delegateeEmployeeId: employees[3].id,
          startDate: "2026-08-10",
          endDate: "2026-08-20",
          reason: "Conference travel",
          isActive: false,
        },
      ]);
      console.log("✔ Leave delegations inserted (2)");
    }
  }

  // ── 6. Salary Grades ───────────────────────────────────────────────────────
  const existingGrades = await db.select().from(salaryGradesTable);
  if (existingGrades.length === 0) {
    await db.insert(salaryGradesTable).values([
      // Commercial grades
      { gradeCode: "G1-S1", nameEn: "Grade 1 – Step 1 (Junior)",       nameAr: "الدرجة 1 – مرحلة 1 (مبتدئ)",        step: 1, baseSalary: "4500.00",  housingAllowancePct: "25", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G1-S2", nameEn: "Grade 1 – Step 2",                 nameAr: "الدرجة 1 – مرحلة 2",                step: 2, baseSalary: "4900.00",  housingAllowancePct: "25", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G2-S1", nameEn: "Grade 2 – Step 1 (Mid-Level)",     nameAr: "الدرجة 2 – مرحلة 1 (متوسط)",        step: 1, baseSalary: "6500.00",  housingAllowancePct: "25", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G2-S2", nameEn: "Grade 2 – Step 2",                 nameAr: "الدرجة 2 – مرحلة 2",                step: 2, baseSalary: "7200.00",  housingAllowancePct: "25", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G3-S1", nameEn: "Grade 3 – Step 1 (Senior)",        nameAr: "الدرجة 3 – مرحلة 1 (أول)",          step: 1, baseSalary: "9500.00",  housingAllowancePct: "30", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G3-S2", nameEn: "Grade 3 – Step 2",                 nameAr: "الدرجة 3 – مرحلة 2",                step: 2, baseSalary: "10500.00", housingAllowancePct: "30", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G4-S1", nameEn: "Grade 4 – Step 1 (Manager)",       nameAr: "الدرجة 4 – مرحلة 1 (مدير)",         step: 1, baseSalary: "14000.00", housingAllowancePct: "33", transportAllowancePct: "10", organizationType: "commercial" },
      { gradeCode: "G5-S1", nameEn: "Grade 5 – Step 1 (Director)",      nameAr: "الدرجة 5 – مرحلة 1 (مدير عام)",     step: 1, baseSalary: "22000.00", housingAllowancePct: "33", transportAllowancePct: "10", organizationType: "commercial" },
      // Government grades
      { gradeCode: "GOV-5", nameEn: "Government Grade 5",               nameAr: "الدرجة الحكومية 5",                  step: 1, baseSalary: "5200.00",  housingAllowancePct: "40", transportAllowancePct: "15", organizationType: "government" },
      { gradeCode: "GOV-7", nameEn: "Government Grade 7",               nameAr: "الدرجة الحكومية 7",                  step: 1, baseSalary: "7800.00",  housingAllowancePct: "40", transportAllowancePct: "15", organizationType: "government" },
      { gradeCode: "GOV-10",nameEn: "Government Grade 10",              nameAr: "الدرجة الحكومية 10",                 step: 1, baseSalary: "11500.00", housingAllowancePct: "40", transportAllowancePct: "15", organizationType: "government" },
      // Military ranks
      { gradeCode: "MIL-SGT", nameEn: "Sergeant",                      nameAr: "رقيب",                               step: 1, baseSalary: "6000.00",  housingAllowancePct: "50", transportAllowancePct: "20", organizationType: "military" },
      { gradeCode: "MIL-LT",  nameEn: "Lieutenant",                    nameAr: "ملازم",                              step: 1, baseSalary: "9000.00",  housingAllowancePct: "50", transportAllowancePct: "20", organizationType: "military" },
      { gradeCode: "MIL-CPT", nameEn: "Captain",                       nameAr: "نقيب",                               step: 1, baseSalary: "12000.00", housingAllowancePct: "50", transportAllowancePct: "20", organizationType: "military" },
      { gradeCode: "MIL-MAJ", nameEn: "Major",                         nameAr: "رائد",                               step: 1, baseSalary: "16000.00", housingAllowancePct: "50", transportAllowancePct: "20", organizationType: "military" },
    ]);
    console.log("✔ Salary grades inserted (15)");
  }

  // ── 7. Pay Components ──────────────────────────────────────────────────────
  const existingComponents = await db.select().from(payComponentsTable);
  if (existingComponents.length === 0) {
    await db.insert(payComponentsTable).values([
      // Earnings
      { codeEn: "MEAL_ALLOW",  nameEn: "Meal Allowance",          nameAr: "بدل الوجبات",             type: "earning",   calculationMethod: "fixed",      value: "300.00", isTaxable: false, isMandatory: false, applicableTo: "all",     sortOrder: 10 },
      { codeEn: "PHONE_ALLOW", nameEn: "Phone Allowance",         nameAr: "بدل الاتصالات",            type: "earning",   calculationMethod: "fixed",      value: "150.00", isTaxable: false, isMandatory: false, applicableTo: "all",     sortOrder: 11 },
      { codeEn: "RISK_ALLOW",  nameEn: "Risk / Hazard Allowance", nameAr: "بدل المخاطر",              type: "earning",   calculationMethod: "percentage", value: "5.00",   percentageBase: "base_salary", isTaxable: false, isMandatory: false, applicableTo: "all", sortOrder: 12 },
      { codeEn: "PERF_BONUS",  nameEn: "Performance Bonus",       nameAr: "مكافأة الأداء",            type: "earning",   calculationMethod: "fixed",      value: "0.00",   isTaxable: true,  isMandatory: false, applicableTo: "all",     sortOrder: 20 },
      // Deductions
      { codeEn: "GOSI_EMP",    nameEn: "GOSI (Employee 10%)",     nameAr: "تأمينات اجتماعية (موظف)", type: "deduction", calculationMethod: "percentage", value: "10.00",  percentageBase: "base_salary", isTaxable: false, isMandatory: true, applicableTo: "commercial", sortOrder: 30 },
      { codeEn: "INCOME_TAX",  nameEn: "Income Tax Withholding",  nameAr: "استقطاع ضريبة الدخل",     type: "deduction", calculationMethod: "percentage", value: "2.50",   percentageBase: "gross_salary", isTaxable: false, isMandatory: false, applicableTo: "commercial", sortOrder: 31 },
      { codeEn: "LOAN_DED",    nameEn: "Loan Deduction",          nameAr: "خصم القرض",               type: "deduction", calculationMethod: "fixed",      value: "0.00",   isTaxable: false, isMandatory: false, applicableTo: "all",     sortOrder: 32 },
      { codeEn: "ABSENCE_DED", nameEn: "Absence Deduction",       nameAr: "خصم الغياب",              type: "deduction", calculationMethod: "per_day",    value: "0.00",   isTaxable: false, isMandatory: false, applicableTo: "all",     sortOrder: 33 },
    ]);
    console.log("✔ Pay components inserted (8)");
  }

  // ── 8. Payroll Periods (3 months) ──────────────────────────────────────────
  const existingPeriods = await db.select().from(payrollPeriodsTable);
  if (existingPeriods.length === 0) {
    await db.insert(payrollPeriodsTable).values([
      {
        periodCode: "PAY-2026-05", nameEn: "May 2026 Payroll",   nameAr: "رواتب مايو 2026",
        periodType: "monthly", startDate: "2026-05-01", endDate: "2026-05-31", payDate: "2026-06-01",
        status: "closed", isClosed: true,
        totalEmployees: 15, totalGrossSalary: "165000.00", totalDeductions: "18000.00", totalNetSalary: "147000.00",
        closedAt: new Date("2026-06-01T10:00:00Z"),
        firstApprovedAt: new Date("2026-05-29T09:00:00Z"),
        secondApprovedAt: new Date("2026-05-30T11:00:00Z"),
        notes: "All clear — no exceptions",
      },
      {
        periodCode: "PAY-2026-06", nameEn: "June 2026 Payroll",  nameAr: "رواتب يونيو 2026",
        periodType: "monthly", startDate: "2026-06-01", endDate: "2026-06-30", payDate: "2026-07-01",
        status: "second_approved", isClosed: false,
        totalEmployees: 15, totalGrossSalary: "167500.00", totalDeductions: "18300.00", totalNetSalary: "149200.00",
        firstApprovedAt: new Date("2026-06-28T09:00:00Z"),
        secondApprovedAt: new Date("2026-06-29T11:00:00Z"),
        exceptionCount: 1,
        notes: "1 exception: grade not assigned for new hire",
      },
      {
        periodCode: "PAY-2026-07", nameEn: "July 2026 Payroll",  nameAr: "رواتب يوليو 2026",
        periodType: "monthly", startDate: "2026-07-01", endDate: "2026-07-31", payDate: "2026-08-01",
        status: "draft", isClosed: false,
        totalEmployees: 0, totalGrossSalary: "0.00", totalDeductions: "0.00", totalNetSalary: "0.00",
        notes: "Ready for calculation",
      },
    ]);
    console.log("✔ Payroll periods inserted (3)");
  }

  console.log("✅ Phase 3 seed complete.");
  process.exit(0);
}

main().catch(err => {
  console.error("Seed error:", err);
  process.exit(1);
});
