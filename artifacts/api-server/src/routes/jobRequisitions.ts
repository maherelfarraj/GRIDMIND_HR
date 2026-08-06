import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, jobRequisitionsTable, auditLogsTable } from "@workspace/db";
import { CreateJobRequisitionBody, UpdateJobRequisitionBody } from "@workspace/api-zod";
import { validateBody } from "../middleware/validateBody.js";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { status, departmentId } = req.query as Record<string, string>;

    const conditions = [];
    if (status) conditions.push(eq(jobRequisitionsTable.status, status));
    if (departmentId) conditions.push(eq(jobRequisitionsTable.departmentId, parseInt(departmentId)));

    const query = db.select().from(jobRequisitionsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(jobRequisitionsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(jobRequisitionsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(jobRequisitionsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", validateBody(CreateJobRequisitionBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(jobRequisitionsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "job_requisition", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(jobRequisitionsTable).where(eq(jobRequisitionsTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", validateBody(UpdateJobRequisitionBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobRequisitionsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(jobRequisitionsTable.id, parseInt(req.params.id as string))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "job_requisition", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id/approve", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(jobRequisitionsTable)
      .set({ status: "approved", approvedByEmployeeId: (req as any).user?.employeeId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobRequisitionsTable.id, parseInt(req.params.id as string)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "approve", entityType: "job_requisition", entityId: row.id, changesJson: JSON.stringify({ status: "approved" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id/reject", async (req, res): Promise<void> => {
  try {
    const { rejectionReason } = req.body;
    const [row] = await db.update(jobRequisitionsTable)
      .set({ status: "rejected", rejectionReason, updatedAt: new Date() })
      .where(eq(jobRequisitionsTable.id, parseInt(req.params.id as string)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "reject", entityType: "job_requisition", entityId: row.id, changesJson: JSON.stringify({ rejectionReason }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
