import { Router } from "express";
import { db, employeesTable, departmentsTable, rolesTable, documentsTable, attendanceRecordsTable, systemUsersTable, auditLogsTable } from "@workspace/db";
import { eq, and, ilike, sql, count } from "drizzle-orm";
import {
  CreateEmployeeBody, UpdateEmployeeBody, ListEmployeesQueryParams,
} from "@workspace/api-zod";
import { reconcileTerminationStatuses } from "../lib/terminationReconciler.js";
import { resolveOrgId } from "../lib/orgContext";

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
  await reconcileTerminationStatuses();
  const parsed = ListEmployeesQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  let query = db.select().from(employeesTable).$dynamic();

  const orgId = await resolveOrgId(req);
  const conditions: any[] = [eq(employeesTable.orgId, orgId)];
  if (q.departmentId) conditions.push(eq(employeesTable.departmentId, q.departmentId));
  if (q.status) conditions.push(eq(employeesTable.status, q.status));
  if (q.search) conditions.push(ilike(employeesTable.firstNameEn, `%${q.search}%`));
  query = query.where(and(...conditions));

  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  const offset = (page - 1) * limit;

  const employees = await query.limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(employeesTable).where(and(...conditions));

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
  const actorUserId: number = (req as any).session?.userId ?? 1;
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const orgId = await resolveOrgId(req);
  const [emp] = await db.insert(employeesTable).values({ ...parsed.data, orgId }).returning();
  await db.insert(auditLogsTable).values({
    action: "create",
    entityType: "employee",
    entityId: emp.id,
    entityLabel: `${emp.firstNameEn} ${emp.lastNameEn}`,
    actorUserId,
    changesJson: JSON.stringify({ after: { employeeNumber: emp.employeeNumber, firstNameEn: emp.firstNameEn, lastNameEn: emp.lastNameEn } }),
  });
  const result = await buildEmployeeResponse(emp);
  res.status(201).json(result);
});

/** Load an employee only if it belongs to the request's org context. */
async function loadScopedEmployee(req: Parameters<typeof resolveOrgId>[0], id: number) {
  const orgId = await resolveOrgId(req);
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp || emp.orgId !== orgId) return null;
  return emp;
}

router.get("/employees/:id", async (req, res): Promise<void> => {
  await reconcileTerminationStatuses();
  const id = parseId(req.params.id);
  const emp = await loadScopedEmployee(req, id);
  if (!emp) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildEmployeeResponse(emp));
});

router.patch("/employees/:id", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const actorUserId: number = (req as any).session?.userId ?? 1;
  const id = parseId(req.params.id);
  const parsed = UpdateEmployeeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const before = await loadScopedEmployee(req, id);
  if (!before) { res.status(404).json({ error: "Not found" }); return; }

  // Offboarding state machine: status transitions are tied to the last
  // working day, for every payload combination.
  const update: Record<string, unknown> = { ...parsed.data };
  const bodyHasTermination = Object.prototype.hasOwnProperty.call(req.body, "terminationDate");
  const newTermination = bodyHasTermination ? (parsed.data.terminationDate ?? null) : (before.terminationDate ?? null);
  const todayStr = new Date().toISOString().slice(0, 10);
  if (parsed.data.status === "terminated") {
    if (!newTermination) {
      res.status(400).json({ error: "A terminationDate (last working day) is required to mark an employee as terminated" });
      return;
    }
    if (newTermination > todayStr) {
      res.status(400).json({ error: "Cannot mark an employee terminated before their last working day; the status will transition automatically on that date" });
      return;
    }
  }
  if (parsed.data.status === "active" && newTermination && newTermination <= todayStr) {
    res.status(400).json({ error: "Cannot set status to active while a past terminationDate is recorded; clear the terminationDate to reinstate the employee" });
    return;
  }
  if (parsed.data.status === undefined) {
    if (newTermination && newTermination <= todayStr && before.status === "active") {
      // Last working day has passed → the employee is terminated.
      update.status = "terminated";
    } else if (bodyHasTermination && !newTermination && before.status === "terminated") {
      // Clearing the last working day reinstates the employee.
      update.status = "active";
    }
  }
  const [emp] = await db.update(employeesTable)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning();
  if (!emp) { res.status(404).json({ error: "Not found" }); return; }
  // Build accurate before/after snapshots: only record the fields that were
  // included in the request body so the diff is meaningful.
  const changedKeys = Object.keys(parsed.data) as (keyof typeof parsed.data)[];
  const beforeSnapshot = Object.fromEntries(
    changedKeys.map((k) => [k, (before as Record<string, unknown>)[k] ?? null])
  );
  const afterSnapshot = Object.fromEntries(
    changedKeys.map((k) => [k, (emp as Record<string, unknown>)[k] ?? null])
  );
  await db.insert(auditLogsTable).values({
    action: "update",
    entityType: "employee",
    entityId: emp.id,
    entityLabel: `${emp.firstNameEn} ${emp.lastNameEn}`,
    actorUserId,
    changesJson: JSON.stringify({ before: beforeSnapshot, after: afterSnapshot }),
  });
  res.json(await buildEmployeeResponse(emp));
});

router.delete("/employees/:id", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseId(req.params.id);
  if (!(await loadScopedEmployee(req, id))) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(employeesTable).where(eq(employeesTable.id, id));
  res.status(204).end();
});

router.get("/employees/:id/documents", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const emp = await loadScopedEmployee(req, id);
  if (!emp) { res.status(404).json({ error: "Not found" }); return; }
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.employeeId, id));
  const users = await db.select().from(systemUsersTable);
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
  const emp = await loadScopedEmployee(req, id);
  if (!emp) { res.status(404).json({ error: "Not found" }); return; }
  const records = await db.select().from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.employeeId, id))
    .orderBy(sql`${attendanceRecordsTable.date} desc`)
    .limit(60);

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
