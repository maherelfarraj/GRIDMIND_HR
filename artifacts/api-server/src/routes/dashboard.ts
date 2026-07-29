import { Router } from "express";
import { db } from "@workspace/db";
import {
  employeesTable, departmentsTable, approvalsTable,
  securityAlertsTable, attendanceDevicesTable, documentsTable,
  auditLogsTable, attendanceRecordsTable,
  shiftsTable, rostersTable, overtimeRulesTable
} from "@workspace/db";
import { eq, and, sql, count, gte, lte } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const firstOfMonthStr = firstOfMonth.toISOString().slice(0, 10);

  const [totalEmp] = await db.select({ c: count() }).from(employeesTable);
  const [activeEmp] = await db.select({ c: count() }).from(employeesTable).where(eq(employeesTable.status, "active"));
  const [newHires] = await db.select({ c: count() }).from(employeesTable).where(
    and(gte(employeesTable.hireDate, firstOfMonthStr), eq(employeesTable.status, "active"))
  );
  const [pendingApprovals] = await db.select({ c: count() }).from(approvalsTable).where(eq(approvalsTable.status, "pending"));
  const [openAlerts] = await db.select({ c: count() }).from(securityAlertsTable).where(eq(securityAlertsTable.acknowledged, false));
  const [onLeave] = await db.select({ c: count() }).from(attendanceRecordsTable).where(
    and(eq(attendanceRecordsTable.date, today), eq(attendanceRecordsTable.status, "on_leave"))
  );
  const [present] = await db.select({ c: count() }).from(attendanceRecordsTable).where(
    and(eq(attendanceRecordsTable.date, today), eq(attendanceRecordsTable.status, "present"))
  );
  const [absent] = await db.select({ c: count() }).from(attendanceRecordsTable).where(
    and(eq(attendanceRecordsTable.date, today), eq(attendanceRecordsTable.status, "absent"))
  );
  const [totalDepts] = await db.select({ c: count() }).from(departmentsTable);
  const [totalDevices] = await db.select({ c: count() }).from(attendanceDevicesTable);
  const [onlineDevices] = await db.select({ c: count() }).from(attendanceDevicesTable).where(eq(attendanceDevicesTable.status, "online"));
  const [docsPending] = await db.select({ c: count() }).from(documentsTable).where(eq(documentsTable.status, "pending"));

  res.json({
    totalEmployees: totalEmp?.c ?? 0,
    activeEmployees: activeEmp?.c ?? 0,
    newHiresThisMonth: newHires?.c ?? 0,
    pendingApprovals: pendingApprovals?.c ?? 0,
    openAlerts: openAlerts?.c ?? 0,
    onLeaveToday: onLeave?.c ?? 0,
    presentToday: present?.c ?? 0,
    absentToday: absent?.c ?? 0,
    totalDepartments: totalDepts?.c ?? 0,
    totalDevices: totalDevices?.c ?? 0,
    onlineDevices: onlineDevices?.c ?? 0,
    documentsPendingReview: docsPending?.c ?? 0,
  });
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const logs = await db
    .select()
    .from(auditLogsTable)
    .orderBy(sql`${auditLogsTable.createdAt} desc`)
    .limit(20);

  const items = logs.map((l) => ({
    id: l.id,
    type: l.action,
    description: `${l.action} on ${l.entityType}${l.entityLabel ? ` — ${l.entityLabel}` : ""}`,
    descriptionAr: `${l.action} على ${l.entityType}${l.entityLabel ? ` — ${l.entityLabel}` : ""}`,
    actorName: l.actorUserId ? `User #${l.actorUserId}` : "System",
    entityType: l.entityType,
    entityId: l.entityId ?? 0,
    createdAt: l.createdAt.toISOString(),
  }));

  res.json(items);
});

