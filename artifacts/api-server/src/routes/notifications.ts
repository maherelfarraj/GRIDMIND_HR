import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, notificationsTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const offset = (page - 1) * limit;
    const { recipientUserId, notificationType, isRead, requiresAction } = req.query as Record<string, string>;

    const conditions = [];
    if (recipientUserId) conditions.push(eq(notificationsTable.recipientUserId, parseInt(recipientUserId)));
    if (notificationType) conditions.push(eq(notificationsTable.notificationType, notificationType));
    if (isRead !== undefined) conditions.push(eq(notificationsTable.isRead, isRead === "true"));
    if (requiresAction !== undefined) conditions.push(eq(notificationsTable.requiresAction, requiresAction === "true"));

    const [{ count }] = conditions.length > 0
      ? await db.select({ count: sql<number>`count(*)` }).from(notificationsTable).where(and(...conditions))
      : await db.select({ count: sql<number>`count(*)` }).from(notificationsTable);

    const rows = conditions.length > 0
      ? await db.select().from(notificationsTable).where(and(...conditions)).orderBy(desc(notificationsTable.createdAt)).limit(limit).offset(offset)
      : await db.select().from(notificationsTable).orderBy(desc(notificationsTable.createdAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create notification (system/server use)
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(notificationsTable).values(req.body).returning();
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /mark-all-read — MUST be registered BEFORE /:id
router.post("/mark-all-read", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).session?.userId ?? 0;
    const rows = await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(notificationsTable.recipientUserId, userId),
        eq(notificationsTable.isRead, false),
      ))
      .returning();
    res.json({ count: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update (mark read / dismiss)
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const updates: Record<string, unknown> = { ...req.body };

    if (req.body.isRead === true && !req.body.readAt) {
      updates.readAt = new Date();
    }
    if (req.body.isDismissed === true && !req.body.dismissedAt) {
      updates.dismissedAt = new Date();
    }

    const [row] = await db.update(notificationsTable)
      .set(updates as any)
      .where(eq(notificationsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
