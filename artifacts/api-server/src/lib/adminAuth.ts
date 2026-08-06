/**
 * Shared helper for "Super Administrator" authorization checks.
 *
 * Import `getActorAdminStatus` into any route that should be admin-only and
 * guard the handler body with:
 *
 *   const { isAdmin } = await getActorAdminStatus(req);
 *   if (!isAdmin) { res.status(403).json({ error: "..." }); return; }
 *
 * The function re-uses `getActorUserId` from the auth middleware, so it
 * inherits the same 401-on-unauthenticated behaviour when PILOT_AUTH is on.
 */
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import { getActorUserId } from "../middleware/requireAuth.js";

/** Roles that are allowed to perform admin-only mutations. */
const ADMIN_ROLES = new Set(["Super Administrator"]);

/**
 * Resolve the acting user and whether they hold an admin role.
 *
 * - When PILOT_AUTH is enforced: unauthenticated requests throw before we
 *   even reach the DB look-up (via `getActorUserId`), so the 401 is handled
 *   upstream.
 * - In demo mode (auth disabled): falls back to user id 1 (seeded admin).
 */
export async function getActorAdminStatus(req: Request): Promise<{
  actorId: number;
  isAdmin: boolean;
}> {
  const actorId = getActorUserId(req);
  const [actor] = await db
    .select()
    .from(systemUsersTable)
    .where(eq(systemUsersTable.id, actorId));
  const [role] = actor
    ? await db.select().from(rolesTable).where(eq(rolesTable.id, actor.roleId))
    : [];
  const isAdmin =
    !!actor && actor.isActive && !!role && ADMIN_ROLES.has(role.nameEn);
  return { actorId, isAdmin };
}
