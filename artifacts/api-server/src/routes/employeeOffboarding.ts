import { Router } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogsTable,
  db,
  employeeOffboardingTable,
  employeesTable,
  offboardingTasksTable,
} from "@workspace/db";
import { getActorUserId } from "../middleware/requireAuth.js";
import { resolveOrgId } from "../lib/orgContext.js";

const router = Router();

const separationTypes = ["resignation", "termination", "retirement", "contract_end", "transfer", "death", "other"] as const;
const workflowStatuses = ["draft", "in_progress", "blocked", "completed", "cancelled"] as const;
const taskStatuses = ["pending", "in_progress", "completed", "skipped", "blocked"] as const;

const createSchema = z.object({
  employeeId: z.number().int().positive(),
  separationType: z.enum(separationTypes),
  noticeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lastWorkingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  managerEmployeeId: z.number().int().positive().optional().nullable(),
  reason: z.string().max(5000).optional().nullable(),
  eligibleForRehire: z.boolean().optional().nullable(),
});

const updateSchema = z.object({
  separationType: z.enum(separationTypes).optional(),
  noticeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lastWorkingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(workflowStatuses).optional(),
  managerEmployeeId: z.number().int().positive().optional().nullable(),
  reason: z.string().max(5000).optional().nullable(),
  eligibleForRehire: z.boolean().optional().nullable(),
  exitInterviewCompletedAt: z.coerce.date().optional().nullable(),
  finalSettlementCompletedAt: z.coerce.date().optional().nullable(),
});

const createTaskSchema = z.object({
  titleEn: z.string().min(1).max(300),
  titleAr: z.string().min(1).max(300),
  ownerRole: z.enum(["hr", "manager", "employee", "it", "finance", "security", "facilities"]).default("hr"),
  controlArea: z.string().min(1).max(30).default("general"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  isRequired: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  notes: z.string().max(5000).optional().nullable(),
});

const updateTaskSchema = z.object({
  status: z.enum(taskStatuses).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const defaultTasks = [
  { titleEn: "Complete knowledge handover", titleAr: "إكمال تسليم المعرفة", ownerRole: "manager", controlArea: "handover", sortOrder: 10 },
  { titleEn: "Return equipment and organizational property", titleAr: "إعادة المعدات وممتلكات المؤسسة", ownerRole: "facilities", controlArea: "assets", sortOrder: 20 },
  { titleEn: "Revoke systems and physical access", titleAr: "إلغاء صلاحيات الأنظمة والدخول", ownerRole: "it", controlArea: "access", sortOrder: 30 },
  { titleEn: "Return ID card, keys and credentials", titleAr: "إعادة بطاقة الهوية والمفاتيح وبيانات الاعتماد", ownerRole: "security", controlArea: "security", sortOrder: 40 },
  { titleEn: "Complete final payroll settlement", titleAr: "إكمال التسوية النهائية للرواتب", ownerRole: "finance", controlArea: "settlement", sortOrder: 50 },
  { titleEn: "Conduct and record exit interview", titleAr: "إجراء وتوثيق مقابلة الخروج", ownerRole: "hr", controlArea: "exit_interview", sortOrder: 60 },
] as const;

function parseId(value: string | string[]): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadScopedOffboarding(req: Parameters<typeof resolveOrgId>[0], id: number) {
  const orgId = await resolveOrgId(req);
  const [row] = await db.select().from(employeeOffboardingTable)
    .where(and(eq(employeeOffboardingTable.id, id), eq(employeeOffboardingTable.orgId, orgId)));
  return row;
}

async function recalculateProgress(offboardingId: number): Promise<void> {
  const tasks = await db.select().from(offboardingTasksTable)
    .where(eq(offboardingTasksTable.offboardingId, offboardingId));
  const done = tasks.filter((task) => task.status === "completed" || (!task.isRequired && task.status === "skipped")).length;
  const completionPct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  const blocked = tasks.some((task) => task.status === "blocked");
  const completed = tasks.length > 0 && tasks.every((task) => task.status === "completed" || (!task.isRequired && task.status === "skipped"));
  await db.update(employeeOffboardingTable).set({
    completionPct,
    status: completed ? "completed" : blocked ? "blocked" : "in_progress",
    completedAt: completed ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(employeeOffboardingTable.id, offboardingId));
}

router.get("/", async (req, res): Promise<void> => {
  const orgId = await resolveOrgId(req);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const conditions = [eq(employeeOffboardingTable.orgId, orgId)];
  if (typeof req.query.status === "string") conditions.push(eq(employeeOffboardingTable.status, req.query.status));
  const where = and(...conditions);
  const rows = await db.select({
    id: employeeOffboardingTable.id,
    orgId: employeeOffboardingTable.orgId,
    employeeId: employeeOffboardingTable.employeeId,
    employeeNameEn: sql<string>`${employeesTable.firstNameEn} || ' ' || ${employeesTable.lastNameEn}`,
    employeeNameAr: sql<string | null>`${employeesTable.firstNameAr} || ' ' || ${employeesTable.lastNameAr}`,
    separationType: employeeOffboardingTable.separationType,
    noticeDate: employeeOffboardingTable.noticeDate,
    lastWorkingDate: employeeOffboardingTable.lastWorkingDate,
    status: employeeOffboardingTable.status,
    completionPct: employeeOffboardingTable.completionPct,
    eligibleForRehire: employeeOffboardingTable.eligibleForRehire,
    createdAt: employeeOffboardingTable.createdAt,
  }).from(employeeOffboardingTable)
    .leftJoin(employeesTable, eq(employeeOffboardingTable.employeeId, employeesTable.id))
    .where(where)
    .orderBy(desc(employeeOffboardingTable.createdAt))
    .limit(limit).offset((page - 1) * limit);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(employeeOffboardingTable).where(where);
  res.json({ data: rows, total: Number(count), page, limit });
});

router.post("/", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid offboarding request", details: parsed.error.flatten() });
  const orgId = await resolveOrgId(req);
  const actorUserId = getActorUserId(req);
  const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable)
    .where(and(eq(employeesTable.id, parsed.data.employeeId), eq(employeesTable.orgId, orgId)));
  if (!employee) return void res.status(404).json({ error: "Employee not found in the active organization" });

  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(employeeOffboardingTable).values({
      ...parsed.data, orgId, hrOwnerUserId: actorUserId, status: "in_progress",
    }).returning();
    await tx.insert(offboardingTasksTable).values(defaultTasks.map((task) => ({ ...task, offboardingId: created.id })));
    await tx.insert(auditLogsTable).values({
      actorUserId, action: "create", entityType: "employee_offboarding", entityId: created.id,
      changesJson: JSON.stringify({ employeeId: created.employeeId, separationType: created.separationType, lastWorkingDate: created.lastWorkingDate }),
    });
    return created;
  });
  res.status(201).json(row);
});

