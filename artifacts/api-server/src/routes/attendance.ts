import { Router } from "express";
import { db, attendanceRecordsTable, employeesTable, departmentsTable, attendanceDevicesTable } from "@workspace/db";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { ListAttendanceQueryParams } from "@workspace/api-zod";
import { resolveOrgId } from "../lib/orgContext";

const router = Router();

router.get("/attendance", async (req, res): Promise<void> => {
  const parsed = ListAttendanceQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const orgId = await resolveOrgId(req);
  const conditions = [eq(attendanceRecordsTable.orgId, orgId)];
  if (q.employeeId) conditions.push(eq(attendanceRecordsTable.employeeId, q.employeeId));
  if (q.departmentId) conditions.push(eq(attendanceRecordsTable.departmentId, q.departmentId));
  if (q.date) conditions.push(eq(attendanceRecordsTable.date, q.date));
  if (q.from) conditions.push(gte(attendanceRecordsTable.date, q.from));
  if (q.to) conditions.push(lte(attendanceRecordsTable.date, q.to));

  const page = q.page ?? 1;
  const limit = q.limit ?? 50;
  const offset = (page - 1) * limit;

  const [records, [{ total }], emps, depts, devices] = await Promise.all([
    db.select().from(attendanceRecordsTable)
      .where(and(...conditions))
      .orderBy(sql`${attendanceRecordsTable.date} desc, ${attendanceRecordsTable.id} desc`)
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(attendanceRecordsTable).where(and(...conditions)),
    db.select().from(employeesTable),
    db.select().from(departmentsTable),
    db.select().from(attendanceDevicesTable),
  ]);

  const empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));
  const deviceMap = Object.fromEntries(devices.map((d) => [d.id, d]));

  const data = records.map((r) => {
    const emp = empMap[r.employeeId];
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "",
      employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "",
      departmentId: r.departmentId,
      departmentNameEn: deptMap[r.departmentId]?.nameEn ?? "",
      date: r.date,
      checkInTime: r.checkInTime ?? null,
      checkOutTime: r.checkOutTime ?? null,
      status: r.status,
      deviceId: r.deviceId ?? null,
      deviceName: r.deviceId ? (deviceMap[r.deviceId]?.name ?? null) : null,
      lateMinutes: r.lateMinutes ?? null,
      overtimeMinutes: r.overtimeMinutes ?? null,
      workingHours: r.workingHours ?? null,
      notes: r.notes ?? null,
    };
  });
  res.json({ data, total: Number(total), page, limit });
});

router.get("/attendance/daily-summary", async (req, res): Promise<void> => {
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = typeof req.query.date === "string" && req.query.date ? req.query.date : today;
  const filterDepartmentId = req.query.departmentId ? Number(req.query.departmentId) : null;

  const orgId = await resolveOrgId(req);
  const deptsAll = await db.select().from(departmentsTable);
  const depts = filterDepartmentId != null
    ? deptsAll.filter((d) => d.id === filterDepartmentId)
    : deptsAll;

  const recordConditions = [
    eq(attendanceRecordsTable.date, targetDate),
    eq(attendanceRecordsTable.orgId, orgId),
  ];
  if (filterDepartmentId != null) {
    recordConditions.push(eq(attendanceRecordsTable.departmentId, filterDepartmentId));
  }
  const records = await db.select().from(attendanceRecordsTable)
    .where(and(...recordConditions));

  const empConditions = [
    eq(employeesTable.status, "active"),
    eq(employeesTable.orgId, orgId),
  ];
  if (filterDepartmentId != null) {
    empConditions.push(eq(employeesTable.departmentId, filterDepartmentId));
  }
  const empCounts = await db
    .select({ deptId: employeesTable.departmentId, c: count() })
    .from(employeesTable)
    .where(and(...empConditions))
    .groupBy(employeesTable.departmentId);
  const empCountMap = Object.fromEntries(empCounts.map((e) => [e.deptId, e.c]));

  const result = depts.map((d) => {
    const recs = records.filter((r) => r.departmentId === d.id);
    const total = empCountMap[d.id] ?? 0;
    const present = recs.filter((r) => r.status === "present").length;
    const absent = recs.filter((r) => r.status === "absent").length;
    const late = recs.filter((r) => r.status === "late").length;
    const onLeave = recs.filter((r) => r.status === "on_leave").length;
    return {
      departmentId: d.id,
      departmentNameEn: d.nameEn,
      departmentNameAr: d.nameAr,
      date: targetDate,
      totalEmployees: total,
      present,
      absent,
      late,
      onLeave,
      attendanceRate: total > 0 ? Math.round(((present + late) / total) * 100) / 100 : 0,
    };
  });
  res.json(result);
});

export default router;
