import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, notificationPreferencesTable } from "@workspace/db";

const router = Router();

/**
 * Notification preferences are strictly self-scoped: the target user is
 * always the authenticated session user (demo fallback userId=1, matching
 * the rest of the API when PILOT_AUTH is off). Requests that name a
 * different userId are rejected — this prevents any authenticated user
 * from reading or silently rewriting another user's alert delivery
 * settings (e.g. disabling an admin's lockout alerts).
 */
function actorId(req: any): number {
  return req.session?.userId ?? 1;
}

const SECURITY_ALERT_CHANNELS = new Set(["in_app", "email", "both"]);

// Only these fields may be written via the API; everything else
// (id, userId, timestamps) is server-controlled.
const WRITABLE_FIELDS = [
  "subscriptionsJson",
  "quietHoursEnabled",
  "quietHoursStart",
  "quietHoursEnd",
  "preferredLanguage",
  "dashboardFrequency",
  "securityAlertChannel",
] as const;

function pickWritable(body: any): { data: Record<string, unknown>; error?: string } {
  const data: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (body && Object.prototype.hasOwnProperty.call(body, f)) data[f] = body[f];
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "securityAlertChannel") &&
    !SECURITY_ALERT_CHANNELS.has(String(data.securityAlertChannel))
  ) {
    return { data, error: 'securityAlertChannel must be one of "in_app", "email", "both"' };
  }
  return { data };
}

// GET / — get the authenticated user's preferences.
// An optional ?userId= is accepted for backwards compatibility but must
// match the session user.
router.get("/", async (req, res): Promise<void> => {
  try {
    const selfId = actorId(req);
    if (req.query.userId !== undefined && parseInt(req.query.userId as string) !== selfId) {
      res.status(403).json({ error: "Cannot read another user's notification preferences" });
      return;
    }
    const [row] = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, selfId));
    if (!row) { res.json(null); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /:userId — upsert preferences. The :userId must be the session user.
router.put("/:userId", async (req, res): Promise<void> => {
  try {
    const selfId = actorId(req);
    const userId = parseInt(req.params.userId);
    if (userId !== selfId) {
      res.status(403).json({ error: "Cannot modify another user's notification preferences" });
      return;
    }

    const { data, error } = pickWritable(req.body);
    if (error) { res.status(400).json({ error }); return; }

    const [existing] = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId));

    if (existing) {
      const [row] = await db.update(notificationPreferencesTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationPreferencesTable.userId, userId))
        .returning();
      res.json(row);
    } else {
      const [row] = await db.insert(notificationPreferencesTable)
        .values({ ...data, userId })
        .returning();
      res.status(201).json(row);
    }
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
