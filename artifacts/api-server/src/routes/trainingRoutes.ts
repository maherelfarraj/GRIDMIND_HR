import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  db,
  trainingProgramsTable, trainingCoursesTable, trainingSessionsTable,
  courseNominationsTable, trainingAttendanceTable, certificationsTable,
  employeeSkillsTable, auditLogsTable,
} from "@workspace/db";
import {
  CreateTrainingProgramBody, UpdateTrainingProgramBody,
  CreateTrainingCourseBody, UpdateTrainingCourseBody,
  CreateTrainingSessionBody, UpdateTrainingSessionBody,
  CreateCourseNominationBody, UpdateCourseNominationBody,
  CreateTrainingAttendanceBody, UpdateTrainingAttendanceRecordBody,
  CreateCertificationBody, UpdateCertificationBody,
  CreateEmployeeSkillBody, UpdateEmployeeSkillBody,
} from "@workspace/api-zod";
import { validateBody } from "../middleware/validateBody.js";

// Training Programs Router
const trainingProgramsRouter = Router();

trainingProgramsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const [{ count }] = await db.select({ count: sql`count(*)` }).from(trainingProgramsTable);
    const rows = await db.select().from(trainingProgramsTable).orderBy(desc(trainingProgramsTable.createdAt)).limit(limit).offset(offset);
    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingProgramsRouter.post("/", validateBody(CreateTrainingProgramBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(trainingProgramsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "training_program", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingProgramsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(trainingProgramsTable).where(eq(trainingProgramsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingProgramsRouter.patch("/:id", validateBody(UpdateTrainingProgramBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(trainingProgramsTable).set(req.body).where(eq(trainingProgramsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "training_program", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Training Courses Router
const trainingCoursesRouter = Router();

trainingCoursesRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { programId, category } = req.query as Record<string, string>;

    const conditions = [];
    if (programId) conditions.push(eq(trainingCoursesTable.programId, parseInt(programId)));
    if (category) conditions.push(eq(trainingCoursesTable.deliveryMode, category));

    const query = db.select().from(trainingCoursesTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(trainingCoursesTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(trainingCoursesTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(trainingCoursesTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingCoursesRouter.post("/", validateBody(CreateTrainingCourseBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(trainingCoursesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "training_course", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingCoursesRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingCoursesRouter.patch("/:id", validateBody(UpdateTrainingCourseBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(trainingCoursesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(trainingCoursesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "training_course", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Training Sessions Router
const trainingSessionsRouter = Router();

trainingSessionsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { courseId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (courseId) conditions.push(eq(trainingSessionsTable.courseId, parseInt(courseId)));
    if (status) conditions.push(eq(trainingSessionsTable.status, status));

    const query = db.select().from(trainingSessionsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(trainingSessionsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(trainingSessionsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(trainingSessionsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingSessionsRouter.post("/", validateBody(CreateTrainingSessionBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(trainingSessionsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "training_session", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingSessionsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(trainingSessionsTable).where(eq(trainingSessionsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingSessionsRouter.patch("/:id", validateBody(UpdateTrainingSessionBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(trainingSessionsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(trainingSessionsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "training_session", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Course Nominations Router
const courseNominationsRouter = Router();

courseNominationsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { sessionId, employeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (sessionId) conditions.push(eq(courseNominationsTable.sessionId, parseInt(sessionId)));
    if (employeeId) conditions.push(eq(courseNominationsTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(courseNominationsTable.status, status));

    const query = db.select().from(courseNominationsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(courseNominationsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(courseNominationsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(courseNominationsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

courseNominationsRouter.post("/", validateBody(CreateCourseNominationBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(courseNominationsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "course_nomination", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

courseNominationsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(courseNominationsTable).where(eq(courseNominationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

courseNominationsRouter.patch("/:id", validateBody(UpdateCourseNominationBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(courseNominationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(courseNominationsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "course_nomination", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Training Attendance Router
const trainingAttendanceRouter = Router();

trainingAttendanceRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { sessionId, employeeId } = req.query as Record<string, string>;

    const conditions = [];
    if (sessionId) conditions.push(eq(trainingAttendanceTable.sessionId, parseInt(sessionId)));
    if (employeeId) conditions.push(eq(trainingAttendanceTable.employeeId, parseInt(employeeId)));

    const query = db.select().from(trainingAttendanceTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(trainingAttendanceTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(trainingAttendanceTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(trainingAttendanceTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingAttendanceRouter.post("/", validateBody(CreateTrainingAttendanceBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(trainingAttendanceTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "training_attendance", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingAttendanceRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(trainingAttendanceTable).where(eq(trainingAttendanceTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

trainingAttendanceRouter.patch("/:id", validateBody(UpdateTrainingAttendanceRecordBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(trainingAttendanceTable).set({ ...req.body, updatedAt: new Date() }).where(eq(trainingAttendanceTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "training_attendance", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Certifications Router
const certificationsRouter = Router();

certificationsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, status, certType } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(certificationsTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(certificationsTable.status, status));
    if (certType) conditions.push(eq(certificationsTable.certType, certType));

    const query = db.select().from(certificationsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(certificationsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(certificationsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(certificationsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

certificationsRouter.post("/", validateBody(CreateCertificationBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(certificationsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "certification", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

certificationsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(certificationsTable).where(eq(certificationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

certificationsRouter.patch("/:id", validateBody(UpdateCertificationBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(certificationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(certificationsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "certification", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Employee Skills Router
const employeeSkillsRouter = Router();

employeeSkillsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, skillCategory } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(employeeSkillsTable.employeeId, parseInt(employeeId)));
    if (skillCategory) conditions.push(eq(employeeSkillsTable.skillCategory, skillCategory));

    const query = db.select().from(employeeSkillsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(employeeSkillsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(employeeSkillsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(employeeSkillsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeSkillsRouter.post("/", validateBody(CreateEmployeeSkillBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(employeeSkillsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "employee_skill", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeSkillsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(employeeSkillsTable).where(eq(employeeSkillsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeSkillsRouter.patch("/:id", validateBody(UpdateEmployeeSkillBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(employeeSkillsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(employeeSkillsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "employee_skill", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export {
  trainingProgramsRouter,
  trainingCoursesRouter,
  trainingSessionsRouter,
  courseNominationsRouter,
  trainingAttendanceRouter,
  certificationsRouter,
  employeeSkillsRouter,
};
