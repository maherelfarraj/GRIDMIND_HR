import type { Request, Response, NextFunction } from "express";
import { isAuthEnforced } from "../lib/authMode.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnforced()) { next(); return; }
  if (req.session?.userId) { next(); return; }
  res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
}

export function getActorUserId(req: Request): number {
  return req.session?.userId ?? 1;
}
