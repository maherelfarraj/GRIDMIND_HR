import { Router } from "express";
import { db, departmentsTable, employeesTable } from "@workspace/db";
import { eq, and, count, inArray, isNotNull } from "drizzle-orm";
import {
  CreateDepartmentBody, UpdateDepartmentBody,
  GetDepartmentParams, UpdateDepartmentParams, DeleteDepartmentParams,
} from "@workspace/api-zod";
import { resolveOrgId } from "../lib/orgContext.js";
import { getActorAdminStatus } from "../lib/adminAuth.js";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildDeptResponse(d: typeof departmentsTable.$inferSelect) {
  const [{ empCount }] = await db
    .select({ empCount: count() })
    .from(employeesTable)
    .where(eq(employeesTable.departmentId, d.id));

  let parentNameEn: string | null = null;
  if (d.parentId) {
    const [parent] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, d.parentId));
    if (parent) parentNameEn = parent.nameEn;
  }

  let headEmployeeNameEn: string | null = null;
  if (d.headEmployeeId) {
    const [head] = await db.select().from(employeesTable).where(eq(employeesTable.id, d.headEmployeeId));
    if (head) headEmployeeNameEn = `${head.firstNameEn} ${head.lastNameEn}`;
  }

  return {
    ...d,
    parentNameEn,
    headEmployeeNameEn,
    employeeCount: empCount,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Return the set of department IDs that have at least one employee in the given org. */
async function orgDeptIds(orgId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ departmentId: employeesTable.departmentId })
    .from(employeesTable)
    .where(and(eq(employeesTable.orgId, orgId), isNotNull(employeesTable.departmentId)));
  return rows.map((r) => r.departmentId).filter((id): id is number => id !== null);
}

router.get("/departments", async (req, res): Promise<void> => {
  const orgId = await resolveOrgId(req);
  const deptIds = await orgDeptIds(orgId);

  const depts = deptIds.length > 0
    ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, deptIds))
    : [];

  const empCounts = await db
    .select({ deptId: employeesTable.departmentId, c: count() })
    .from(employeesTable)
    .where(eq(employeesTable.orgId, orgId))
    .groupBy(employeesTable.departmentId);
  const countMap = Object.fromEntries(empCounts.map((e) => [e.deptId, e.c]));
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));

  const result = depts.map((d) => ({
    ...d,
    parentNameEn: d.parentId ? (deptMap[d.parentId]?.nameEn ?? null) : null,
    parentNameAr: d.parentId ? (deptMap[d.parentId]?.nameAr ?? null) : null,
    headEmployeeNameEn: null,
    employeeCount: countMap[d.id] ?? 0,
    createdAt: d.createdAt.toISOString(),
  }));
  res.json(result);
});

router.post("/departments", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [dept] = await db.insert(departmentsTable).values(parsed.data).returning();
  res.status(201).json(await buildDeptResponse(dept));
});

router.get("/departments/tree", async (req, res): Promise<void> => {
  const orgId = await resolveOrgId(req);
  const deptIds = await orgDeptIds(orgId);

  const depts = deptIds.length > 0
    ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, deptIds))
    : [];

  const empCounts = await db
    .select({ deptId: employeesTable.departmentId, c: count() })
    .from(employeesTable)
    .where(eq(employeesTable.orgId, orgId))
    .groupBy(employeesTable.departmentId);
  const countMap = Object.fromEntries(empCounts.map((e) => [e.deptId, e.c]));

  type TreeNode = {
    id: number; nameEn: string; nameAr: string; code: string;
    parentId: number | null; headEmployeeNameEn: string | null;
    employeeCount: number; children: TreeNode[];
  };

  const nodeMap: Record<number, TreeNode> = {};
  for (const d of depts) {
    nodeMap[d.id] = {
      id: d.id, nameEn: d.nameEn, nameAr: d.nameAr, code: d.code,
      parentId: d.parentId, headEmployeeNameEn: null,
      employeeCount: countMap[d.id] ?? 0,
      children: [],
    };
  }

  const roots: TreeNode[] = [];
  for (const node of Object.values(nodeMap)) {
    if (node.parentId && nodeMap[node.parentId]) {
      nodeMap[node.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  res.json(roots);
});

router.get("/departments/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, id));
  if (!dept) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildDeptResponse(dept));
});

router.patch("/departments/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const id = parseId(req.params.id);
  const parsed = UpdateDepartmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [dept] = await db.update(departmentsTable).set(parsed.data).where(eq(departmentsTable.id, id)).returning();
  if (!dept) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildDeptResponse(dept));
});

router.delete("/departments/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const id = parseId(req.params.id);
  await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
  res.status(204).end();
});

export default router;
