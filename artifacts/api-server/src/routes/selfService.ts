import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, employeeRequestsTable, announcementsTable, approvalDelegationsTable, auditLogsTable } from "@workspace/db";

// Employee Requests Router
const employeeRequestsRouter = Router();

employeeRequestsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, requestType, status } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(employeeRequestsTable.employeeId, parseInt(employeeId)));
    if (requestType) conditions.push(eq(employeeRequestsTable.requestType, requestType));
    if (status) conditions.push(eq(employeeRequestsTable.status, status));

    const query = db.select().from(employeeRequestsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(employeeRequestsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(employeeRequestsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(employeeRequestsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeRequestsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(employeeRequestsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "employee_request", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeRequestsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(employeeRequestsTable).where(eq(employeeRequestsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeRequestsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(employeeRequestsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(employeeRequestsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "employee_request", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

employeeRequestsRouter.post("/:id/fulfill", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(employeeRequestsTable)
      .set({ status: "fulfilled", fulfilledAt: new Date(), updatedAt: new Date() })
      .where(eq(employeeRequestsTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "fulfill", entityType: "employee_request", entityId: row.id, changesJson: JSON.stringify({ status: "fulfilled" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Announcements Router
const announcementsRouter = Router();

announcementsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { category, status } = req.query as Record<string, string>;

    const conditions = [];
    if (category) conditions.push(eq(announcementsTable.category, category));
    if (status) conditions.push(eq(announcementsTable.status, status));

    const query = db.select().from(announcementsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(announcementsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(announcementsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(announcementsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

announcementsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(announcementsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "announcement", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

announcementsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(announcementsTable).where(eq(announcementsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

announcementsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(announcementsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(announcementsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "announcement", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

announcementsRouter.post("/:id/publish", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(announcementsTable)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(announcementsTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "publish", entityType: "announcement", entityId: row.id, changesJson: JSON.stringify({ status: "published" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Approval Delegations Router
const approvalDelegationsRouter = Router();

approvalDelegationsRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { delegatorEmployeeId, delegateEmployeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (delegatorEmployeeId) conditions.push(eq(approvalDelegationsTable.delegatorEmployeeId, parseInt(delegatorEmployeeId)));
    if (delegateEmployeeId) conditions.push(eq(approvalDelegationsTable.delegateEmployeeId, parseInt(delegateEmployeeId)));
    if (status) conditions.push(eq(approvalDelegationsTable.status, status));

    const query = db.select().from(approvalDelegationsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(approvalDelegationsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(approvalDelegationsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(approvalDelegationsTable.createdAt)).limit(limit).offset(offset);
    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

approvalDelegationsRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(approvalDelegationsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "approval_delegation", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

approvalDelegationsRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(approvalDelegationsTable).where(eq(approvalDelegationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

approvalDelegationsRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(approvalDelegationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(approvalDelegationsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "approval_delegation", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export { employeeRequestsRouter, announcementsRouter, approvalDelegationsRouter };
