import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { db, rolesTable, systemUsersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { CreateRoleBody, UpdateRoleBody } from "@workspace/api-zod";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

const ALL_PERMISSIONS = [
  { key: "employees.view", nameEn: "View Employees", nameAr: "عرض الموظفين", module: "employees" },
  { key: "employees.create", nameEn: "Create Employees", nameAr: "إنشاء موظفين", module: "employees" },
  { key: "employees.edit", nameEn: "Edit Employees", nameAr: "تعديل الموظفين", module: "employees" },
  { key: "employees.delete", nameEn: "Delete Employees", nameAr: "حذف الموظفين", module: "employees" },
  { key: "departments.view", nameEn: "View Departments", nameAr: "عرض الأقسام", module: "departments" },
  { key: "departments.manage", nameEn: "Manage Departments", nameAr: "إدارة الأقسام", module: "departments" },
  { key: "documents.view", nameEn: "View Documents", nameAr: "عرض المستندات", module: "documents" },
  { key: "documents.upload", nameEn: "Upload Documents", nameAr: "رفع المستندات", module: "documents" },
  { key: "documents.delete", nameEn: "Delete Documents", nameAr: "حذف المستندات", module: "documents" },
  { key: "approvals.view", nameEn: "View Approvals", nameAr: "عرض الموافقات", module: "approvals" },
  { key: "approvals.decide", nameEn: "Decide Approvals", nameAr: "اتخاذ قرار الموافقات", module: "approvals" },
  { key: "attendance.view", nameEn: "View Attendance", nameAr: "عرض الحضور", module: "attendance" },
  { key: "attendance.manage", nameEn: "Manage Attendance", nameAr: "إدارة الحضور", module: "attendance" },
  { key: "devices.view", nameEn: "View Devices", nameAr: "عرض الأجهزة", module: "devices" },
  { key: "devices.manage", nameEn: "Manage Devices", nameAr: "إدارة الأجهزة", module: "devices" },
  { key: "audit.view", nameEn: "View Audit Log", nameAr: "عرض سجل التدقيق", module: "audit" },
  { key: "alerts.view", nameEn: "View Alerts", nameAr: "عرض التنبيهات", module: "alerts" },
  { key: "alerts.acknowledge", nameEn: "Acknowledge Alerts", nameAr: "الإقرار بالتنبيهات", module: "alerts" },
  { key: "users.view", nameEn: "View Users", nameAr: "عرض المستخدمين", module: "users" },
  { key: "users.manage", nameEn: "Manage Users", nameAr: "إدارة المستخدمين", module: "users" },
  { key: "roles.manage", nameEn: "Manage Roles", nameAr: "إدارة الأدوار", module: "roles" },
];

async function buildRoleResponse(role: typeof rolesTable.$inferSelect) {
  const [{ userCount }] = await db
    .select({ userCount: count() })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.roleId, role.id));

  let permissions: string[] = [];
  try { permissions = JSON.parse(role.permissionsJson); } catch {}

  return {
    id: role.id,
    nameEn: role.nameEn,
    nameAr: role.nameAr,
    description: role.description ?? null,
    permissions,
    systemRole: role.systemRole,
    userCount,
    createdAt: role.createdAt.toISOString(),
  };
}

router.get("/roles", async (req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable);
  const userCounts = await db
    .select({ roleId: systemUsersTable.roleId, c: count() })
    .from(systemUsersTable)
    .groupBy(systemUsersTable.roleId);
  const countMap = Object.fromEntries(userCounts.map((u) => [u.roleId, u.c]));

  const result = roles.map((r) => {
    let perms: string[] = [];
    try { perms = JSON.parse(r.permissionsJson); } catch {}
    return {
      id: r.id, nameEn: r.nameEn, nameAr: r.nameAr,
      description: r.description ?? null, permissions: perms,
      systemRole: r.systemRole, userCount: countMap[r.id] ?? 0,
      createdAt: r.createdAt.toISOString(),
    };
  });
  res.json(result);
});

router.post("/roles", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges to manage roles" }); return; }
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [role] = await db.insert(rolesTable).values({
    nameEn: parsed.data.nameEn,
    nameAr: parsed.data.nameAr,
    description: parsed.data.description ?? null,
    permissionsJson: JSON.stringify(parsed.data.permissions),
  }).returning();
  res.status(201).json(await buildRoleResponse(role));
});

router.get("/roles/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildRoleResponse(role));
});

router.patch("/roles/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges to manage roles" }); return; }
  const id = parseId(req.params.id);
  const parsed = UpdateRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updates: Record<string, unknown> = {};
  if (parsed.data.nameEn !== undefined) updates.nameEn = parsed.data.nameEn;
  if (parsed.data.nameAr !== undefined) updates.nameAr = parsed.data.nameAr;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.permissions !== undefined) updates.permissionsJson = JSON.stringify(parsed.data.permissions);
  const [role] = await db.update(rolesTable).set(updates).where(eq(rolesTable.id, id)).returning();
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildRoleResponse(role));
});

router.delete("/roles/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges to manage roles" }); return; }
  const id = parseId(req.params.id);
  await db.delete(rolesTable).where(eq(rolesTable.id, id));
  res.status(204).end();
});

router.get("/permissions", async (_req, res): Promise<void> => {
  res.json(ALL_PERMISSIONS);
});

export default router;
