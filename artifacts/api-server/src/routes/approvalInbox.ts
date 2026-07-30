import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, approvalInboxItemsTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { assignedToUserId, approvalType, status, priority } = req.query as Record<string, string>;

    const conditions = [];
    if (assignedToUserId) conditions.push(eq(approvalInboxItemsTable.assignedToUserId, parseInt(assignedToUserId)));
    if (approvalType) conditions.push(eq(approvalInboxItemsTable.approvalType, approvalType));
    if (status) conditions.push(eq(approvalInboxItemsTable.status, status));
    if (priority) conditions.push(eq(approvalInboxItemsTable.priority, priority));

    const [{ count }] = conditions.length > 0
      ? await db.select({ count: sql<number>`count(*)` }).from(approvalInboxItemsTable).where(and(...conditions))
      : await db.select({ count: sql<number>`count(*)` }).from(approvalInboxItemsTable);

    const rows = conditions.length > 0
      ? await db.select().from(approvalInboxItemsTable).where(and(...conditions)).orderBy(desc(approvalInboxItemsTable.requestedAt)).limit(limit).offset(offset)
      : await db.select().from(approvalInboxItemsTable).orderBy(desc(approvalInboxItemsTable.requestedAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create inbox item
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(approvalInboxItemsTable).values({
      ...req.body,
      requestedAt: req.body.requestedAt ? new Date(req.body.requestedAt) : new Date(),
    }).returning();
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(approvalInboxItemsTable)
      .where(eq(approvalInboxItemsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update (decide / delegate / escalate)
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const updates: Record<string, unknown> = { ...req.body, updatedAt: new Date() };

    // Decide: set status + decidedAt + decisionNotes
    if (req.body.status && ["approved", "rejected"].includes(req.body.status)) {
      updates.decidedAt = new Date();
      if (req.body.decisionNotes) updates.decisionNotes = req.body.decisionNotes;
    }

    // Delegate
    if (req.body.isDelegated === true) {
      updates.isDelegated = true;
      if (req.body.delegatedToUserId) updates.delegatedToUserId = req.body.delegatedToUserId;
    }

    // Escalate
    if (req.body.isEscalated === true) {
      updates.isEscalated = true;
      updates.escalatedAt = new Date();
    }

    const [row] = await db.update(approvalInboxItemsTable)
      .set(updates as any)
      .where(eq(approvalInboxItemsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "approval_inbox_item", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
