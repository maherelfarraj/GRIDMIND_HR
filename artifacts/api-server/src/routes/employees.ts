import { Router } from "express";
import { db, employeesTable, departmentsTable, rolesTable, documentsTable, attendanceRecordsTable, systemUsersTable } from "@workspace/db";
import { eq, and, ilike, sql, count } from "drizzle-orm";
import {
  CreateEmployeeBody, UpdateEmployeeBody, ListEmployeesQueryParams,
} from "@workspace/api-zod";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildEmployeeResponse(emp: typeof employeesTable.$inferSelect) {
  const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, emp.departmentId));
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, emp.roleId));
  let managerNameEn: string | null = null;
  if (emp.managerId) {
    const [mgr] = await db.select().from(employeesTable).where(eq(employeesTable.id, emp.managerId));
    if (mgr) managerNameEn = `${mgr.firstNameEn} ${mgr.lastNameEn}`;
  }
  return {
    ...emp,
    departmentNameEn: dept?.nameEn ?? "",
    departmentNameAr: dept?.nameAr ?? "",
    roleNameEn: role?.nameEn ?? "",
    managerNameEn,
    hireDate: emp.hireDate,
    contractEndDate: emp.contractEndDate ?? null,
    createdAt: emp.createdAt.toISOString(),
    updatedAt: emp.updatedAt.toISOString(),
  };
}

router.get("/employees", async (req, res): Promise<void> => {
  const parsed = ListEmployeesQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  let query = db.select().from(employeesTable).$dynamic();

  const conditions = [];
  if (q.departmentId) conditions.push(eq(employeesTable.departmentId, q.departmentId));
  if (q.status) conditions.push(eq(employeesTable.status, q.status));
  if (q.search) conditions.push(ilike(employeesTable.firstNameEn, `%${q.search}%`));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  const offset = (page - 1) * limit;

  const employees = await query.limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(employeesTable);

  const depts = await db.select().from(departmentsTable);
  const roles = await db.select().from(rolesTable);
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));

  const data = employees.map((emp) => ({
    ...emp,
    departmentNameEn: deptMap[emp.departmentId]?.nameEn ?? "",
    departmentNameAr: deptMap[emp.departmentId]?.nameAr ?? "",
    roleNameEn: roleMap[emp.roleId]?.nameEn ?? "",
    managerNameEn: null,
    hireDate: emp.hireDate,
    contractEndDate: emp.contractEndDate ?? null,
    createdAt: emp.createdAt.toISOString(),
    updatedAt: emp.updatedAt.toISOString(),
  }));

  res.json({ data, total, page, limit });
});

router.post("/employees", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [emp] = await db.insert(employeesTable).values(parsed.data).returning();
  const result = await buildEmployeeResponse(emp);
  res.status(201).json(result);
});

router.get("/employees/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildEmployeeResponse(emp));
});

router.patch("/employees/:id", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseId(req.params.id);
  const parsed = UpdateEmployeeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [emp] = await db.update(employeesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning();
  if (!emp) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildEmployeeResponse(emp));
});

router.delete("/employees/:id", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseId(req.params.id);
  await db.delete(employeesTable).where(eq(employeesTable.id, id));
  res.status(204).end();
});

router.get("/employees/:id/documents", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.employeeId, id));
  const users = await db.select().from(systemUsersTable);
  const empRow = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  const emp = empRow[0];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const result = docs.map((d) => ({
    ...d,
    employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "",
    uploadedByUserName: userMap[d.uploadedByUserId]?.fullNameEn ?? "System",
    expiresAt: d.expiresAt ?? null,
    issuedAt: d.issuedAt ?? null,
    createdAt: d.createdAt.toISOString(),
  }));
  res.json(result);
});

router.get("/employees/:id/attendance", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const records = await db.select().from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.employeeId, id))
    .orderBy(sql`${attendanceRecordsTable.date} desc`)
    .limit(60);

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  const depts = await db.select().from(departmentsTable);
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));

  const result = records.map((r) => ({
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
    deviceName: null,
    lateMinutes: r.lateMinutes ?? null,
    overtimeMinutes: r.overtimeMinutes ?? null,
    workingHours: r.workingHours ?? null,
    notes: r.notes ?? null,
  }));
  res.json(result);
});

export default router;
