import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
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
  return getActorUserId(req);
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

// Valid enum values for notification fields.
const VALID_NOTIFICATION_TYPES = new Set([
  "leave_request", "leave_decision", "attendance_correction", "payroll_published",
  "document_expiry", "cert_expiry", "probation_review", "appraisal_due",
  "goal_approved", "approval_required", "announcement", "system", "security_alert",
]);
const VALID_SEVERITIES = new Set(["info", "success", "warning", "error", "urgent"]);

// Maximum character lengths mirrored from the DB schema.
const FIELD_LIMITS: Record<string, number> = {
  notificationType: 40,
  titleEn: 300,
  titleAr: 300,
  bodyEn: 10_000,
  bodyAr: 10_000,
  severity: 20,
  actionUrl: 500,
};

/**
 * Validate and extract a safe subset of fields for notification creation.
 * Returns { data } on success or { errors } on failure.
 */
function validateNotificationPayload(
  body: Record<string, unknown>,
): { data: Record<string, unknown> } | { errors: string[] } {
  const errors: string[] = [];

  // ── Required fields ──────────────────────────────────────────────────────
  const recipientUserId = body.recipientUserId;
  if (recipientUserId === undefined || recipientUserId === null) {
    errors.push("recipientUserId is required");
  } else if (!Number.isInteger(recipientUserId) || (recipientUserId as number) < 1) {
    errors.push("recipientUserId must be a positive integer");
  }

  const notificationType = body.notificationType;
  if (!notificationType) {
    errors.push("notificationType is required");
  } else if (typeof notificationType !== "string") {
    errors.push("notificationType must be a string");
  } else if (!VALID_NOTIFICATION_TYPES.has(notificationType)) {
    errors.push(`notificationType must be one of: ${[...VALID_NOTIFICATION_TYPES].join(", ")}`);
  }

  const titleEn = body.titleEn;
  if (titleEn === undefined || titleEn === null || titleEn === "") {
    errors.push("titleEn is required");
  } else if (typeof titleEn !== "string") {
    errors.push("titleEn must be a string");
  } else if (titleEn.length > FIELD_LIMITS.titleEn) {
    errors.push(`titleEn must not exceed ${FIELD_LIMITS.titleEn} characters`);
  }

  const bodyEn = body.bodyEn;
  if (bodyEn === undefined || bodyEn === null || bodyEn === "") {
    errors.push("bodyEn is required");
  } else if (typeof bodyEn !== "string") {
    errors.push("bodyEn must be a string");
  } else if (bodyEn.length > FIELD_LIMITS.bodyEn) {
    errors.push(`bodyEn must not exceed ${FIELD_LIMITS.bodyEn} characters`);
  }

  // ── Optional string fields with length limits ─────────────────────────────
  const titleAr = body.titleAr;
  if (titleAr !== undefined && titleAr !== null) {
    if (typeof titleAr !== "string") {
      errors.push("titleAr must be a string");
    } else if (titleAr.length > FIELD_LIMITS.titleAr) {
      errors.push(`titleAr must not exceed ${FIELD_LIMITS.titleAr} characters`);
    }
  }

  const bodyAr = body.bodyAr;
  if (bodyAr !== undefined && bodyAr !== null) {
    if (typeof bodyAr !== "string") {
      errors.push("bodyAr must be a string");
    } else if (bodyAr.length > FIELD_LIMITS.bodyAr) {
      errors.push(`bodyAr must not exceed ${FIELD_LIMITS.bodyAr} characters`);
    }
  }

  const severity = body.severity;
  if (severity !== undefined && severity !== null) {
    if (typeof severity !== "string") {
      errors.push("severity must be a string");
    } else if (!VALID_SEVERITIES.has(severity)) {
      errors.push(`severity must be one of: ${[...VALID_SEVERITIES].join(", ")}`);
    }
  }

  const actionUrl = body.actionUrl;
  if (actionUrl !== undefined && actionUrl !== null) {
    if (typeof actionUrl !== "string") {
      errors.push("actionUrl must be a string");
    } else if (actionUrl.length > FIELD_LIMITS.actionUrl) {
      errors.push(`actionUrl must not exceed ${FIELD_LIMITS.actionUrl} characters`);
    }
  }

  const requiresAction = body.requiresAction;
  if (requiresAction !== undefined && requiresAction !== null) {
    if (typeof requiresAction !== "boolean") {
      errors.push("requiresAction must be a boolean");
    }
  }

  if (errors.length > 0) return { errors };

  // ── Build the safe insert payload (whitelist only) ────────────────────────
  const data: Record<string, unknown> = {
    recipientUserId: recipientUserId as number,
    notificationType: notificationType as string,
    titleEn: titleEn as string,
    bodyEn: bodyEn as string,
  };
  if (titleAr !== undefined && titleAr !== null) data.titleAr = titleAr;
  if (bodyAr !== undefined && bodyAr !== null) data.bodyAr = bodyAr;
  if (severity !== undefined && severity !== null) data.severity = severity;
  if (actionUrl !== undefined && actionUrl !== null) data.actionUrl = actionUrl;
  if (requiresAction !== undefined && requiresAction !== null) data.requiresAction = requiresAction;

  return { data };
}

// POST / — create notification. Creation is a privileged operation: system
// code paths insert directly via the DB layer, so the HTTP surface is
// admin-only. Without this guard any authenticated caller could spoof
// notifications (e.g. fake "security alerts" with malicious action URLs)
// addressed to arbitrary users.
router.post("/", async (req, res): Promise<void> => {
  try {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Only administrators can create notifications" });
      return;
    }

    const result = validateNotificationPayload(req.body ?? {});
    if ("errors" in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    const [row] = await db.insert(notificationsTable).values(result.data as any).returning();
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
