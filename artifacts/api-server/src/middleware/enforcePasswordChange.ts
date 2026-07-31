import type { Request, Response, NextFunction } from "express";
import { db, systemUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthEnforced } from "../lib/authMode.js";

/**
 * Blocks all business endpoints for sessions whose user still has
 * must_change_password=true (PILOT_AUTH mode only). The auth router is
 * mounted before this middleware, so /auth/me, /auth/change-password and
 * /auth/logout remain reachable — everything else gets a distinct
 * 403 PASSWORD_CHANGE_REQUIRED until the password is changed.
 */
export async function enforcePasswordChange(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isAuthEnforced() || !req.session?.userId) { next(); return; }

  const [user] = await db.select({ mustChangePassword: systemUsersTable.mustChangePassword })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.id, req.session.userId));

  if (user?.mustChangePassword) {
    res.status(403).json({
      error: "Password change required before accessing this resource",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    return;
  }
  next();
}