router.get("/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid offboarding id" });
  const row = await loadScopedOffboarding(req, id);
  if (!row) return void res.status(404).json({ error: "Offboarding record not found" });
  res.json(row);
});

router.patch("/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid offboarding id" });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid offboarding update", details: parsed.error.flatten() });
  if (!await loadScopedOffboarding(req, id)) return void res.status(404).json({ error: "Offboarding record not found" });
  const [row] = await db.update(employeeOffboardingTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(employeeOffboardingTable.id, id)).returning();
  await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "employee_offboarding", entityId: id, changesJson: JSON.stringify(parsed.data) });
  res.json(row);
});

router.get("/:id/tasks", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid offboarding id" });
  if (!await loadScopedOffboarding(req, id)) return void res.status(404).json({ error: "Offboarding record not found" });
  const rows = await db.select().from(offboardingTasksTable)
    .where(eq(offboardingTasksTable.offboardingId, id)).orderBy(asc(offboardingTasksTable.sortOrder));
  res.json({ data: rows, total: rows.length });
});

router.post("/:id/tasks", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid offboarding id" });
  if (!await loadScopedOffboarding(req, id)) return void res.status(404).json({ error: "Offboarding record not found" });
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid offboarding task", details: parsed.error.flatten() });
  const [task] = await db.insert(offboardingTasksTable).values({ ...parsed.data, offboardingId: id }).returning();
  await recalculateProgress(id);
  await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "offboarding_task", entityId: task.id, changesJson: JSON.stringify(parsed.data) });
  res.status(201).json(task);
});

router.patch("/:id/tasks/:taskId", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const taskId = parseId(req.params.taskId);
  if (!id || !taskId) return void res.status(400).json({ error: "Invalid offboarding or task id" });
  if (!await loadScopedOffboarding(req, id)) return void res.status(404).json({ error: "Offboarding record not found" });
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid offboarding task update", details: parsed.error.flatten() });
  const completed = parsed.data.status === "completed";
  const [task] = await db.update(offboardingTasksTable).set({
    ...parsed.data,
    completedAt: completed ? new Date() : parsed.data.status ? null : undefined,
    completedByUserId: completed ? getActorUserId(req) : parsed.data.status ? null : undefined,
    updatedAt: new Date(),
  }).where(and(eq(offboardingTasksTable.id, taskId), eq(offboardingTasksTable.offboardingId, id))).returning();
  if (!task) return void res.status(404).json({ error: "Offboarding task not found" });
  await recalculateProgress(id);
  await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "offboarding_task", entityId: task.id, changesJson: JSON.stringify(parsed.data) });
  res.json(task);
});

export default router;
