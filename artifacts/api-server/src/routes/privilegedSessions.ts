import { Router, type Request, type Response, type NextFunction } from "express";
import { db, privilegedSessionsTable, systemUsersTable, rolesTable, auditLogsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { getActorUserId } from "../middleware/requireAuth.js";

const router = Router();

const REVIEW_OUTCOMES = ["justified", "unjustified", "under_investigation"] as const;

// Roles allowed to see and review privileged sessions. Elevated-access
// records expose who touched what under break-glass — audit-sensitive data.
const SESSION_REVIEWER_ROLES = new Set(["Super Administrator", "Security Officer", "Read-Only Auditor"]);
// Read-only auditors can look, but only officers/admins may decide outcomes.
const SESSION_DECIDER_ROLES = new Set(["Super Administrator", "Security Officer"]);

interface AuthedRequest extends Request {
  actor?: typeof systemUsersTable.$inferSelect;
  actorRoleName?: string;
}

// Resolve the acting user from the session (demo fallback userId=1) and
// require a security-officer/auditor role for everything in this router.
async function requireSecurityOfficer(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  // Outside demo mode, never let the userId=1 fallback stand in for a real
  // session — these records disclose who held elevated access and why.
  // (Read at request time so tests can exercise the PILOT_AUTH path.)
  if (process.env.PILOT_AUTH === "true" && !req.session?.userId) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
    return;
  }
  const actorId = getActorUserId(req);
  const [actor] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, actorId));
  const [role] = actor
    ? await db.select().from(rolesTable).where(eq(rolesTable.id, actor.roleId))
    : [];
  if (!actor || !actor.isActive || !role || !SESSION_REVIEWER_ROLES.has(role.nameEn)) {
    res.status(403).json({ error: "Insufficient privileges to access privileged-session records" });
    return;
  }
  req.actor = actor;
  req.actorRoleName = role.nameEn;
  next();
}

async function enrichSession(s: typeof privilegedSessionsTable.$inferSelect) {
  let userName: string | null = null;
  if (s.userId) {
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, s.userId));
    if (user) userName = user.fullNameEn ?? user.username;
  }
  return { ...s, userName };
}

// GET /privileged-sessions — review queue for security officers
router.get("/privileged-sessions", requireSecurityOfficer, async (req, res): Promise<void> => {
  const { userId, reviewed, breakGlassAccessId } = req.query as Record<string, string>;

  const conditions = [];
  if (userId) conditions.push(eq(privilegedSessionsTable.userId, parseInt(userId, 10)));
  if (breakGlassAccessId) conditions.push(eq(privilegedSessionsTable.breakGlassAccessId, parseInt(breakGlassAccessId, 10)));
  if (reviewed === "true") conditions.push(isNotNull(privilegedSessionsTable.reviewedAt));
  if (reviewed === "false") conditions.push(isNull(privilegedSessionsTable.reviewedAt));

  const rows = conditions.length
    ? await db.select().from(privilegedSessionsTable).where(and(...conditions)).orderBy(desc(privilegedSessionsTable.startedAt))
    : await db.select().from(privilegedSessionsTable).orderBy(desc(privilegedSessionsTable.startedAt));

  const enriched = await Promise.all(rows.map(enrichSession));
  res.json(enriched);
});

// POST /privileged-sessions/:id/review — mark a session reviewed.
// Reviewer identity comes from the authenticated session, never the body.
router.post("/privileged-sessions/:id/review", requireSecurityOfficer, async (req: AuthedRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { outcome, notes } = req.body;

  if (!SESSION_DECIDER_ROLES.has(req.actorRoleName ?? "")) {
    res.status(403).json({ error: "Only security officers or administrators may decide review outcomes" });
    return;
  }
  if (!outcome || !REVIEW_OUTCOMES.includes(outcome)) {
    res.status(400).json({ error: `outcome is required and must be one of: ${REVIEW_OUTCOMES.join(", ")}` });
    return;
  }

  const reviewerId = req.actor!.id;

  // Atomic exactly-once review: the update only matches an unreviewed row,
  // so concurrent reviews cannot both succeed. Audit written in the same tx.
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(privilegedSessionsTable)
      .set({
        reviewedAt: new Date(),
        reviewedByUserId: reviewerId,
        reviewOutcome: outcome,
        reviewNotes: notes ?? null,
      })
      .where(and(
        eq(privilegedSessionsTable.id, id),
        isNull(privilegedSessionsTable.reviewedAt),
      ))
      .returning();
    if (!updated) return null;
    await tx.insert(auditLogsTable).values({
      actorUserId: reviewerId,
      action: "privileged_session.reviewed",
      entityType: "privileged_session",
      entityId: id,
      entityLabel: outcome,
      changesJson: JSON.stringify({ reviewedByUserId: reviewerId, outcome, notes }),
    });
    return updated;
  });

  if (!row) {
    const [existing] = await db.select().from(privilegedSessionsTable).where(eq(privilegedSessionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Privileged session not found" });
    } else {
      res.status(409).json({ error: "Session has already been reviewed" });
    }
    return;
  }

  res.json(await enrichSession(row));
});

export default router;
