import type { Request, Response, NextFunction } from "express";
import { isAuthEnforced } from "../lib/authMode.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnforced()) { next(); return; }
  if (req.session?.userId) { next(); return; }
  res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
}

/**
 * Thrown when an audit-sensitive action has no authenticated actor.
 * Mapped to a 401 response by the global error handler.
 */
export class UnauthenticatedActorError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedActorError";
  }
}

/**
 * Returns the user id of the authenticated session actor.
 *
 * When auth is enforced, a missing session throws (surfaced as 401) so that
 * anonymous requests can never be attributed to a real account in audit logs.
 * In demo mode (auth not enforced) it falls back to the seeded admin (id 1).
 */
export function getActorUserId(req: Request): number {
  const sessionUserId = req.session?.userId;
  if (sessionUserId) return sessionUserId;
  if (!isAuthEnforced()) return 1;
  throw new UnauthenticatedActorError();
}
