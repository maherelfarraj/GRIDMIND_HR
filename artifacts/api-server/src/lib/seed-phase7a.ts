/**
 * Phase 7A seed — Workforce Analytics + Report Builder + Exports.
 * Run with: npx tsx artifacts/api-server/src/lib/seed-phase7a.ts
 */
import { db } from "@workspace/db";
import {
  workforceSnapshotsTable,
  payrollVarianceLogTable,
  analyticsKpiCacheTable,
  reportBuilderConfigsTable,
  exportJobsTable,
  scheduledExportsTable,
  payrollPeriodsTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";

async function main() {
  console.log("🌱 Seeding Phase 7A — Workforce Analytics + Report Builder + Exports...");

  // ─── CLEAN ──────────────────────────────────────────────────────────────────
  console.log("  → cleaning phase 7A tables");
  await db.delete(scheduledExportsTable);
  await db.delete(exportJobsTable);
  await db.delete(reportBuilderConfigsTable);
  await db.delete(analyticsKpiCacheTable);
  await db.delete(payrollVarianceLogTable);
  await db.delete(workforceSnapshotsTable);

  // ─── WORKFORCE SNAPSHOTS ────────────────────────────────────────────────────
  console.log("  → inserting workforce_snapshots");
  const snapshotData: Array<{
    snapshotDate: string; period: string; headcount: number; newHires: number;
    departures: number; openVacancies: number; totalPayroll: string;
    avgSalary: string; overtimeHours: string; absenceRate: string;
  }> = [];

  const months = [
    "2025-01-01","2025-02-01","2025-03-01","2025-04-01","2025-05-01","2025-06-01",
    "2025-07-01","2025-08-01","2025-09-01","2025-10-01","2025-11-01","2025-12-01",
    "2026-01-01","2026-02-01","2026-03-01","2026-04-01","2026-05-01","2026-06-01",
    "2026-07-01","2026-08-01","2026-09-01","2026-10-01","2026-11-01","2026-12-01",
  ];

  const absenceRates = [
    5.2, 4.8, 3.9, 3.2, 4.1, 5.5, 6.2, 7.1, 8.7, 6.3, 5.0, 4.4,
    5.1, 4.7, 3.8, 3.3, 4.2, 5.4, 6.0, 7.3, 8.5, 6.1, 5.2, 4.6,
  ];

  for (let i = 0; i < months.length; i++) {
    const headcount = Math.round(130 + (i * (158 - 130)) / 23);
    const totalPayroll = (580000 + (i * (720000 - 580000)) / 23).toFixed(2);
    const avgSalary = (parseFloat(totalPayroll) / headcount).toFixed(2);
    snapshotData.push({
      snapshotDate: months[i],
      period: "monthly",
      headcount,
      newHires: Math.floor(Math.random() * 5) + 1,
      departures: Math.floor(Math.random() * 3),
      openVacancies: Math.floor(Math.random() * 8) + 2,
      totalPayroll,
      avgSalary,
      overtimeHours: (Math.random() * 200 + 50).toFixed(2),
      absenceRate: absenceRates[i].toFixed(2),
    });
  }

  await db.insert(workforceSnapshotsTable).values(snapshotData);
  console.log(`  ✓ inserted ${snapshotData.length} workforce snapshots`);

  // ─── PAYROLL VARIANCE LOG ───────────────────────────────────────────────────
  console.log("  → inserting payroll_variance_log");
  const periods = await db
    .select()
    .from(payrollPeriodsTable)
    .orderBy(desc(payrollPeriodsTable.id))
    .limit(6);

  if (periods.length >= 2) {
    const varianceRows = [];
    for (let i = 0; i < Math.min(periods.length, 6); i++) {
      const period = periods[i];
      const prevPeriod = periods[i + 1] ?? null;
      const totalGross = parseFloat(period.totalGrossSalary as string) || (580000 + i * 15000);
      const prevTotalGross = prevPeriod
        ? (parseFloat(prevPeriod.totalGrossSalary as string) || (totalGross - 12000))
        : null;
      const variance = prevTotalGross !== null ? totalGross - prevTotalGross : 0;
      const variancePct = prevTotalGross && prevTotalGross !== 0
        ? ((variance / prevTotalGross) * 100)
        : 0;

      varianceRows.push({
        periodId: period.id,
        prevPeriodId: prevPeriod?.id ?? null,
        totalGross: totalGross.toFixed(2),
        prevTotalGross: prevTotalGross !== null ? prevTotalGross.toFixed(2) : null,
        variance: variance.toFixed(2),
        variancePct: variancePct.toFixed(2),
        exceptionsCount: Math.floor(Math.random() * 10),
      });
    }
    await db.insert(payrollVarianceLogTable).values(varianceRows);
    console.log(`  ✓ inserted ${varianceRows.length} payroll variance log entries`);
  } else {
    console.log("  ⚠ insufficient payroll periods for variance log — skipping");
  }

  // ─── ANALYTICS KPI CACHE ────────────────────────────────────────────────────
  console.log("  → inserting analytics_kpi_cache");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour

  const kpiEntries = [
    { cacheKey: "kpi:headcount:current", valueJson: JSON.stringify({ value: 152, unit: "employees", trend: "+4.1%" }) },
    { cacheKey: "kpi:payroll:monthly_total", valueJson: JSON.stringify({ value: 712500, currency: "SAR", trend: "+2.3%" }) },
    { cacheKey: "kpi:absence_rate:current", valueJson: JSON.stringify({ value: 5.2, unit: "%", status: "normal" }) },
    { cacheKey: "kpi:overtime:this_month", valueJson: JSON.stringify({ value: 234.5, unit: "hours", trend: "-8.2%" }) },
    { cacheKey: "kpi:open_vacancies:current", valueJson: JSON.stringify({ value: 11, unit: "positions" }) },
    { cacheKey: "kpi:new_hires:this_month", valueJson: JSON.stringify({ value: 3, unit: "employees" }) },
    { cacheKey: "kpi:departures:this_month", valueJson: JSON.stringify({ value: 1, unit: "employees" }) },
    { cacheKey: "kpi:avg_salary:current", valueJson: JSON.stringify({ value: 4688, currency: "SAR" }) },
    { cacheKey: "kpi:leave_pending_days:total", valueJson: JSON.stringify({ value: 87, unit: "days", byDept: { IT: 12, Finance: 23, Operations: 52 } }) },
    { cacheKey: "kpi:training_compliance:overall", valueJson: JSON.stringify({ value: 76.4, unit: "%", target: 90 }) },
    { cacheKey: "kpi:documents_expiring:30_days", valueJson: JSON.stringify({ value: 8, unit: "documents" }) },
    { cacheKey: "kpi:payroll_variance:last_month", valueJson: JSON.stringify({ value: 14200, currency: "SAR", pct: 2.04 }) },
  ];

  await db.insert(analyticsKpiCacheTable).values(
    kpiEntries.map(e => ({
      ...e,
      computedAt: now,
      expiresAt,
    }))
  );
  console.log(`  ✓ inserted ${kpiEntries.length} KPI cache entries`);

  // ─── REPORT BUILDER CONFIGS ─────────────────────────────────────────────────
  console.log("  → inserting report_builder_configs");
  const reportConfigs = [
    {
      nameEn: "Employees by Department & Grade",
      nameAr: "الموظفون حسب القسم والدرجة",
      descriptionEn: "List all active employees grouped by department and grade level",
      dataSource: "employees",
      columnsJson: JSON.stringify(["employeeNumber","firstNameEn","lastNameEn","jobTitleEn","grade","departmentId","status","hireDate"]),
      filtersJson: JSON.stringify({ status: "active" }),
      sortByJson: JSON.stringify([{ field: "departmentId", dir: "asc" }, { field: "grade", dir: "asc" }]),
      groupByJson: JSON.stringify(["departmentId"]),
      isPublic: true,
    },
    {
      nameEn: "Monthly Attendance Summary",
      nameAr: "ملخص الحضور الشهري",
      descriptionEn: "Attendance statistics per employee for the selected month",
      dataSource: "attendance",
      columnsJson: JSON.stringify(["employeeId","date","status","checkInTime","checkOutTime","lateMinutes","overtimeMinutes","workingHours"]),
      filtersJson: JSON.stringify({ period: "current_month" }),
      sortByJson: JSON.stringify([{ field: "employeeId", dir: "asc" }]),
      isPublic: true,
    },
    {
      nameEn: "Payroll Variance Report",
      nameAr: "تقرير تباين الرواتب",
      descriptionEn: "Month-over-month payroll variance with exception highlights",
      dataSource: "payroll",
      columnsJson: JSON.stringify(["periodCode","nameEn","totalGrossSalary","totalDeductions","totalNetSalary","exceptionCount","variance","variancePct"]),
      filtersJson: JSON.stringify({ periods: 6 }),
      sortByJson: JSON.stringify([{ field: "startDate", dir: "desc" }]),
      roleRestriction: "finance_manager",
      isPublic: false,
    },
    {
      nameEn: "Leave Balance Overview",
      nameAr: "نظرة عامة على أرصدة الإجازات",
      descriptionEn: "Current leave balances for all employees by leave type",
      dataSource: "leave",
      columnsJson: JSON.stringify(["employeeId","leaveTypeId","year","openingBalance","accrued","used","pending","adjustment"]),
      filtersJson: JSON.stringify({ year: 2025 }),
      sortByJson: JSON.stringify([{ field: "employeeId", dir: "asc" }]),
      isPublic: true,
    },
    {
      nameEn: "Training Compliance Tracker",
      nameAr: "متتبع الامتثال للتدريب",
      descriptionEn: "Track mandatory training completion rates per department",
      dataSource: "training",
      columnsJson: JSON.stringify(["employeeId","courseId","nominationStatus","attendanceStatus","score","completionDate","certificationExpiry"]),
      filtersJson: JSON.stringify({ mandatory: true }),
      sortByJson: JSON.stringify([{ field: "completionDate", dir: "desc" }]),
      isPublic: true,
    },
  ];

  const insertedConfigs = await db
    .insert(reportBuilderConfigsTable)
    .values(reportConfigs.map(c => ({ ...c, createdByUserId: 1 })))
    .returning();
  console.log(`  ✓ inserted ${insertedConfigs.length} report builder configs`);

  // ─── EXPORT JOBS ────────────────────────────────────────────────────────────
  console.log("  → inserting export_jobs");
  const doneAt = new Date(now.getTime() - 30 * 60 * 1000);
  await db.insert(exportJobsTable).values([
    {
      jobType: "xlsx",
      entityType: "report_builder_config",
      entityId: insertedConfigs[0].id,
      requestedByUserId: 1,
      status: "done",
      parametersJson: JSON.stringify({ format: "xlsx", rows: 152 }),
      outputPath: "/exports/employees-dept-grade-2025.xlsx",
      startedAt: new Date(doneAt.getTime() - 5000),
      completedAt: doneAt,
    },
    {
      jobType: "pdf",
      entityType: "report_builder_config",
      entityId: insertedConfigs[2].id,
      requestedByUserId: 1,
      status: "failed",
      parametersJson: JSON.stringify({ format: "pdf", periods: 6 }),
      errorMessage: "PDF renderer timeout after 30s — payroll variance data too large",
      startedAt: new Date(now.getTime() - 60 * 60 * 1000),
    },
    {
      jobType: "csv",
      entityType: "report_builder_config",
      entityId: insertedConfigs[1].id,
      requestedByUserId: 1,
      status: "queued",
      parametersJson: JSON.stringify({ format: "csv", month: "2025-06" }),
    },
  ]);
  console.log("  ✓ inserted 3 export jobs");

  // ─── SCHEDULED EXPORTS ──────────────────────────────────────────────────────
  console.log("  → inserting scheduled_exports");
  await db.insert(scheduledExportsTable).values([
    {
      reportBuilderConfigId: insertedConfigs[2].id,
      nameEn: "Monthly Payroll Summary — Auto Export",
      cronExpression: "0 6 1 * *",
      timezone: "Asia/Riyadh",
      format: "xlsx",
      recipientUserIds: JSON.stringify([1, 2]),
      isActive: true,
      nextRunAt: new Date("2025-07-01T06:00:00+03:00"),
    },
    {
      reportBuilderConfigId: insertedConfigs[0].id,
      nameEn: "Quarterly Headcount Report",
      cronExpression: "0 7 1 1,4,7,10 *",
      timezone: "Asia/Riyadh",
      format: "pdf",
      recipientUserIds: JSON.stringify([1]),
      isActive: true,
      nextRunAt: new Date("2025-10-01T07:00:00+03:00"),
    },
  ]);
  console.log("  ✓ inserted 2 scheduled exports");

  console.log("\n✅ Phase 7A seed complete.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
