import { Router } from "express";
import {
  db,
  employeesTable,
  payrollPeriodsTable,
  attendanceRecordsTable,
  leaveBalancesTable,
  enterpriseDocumentsTable,
  workforceSnapshotsTable,
  payrollVarianceLogTable,
  analyticsKpiCacheTable,
  departmentsTable,
  courseNominationsTable,
  trainingAttendanceTable,
  trainingSessionsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, sql, isNull, ne } from "drizzle-orm";

const router = Router();

// GET /analytics/executive-summary
router.get("/analytics/executive-summary", async (req, res) => {
  try {
    // Latest snapshot
    const [latestSnapshot] = await db
      .select()
      .from(workforceSnapshotsTable)
      .where(eq(workforceSnapshotsTable.period, "monthly"))
      .orderBy(desc(workforceSnapshotsTable.snapshotDate))
      .limit(1);

    // Documents expiring in 30 days
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expiringDocs = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(enterpriseDocumentsTable)
      .where(
        and(
          gte(enterpriseDocumentsTable.expiresAt, today),
          lte(enterpriseDocumentsTable.expiresAt, in30)
        )
      );

    // Training compliance
    const totalNominations = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(courseNominationsTable);
    const completedNominations = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(courseNominationsTable)
      .where(eq(courseNominationsTable.status, "enrolled"));
    const totalN = totalNominations[0]?.count ?? 0;
    const completedN = completedNominations[0]?.count ?? 0;
    const trainingComplianceRate = totalN > 0 ? Math.round((completedN / totalN) * 100 * 10) / 10 : 0;

    // Pending approvals (leave requests with pending status)
    const pendingApprovals = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveBalancesTable)
      .where(gte(sql`${leaveBalancesTable.pending}::numeric`, sql`1`));

    res.json({
      headcount: latestSnapshot?.headcount ?? 0,
      newHiresThisMonth: latestSnapshot?.newHires ?? 0,
      departuresThisMonth: latestSnapshot?.departures ?? 0,
      openVacancies: latestSnapshot?.openVacancies ?? 0,
      avgSalary: latestSnapshot?.avgSalary ?? "0",
      absenceRateToday: latestSnapshot?.absenceRate ?? "0",
      overtimeHoursThisMonth: latestSnapshot?.overtimeHours ?? "0",
      trainingComplianceRate,
      documentsExpiringIn30Days: expiringDocs[0]?.count ?? 0,
      pendingApprovals: pendingApprovals[0]?.count ?? 0,
      snapshotDate: latestSnapshot?.snapshotDate ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/headcount?months=12
router.get("/analytics/headcount", async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months as string) || 12, 24);
    const rows = await db
      .select()
      .from(workforceSnapshotsTable)
      .where(eq(workforceSnapshotsTable.period, "monthly"))
      .orderBy(desc(workforceSnapshotsTable.snapshotDate))
      .limit(months);

    res.json(rows.reverse());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/vacancies?months=6
router.get("/analytics/vacancies", async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months as string) || 6, 24);
    const rows = await db
      .select({
        snapshotDate: workforceSnapshotsTable.snapshotDate,
        openVacancies: workforceSnapshotsTable.openVacancies,
        headcount: workforceSnapshotsTable.headcount,
        newHires: workforceSnapshotsTable.newHires,
        departures: workforceSnapshotsTable.departures,
      })
      .from(workforceSnapshotsTable)
      .where(eq(workforceSnapshotsTable.period, "monthly"))
      .orderBy(desc(workforceSnapshotsTable.snapshotDate))
      .limit(months);

    res.json(rows.reverse());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/attendance-anomalies?threshold=15&departmentId=
router.get("/analytics/attendance-anomalies", async (req, res) => {
  try {
    const threshold = parseFloat(req.query.threshold as string) || 15;
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;

    // Aggregate absent days per employee in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const conditions = departmentId
      ? and(gte(attendanceRecordsTable.date, thirtyDaysAgo), eq(attendanceRecordsTable.departmentId, departmentId))
      : gte(attendanceRecordsTable.date, thirtyDaysAgo);

    const stats = await db
      .select({
        employeeId: attendanceRecordsTable.employeeId,
        totalDays: sql<number>`count(*)::int`,
        absentDays: sql<number>`sum(case when ${attendanceRecordsTable.status} = 'absent' then 1 else 0 end)::int`,
      })
      .from(attendanceRecordsTable)
      .where(conditions)
      .groupBy(attendanceRecordsTable.employeeId);

    const anomalies = stats
      .filter(s => s.totalDays > 0 && (s.absentDays / s.totalDays) * 100 >= threshold)
      .map(s => ({
        employeeId: s.employeeId,
        absentDays: s.absentDays,
        totalWorkdays: s.totalDays,
        rate: Math.round((s.absentDays / s.totalDays) * 100 * 10) / 10,
      }));

    // Enrich with employee info
    const enriched = await Promise.all(
      anomalies.map(async a => {
        const [emp] = await db
          .select({
            firstNameEn: employeesTable.firstNameEn,
            lastNameEn: employeesTable.lastNameEn,
            departmentId: employeesTable.departmentId,
          })
          .from(employeesTable)
          .where(eq(employeesTable.id, a.employeeId))
          .limit(1);
        return { ...a, employeeName: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : null, departmentId: emp?.departmentId ?? null };
      })
    );

    res.json({ threshold, period: "last_30_days", anomalies: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/overtime-anomalies?threshold=20&departmentId=
router.get("/analytics/overtime-anomalies", async (req, res) => {
  try {
    const threshold = parseFloat(req.query.threshold as string) || 20;
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const conditions = departmentId
      ? and(gte(attendanceRecordsTable.date, thirtyDaysAgo), eq(attendanceRecordsTable.departmentId, departmentId))
      : gte(attendanceRecordsTable.date, thirtyDaysAgo);

    const stats = await db
      .select({
        employeeId: attendanceRecordsTable.employeeId,
        totalOvertimeMinutes: sql<number>`sum(coalesce(${attendanceRecordsTable.overtimeMinutes}, 0))::int`,
        daysWithOvertime: sql<number>`sum(case when ${attendanceRecordsTable.overtimeMinutes} > 0 then 1 else 0 end)::int`,
      })
      .from(attendanceRecordsTable)
      .where(conditions)
      .groupBy(attendanceRecordsTable.employeeId);

    const anomalies = stats.filter(s => (s.totalOvertimeMinutes / 60) >= threshold);

    const enriched = await Promise.all(
      anomalies.map(async a => {
        const [emp] = await db
          .select({
            firstNameEn: employeesTable.firstNameEn,
            lastNameEn: employeesTable.lastNameEn,
            departmentId: employeesTable.departmentId,
          })
          .from(employeesTable)
          .where(eq(employeesTable.id, a.employeeId))
          .limit(1);
        return {
          employeeId: a.employeeId,
          employeeName: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : null,
          departmentId: emp?.departmentId ?? null,
          totalOvertimeHours: Math.round((a.totalOvertimeMinutes / 60) * 10) / 10,
          daysWithOvertime: a.daysWithOvertime,
        };
      })
    );

    res.json({ threshold, period: "last_30_days", anomalies: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/payroll-variance?periods=6
router.get("/analytics/payroll-variance", async (req, res) => {
  try {
    const periods = Math.min(parseInt(req.query.periods as string) || 6, 24);

    const rows = await db
      .select({
        id: payrollVarianceLogTable.id,
        periodId: payrollVarianceLogTable.periodId,
        prevPeriodId: payrollVarianceLogTable.prevPeriodId,
        totalGross: payrollVarianceLogTable.totalGross,
        prevTotalGross: payrollVarianceLogTable.prevTotalGross,
        variance: payrollVarianceLogTable.variance,
        variancePct: payrollVarianceLogTable.variancePct,
        exceptionsCount: payrollVarianceLogTable.exceptionsCount,
        periodCode: payrollPeriodsTable.periodCode,
        periodNameEn: payrollPeriodsTable.nameEn,
        startDate: payrollPeriodsTable.startDate,
      })
      .from(payrollVarianceLogTable)
      .innerJoin(payrollPeriodsTable, eq(payrollVarianceLogTable.periodId, payrollPeriodsTable.id))
      .orderBy(desc(payrollPeriodsTable.startDate))
      .limit(periods);

    res.json(rows.reverse());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/leave-exposure?departmentId=
router.get("/analytics/leave-exposure", async (req, res) => {
  try {
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;

    const conditions = departmentId
      ? eq(employeesTable.departmentId, departmentId)
      : undefined;

    const baseQuery = db
      .select({
        departmentId: employeesTable.departmentId,
        totalPending: sql<string>`sum(${leaveBalancesTable.pending}::numeric)`,
        totalUsed: sql<string>`sum(${leaveBalancesTable.used}::numeric)`,
        totalAccrued: sql<string>`sum(${leaveBalancesTable.accrued}::numeric)`,
        employeeCount: sql<number>`count(distinct ${leaveBalancesTable.employeeId})::int`,
      })
      .from(leaveBalancesTable)
      .innerJoin(employeesTable, eq(leaveBalancesTable.employeeId, employeesTable.id))
      .groupBy(employeesTable.departmentId);

    const rows = conditions
      ? await baseQuery.where(conditions)
      : await baseQuery;

    // Enrich with department names
    const enriched = await Promise.all(
      rows.map(async r => {
        const [dept] = await db
          .select({ nameEn: departmentsTable.nameEn })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, r.departmentId))
          .limit(1);
        return { ...r, departmentNameEn: dept?.nameEn ?? null };
      })
    );

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/training-compliance?departmentId=
router.get("/analytics/training-compliance", async (req, res) => {
  try {
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;

    const empCondition = departmentId
      ? eq(employeesTable.departmentId, departmentId)
      : undefined;

    const baseQuery = db
      .select({
        departmentId: employeesTable.departmentId,
        totalNominations: sql<number>`count(*)::int`,
        completedNominations: sql<number>`sum(case when ${courseNominationsTable.status} = 'enrolled' then 1 else 0 end)::int`,
        mandatoryTotal: sql<number>`sum(case when ${courseNominationsTable.isMandatory} then 1 else 0 end)::int`,
        mandatoryCompleted: sql<number>`sum(case when ${courseNominationsTable.isMandatory} and ${courseNominationsTable.status} = 'enrolled' then 1 else 0 end)::int`,
      })
      .from(courseNominationsTable)
      .innerJoin(employeesTable, eq(courseNominationsTable.employeeId, employeesTable.id))
      .groupBy(employeesTable.departmentId);

    const rows = empCondition
      ? await baseQuery.where(empCondition)
      : await baseQuery;

    const enriched = await Promise.all(
      rows.map(async r => {
        const [dept] = await db
          .select({ nameEn: departmentsTable.nameEn })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, r.departmentId))
          .limit(1);
        const complianceRate = r.totalNominations > 0
          ? Math.round((r.completedNominations / r.totalNominations) * 100 * 10) / 10
          : 0;
        const mandatoryRate = r.mandatoryTotal > 0
          ? Math.round((r.mandatoryCompleted / r.mandatoryTotal) * 100 * 10) / 10
          : 0;
        return { ...r, departmentNameEn: dept?.nameEn ?? null, complianceRate, mandatoryRate };
      })
    );

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/document-expiry?days=30
router.get("/analytics/document-expiry", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(enterpriseDocumentsTable)
      .where(
        and(
          gte(enterpriseDocumentsTable.expiresAt, today),
          lte(enterpriseDocumentsTable.expiresAt, future)
        )
      )
      .orderBy(enterpriseDocumentsTable.expiresAt)
      .limit(200);

    res.json({ days, count: rows.length, documents: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
