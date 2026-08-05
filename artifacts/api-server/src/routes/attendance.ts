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

  const records = await db.select().from(attendanceRecordsTable)
    .where(and(...conditions))
    .orderBy(sql`${attendanceRecordsTable.date} desc, ${attendanceRecordsTable.id} desc`)
    .limit(limit).offset(offset);

  const emps = await db.select().from(employeesTable);
  const depts = await db.select().from(departmentsTable);
  const devices = await db.select().from(attendanceDevicesTable);
  const empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));
  const deviceMap = Object.fromEntries(devices.map((d) => [d.id, d]));

  const result = records.map((r) => {
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
  res.json(result);
});

router.get("/attendance/daily-summary", async (req, res): Promise<void> => {
  const today = new Date().toISOString().slice(0, 10);
  const orgId = await resolveOrgId(req);
  const depts = await db.select().from(departmentsTable);
  const records = await db.select().from(attendanceRecordsTable)
    .where(and(eq(attendanceRecordsTable.date, today), eq(attendanceRecordsTable.orgId, orgId)));
  const empCounts = await db
    .select({ deptId: employeesTable.departmentId, c: count() })
    .from(employeesTable)
    .where(and(eq(employeesTable.status, "active"), eq(employeesTable.orgId, orgId)))
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
      date: today,
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
