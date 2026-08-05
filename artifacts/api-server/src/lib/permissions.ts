import type { Request } from "express";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActorUserId } from "../middleware/requireAuth.js";

export interface ActorInfo {
  userId: number;
  employeeId: number | null;
  permissions: string[];
}

/**
 * Thrown when the authenticated actor lacks a required permission.
 * Endpoints catch it and translate to a 403 response.
 */
export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function parsePermissions(permissionsJson: string | null | undefined): string[] {
  if (!permissionsJson) return [];
  try {
    const parsed = JSON.parse(permissionsJson);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Resolves the acting user (from the session, or the demo fallback when auth
 * is not enforced) together with their role permissions. Fail-closed: an
 * unknown or inactive user resolves to zero permissions.
 */
export async function getActorInfo(req: Request): Promise<ActorInfo> {
  const userId = getActorUserId(req);
  const [row] = await db
    .select({
      employeeId: systemUsersTable.employeeId,
      isActive: systemUsersTable.isActive,
      permissionsJson: rolesTable.permissionsJson,
    })
    .from(systemUsersTable)
    .leftJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(eq(systemUsersTable.id, userId));
  if (!row || !row.isActive) {
    return { userId, employeeId: null, permissions: [] };
  }
  return {
    userId,
    employeeId: row.employeeId ?? null,
    permissions: parsePermissions(row.permissionsJson),
  };
}

/**
 * Resolves the actor and requires the given permission key on their role.
 * Throws ForbiddenError (→ 403) when missing.
 */
export async function requireActorPermission(req: Request, permission: string): Promise<ActorInfo> {
  const actor = await getActorInfo(req);
  if (!actor.permissions.includes(permission)) {
    throw new ForbiddenError();
  }
  return actor;
}
