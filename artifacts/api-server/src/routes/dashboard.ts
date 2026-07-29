import { Router } from "express";
import { db } from "@workspace/db";
import {
  employeesTable, departmentsTable, approvalsTable,
  securityAlertsTable, attendanceDevicesTable, documentsTable,
  auditLogsTable, attendanceRecordsTable
} from "@workspace/db";
import { eq, and, sql, count, gte } from "drizzle-orm";

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

export default router;
