import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";

const router = Router();

/**
 * Notifications are self-scoped: reads and updates are limited to the
 * authenticated session user (demo fallback userId=1, matching the rest of
 * the API when PILOT_AUTH is off), like notification-preferences. Admins may
 * explicitly query another user's list, but non-admins are rejected when
 * they name a different recipient, and single-item reads/updates always
 * require the notification to be addressed to the caller.
 */
function actorId(req: any): number {
  return req.session?.userId ?? 1;
}

function isAdmin(req: any): boolean {
  return /admin/i.test(String(req.session?.userRole ?? ""));
}

// Only these fields may be written via PATCH; everything else
// (id, recipient, type, content, timestamps) is server-controlled.
const WRITABLE_FIELDS = ["isRead", "isDismissed"] as const;

// GET / — list the authenticated user's notifications.
// ?recipientUserId= is accepted but must match the session user unless the
// caller is an admin.
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const offset = (page - 1) * limit;
    const { recipientUserId, notificationType, isRead, requiresAction } = req.query as Record<string, string>;

    const selfId = actorId(req);
    let targetUserId = selfId;
    if (recipientUserId !== undefined) {
      const requested = parseInt(recipientUserId);
      if (Number.isNaN(requested)) {
        res.status(400).json({ error: "Invalid recipientUserId" });
        return;
      }
      if (requested !== selfId && !isAdmin(req)) {
        res.status(403).json({ error: "Cannot read another user's notifications" });
        return;
      }
      targetUserId = requested;
    }

    const conditions = [eq(notificationsTable.recipientUserId, targetUserId)];
    if (notificationType) conditions.push(eq(notificationsTable.notificationType, notificationType));
    if (isRead !== undefined) conditions.push(eq(notificationsTable.isRead, isRead === "true"));
    if (requiresAction !== undefined) conditions.push(eq(notificationsTable.requiresAction, requiresAction === "true"));

    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(notificationsTable).where(and(...conditions));

    const rows = await db.select().from(notificationsTable)
      .where(and(...conditions))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit).offset(offset);

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
    const userId = actorId(req);
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

// GET /:id — get one of the caller's own notifications
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (row.recipientUserId !== actorId(req)) {
      res.status(403).json({ error: "Cannot read another user's notification" });
      return;
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update (mark read / dismiss) one of the caller's own notifications
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);

    const [existing] = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.recipientUserId !== actorId(req)) {
      res.status(403).json({ error: "Cannot modify another user's notification" });
      return;
    }

    const updates: Record<string, unknown> = {};
    for (const f of WRITABLE_FIELDS) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, f)) updates[f] = req.body[f];
    }
    if (updates.isRead === true) updates.readAt = new Date();
    if (updates.isDismissed === true) updates.dismissedAt = new Date();
    if (Object.keys(updates).length === 0) { res.json(existing); return; }

    const [row] = await db.update(notificationsTable)
      .set(updates as any)
      .where(eq(notificationsTable.id, id))
      .returning();
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