router.get("/dashboard/attendance-overview", async (req, res): Promise<void> => {
  const today = new Date().toISOString().slice(0, 10);

  const depts = await db.select().from(departmentsTable);
  const todayRecords = await db
    .select()
    .from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.date, today));

  const byDept = depts.map((d) => {
    const recs = todayRecords.filter((r) => r.departmentId === d.id);
    return {
      departmentId: d.id,
      departmentName: d.nameEn,
      present: recs.filter((r) => r.status === "present").length,
      absent: recs.filter((r) => r.status === "absent").length,
      late: recs.filter((r) => r.status === "late").length,
      onLeave: recs.filter((r) => r.status === "on_leave").length,
    };
  });

  res.json({
    date: today,
    presentCount: todayRecords.filter((r) => r.status === "present").length,
    absentCount: todayRecords.filter((r) => r.status === "absent").length,
    lateCount: todayRecords.filter((r) => r.status === "late").length,
    onLeaveCount: todayRecords.filter((r) => r.status === "on_leave").length,
    byDepartment: byDept,
  });
});

router.get("/dashboard/executive", async (req, res): Promise<void> => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const start30 = daysAgo(29);
  const start7 = daysAgo(6);

  const [depts, employees, records30, rosters30, shifts, otRules] = await Promise.all([
    db.select().from(departmentsTable),
    db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
    db.select().from(attendanceRecordsTable).where(
      and(gte(attendanceRecordsTable.date, start30), lte(attendanceRecordsTable.date, today))
    ),
    db.select().from(rostersTable).where(
      and(gte(rostersTable.date, start30), lte(rostersTable.date, today))
    ),
    db.select().from(shiftsTable),
    db.select().from(overtimeRulesTable).where(eq(overtimeRulesTable.isActive, true)),
  ]);

  const empById = new Map(employees.map((e) => [e.id, e]));
  const activeCount = employees.length;

  // ── 30-day attendance rate trend ──
  const attendanceTrend: { date: string; presentCount: number; totalCount: number; ratePct: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = daysAgo(i);
    const dayRecs = records30.filter((r) => r.date === d);
    const presentCount = dayRecs.filter((r) => r.status === "present" || r.status === "late").length;
    const totalCount = dayRecs.length;
    attendanceTrend.push({
      date: d,
      presentCount,
      totalCount,
      ratePct: totalCount > 0 ? Math.round((presentCount / totalCount) * 1000) / 10 : 0,
    });
  }

  // ── Shift coverage gaps (last 7 days): scheduled vs worked per shift per day ──
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const coverageGaps: {
    date: string; shiftId: number; shiftCode: string; shiftNameEn: string; shiftNameAr: string;
    scheduled: number; worked: number; gap: number;
  }[] = [];
  const rosters7 = rosters30.filter((r) => r.date >= start7 && r.date <= today && !r.isOffDay && r.shiftId != null);
  const gapKey = new Map<string, { date: string; shiftId: number; scheduled: number; worked: number }>();
  for (const r of rosters7) {
    const key = `${r.date}|${r.shiftId}`;
    const entry = gapKey.get(key) ?? { date: r.date, shiftId: r.shiftId!, scheduled: 0, worked: 0 };
    entry.scheduled += 1;
    if (r.status === "worked" || r.status === "overtime" || r.status === "late") entry.worked += 1;
    gapKey.set(key, entry);
  }
  for (const e of Array.from(gapKey.values()).sort((a, b) => a.date.localeCompare(b.date) || a.shiftId - b.shiftId)) {
    const s = shiftById.get(e.shiftId);
    coverageGaps.push({
      date: e.date,
      shiftId: e.shiftId,
      shiftCode: s?.shiftCode ?? String(e.shiftId),
      shiftNameEn: s?.nameEn ?? "Unknown",
      shiftNameAr: s?.nameAr ?? "غير معروف",
      scheduled: e.scheduled,
      worked: e.worked,
      gap: e.scheduled - e.worked,
    });
  }

  // ── OT cost index by department (last 30 days OT minutes × weekday multiplier) ──
  const globalRule = otRules.find((r) => r.departmentId == null);
  const ruleByDept = new Map(otRules.filter((r) => r.departmentId != null).map((r) => [r.departmentId!, r]));
  const otByDept = new Map<number, number>();
  for (const r of records30) {
    if (r.overtimeMinutes && r.overtimeMinutes > 0) {
      otByDept.set(r.departmentId, (otByDept.get(r.departmentId) ?? 0) + r.overtimeMinutes);
    }
  }
  const otCostByDepartment = depts
    .map((d) => {
      const otMinutes = otByDept.get(d.id) ?? 0;
      const rule = ruleByDept.get(d.id) ?? globalRule;
      const multiplier = rule ? Number(rule.multiplierWeekday) : 1.5;
      return {
        departmentId: d.id,
        departmentNameEn: d.nameEn,
        departmentNameAr: d.nameAr,
        otMinutes,
        multiplier,
        costIndex: Math.round(otMinutes * multiplier),
      };
    })
    .filter((d) => d.otMinutes > 0)
    .sort((a, b) => b.costIndex - a.costIndex);

  // ── Top 5 latecomers this week ──
  const lateAgg = new Map<number, { totalLateMinutes: number; occurrences: number }>();
  for (const r of records30) {
    if (r.date >= start7 && r.lateMinutes && r.lateMinutes > 0) {
      const e = lateAgg.get(r.employeeId) ?? { totalLateMinutes: 0, occurrences: 0 };
      e.totalLateMinutes += r.lateMinutes;
      e.occurrences += 1;
      lateAgg.set(r.employeeId, e);
    }
  }
  const topLatecomers = Array.from(lateAgg.entries())
    .map(([employeeId, v]) => {
      const emp = empById.get(employeeId);
      return {
        employeeId,
        nameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : `#${employeeId}`,
        nameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : `#${employeeId}`,
        totalLateMinutes: v.totalLateMinutes,
        occurrences: v.occurrences,
      };
    })
    .sort((a, b) => b.totalLateMinutes - a.totalLateMinutes)
    .slice(0, 5);

  // ── Department heat map: last 7 days, rostered vs present per department ──
  const days7: string[] = [];
  for (let i = 6; i >= 0; i--) days7.push(daysAgo(i));
  const departmentHeatmap = depts.map((d) => {
    const deptEmpIds = new Set(employees.filter((e) => e.departmentId === d.id).map((e) => e.id));
    const days = days7.map((date) => {
      const rostered = rosters30.filter(
        (r) => r.date === date && !r.isOffDay && deptEmpIds.has(r.employeeId)
      ).length;
      const present = records30.filter(
        (r) => r.date === date && r.departmentId === d.id && (r.status === "present" || r.status === "late")
      ).length;
      return {
        date,
        rostered,
        present,
        ratePct: rostered > 0 ? Math.round((present / rostered) * 1000) / 10 : 0,
      };
    });
    return {
      departmentId: d.id,
      departmentNameEn: d.nameEn,
      departmentNameAr: d.nameAr,
      headcount: deptEmpIds.size,
      days,
    };
  }).filter((d) => d.headcount > 0);

  // ── Today's coverage % ──
  const todayRosters = rosters30.filter((r) => r.date === today && !r.isOffDay);
  const todayPresent = records30.filter(
    (r) => r.date === today && (r.status === "present" || r.status === "late")
  ).length;
  const todayCoveragePct = todayRosters.length > 0
    ? Math.round((todayPresent / todayRosters.length) * 1000) / 10
    : (activeCount > 0 ? Math.round((todayPresent / activeCount) * 1000) / 10 : 0);

  res.json({
    generatedAt: now.toISOString(),
    todayCoveragePct,
    attendanceTrend,
    coverageGaps,
    otCostByDepartment,
    topLatecomers,
    departmentHeatmap,
  });
});

export default router;
