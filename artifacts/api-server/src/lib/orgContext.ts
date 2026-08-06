import type { Request, RequestHandler } from "express";
import { db, organizationsTable, systemUsersTable, rolesTable, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthEnforced } from "./authMode.js";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

let cachedDefaultOrgId: number | null = null;

/** Return the id of the default organization (is_default = true), cached. */
export async function getDefaultOrgId(): Promise<number> {
  if (cachedDefaultOrgId !== null) return cachedDefaultOrgId;
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.isDefault, true)).limit(1);
  if (org) {
    cachedDefaultOrgId = org.id;
    return org.id;
  }
  const [first] = await db.select().from(organizationsTable).limit(1);
  cachedDefaultOrgId = first?.id ?? 1;
  return cachedDefaultOrgId;
}

/** Thrown when a request supplies an org context it may not use. Mapped to an HTTP response by the global error handler. */
export class InvalidOrgContextError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "INVALID_ORG_CONTEXT") {
    super(message);
    this.name = "InvalidOrgContextError";
    this.status = status;
    this.code = code;
  }
}

// Short-TTL cache of known organization ids so every scoped request doesn't
// re-query the organizations table.
let knownOrgIds: Set<number> | null = null;
let knownOrgIdsAt = 0;
const ORG_CACHE_TTL_MS = 30_000;

async function isKnownOrgId(id: number): Promise<boolean> {
  const now = Date.now();
  if (!knownOrgIds || now - knownOrgIdsAt > ORG_CACHE_TTL_MS) {
    const rows = await db.select({ id: organizationsTable.id }).from(organizationsTable);
    knownOrgIds = new Set(rows.map((r) => r.id));
    knownOrgIdsAt = now;
  }
  return knownOrgIds.has(id);
}

/** Test/ops hook: drop the cached org-id set (e.g. after creating orgs). */
export function invalidateOrgCache(): void {
  knownOrgIds = null;
  cachedDefaultOrgId = null;
}

/**
 * Resolve the organization context for a request.
 * The web client sends the active org via the `X-Org-Id` header (set by the
 * org switcher). Falls back to the default organization when absent — this
 * mirrors the demo-mode session fallback used across the API.
 *
 * The header is never trusted blindly:
 *  - it must reference an organization that actually exists (else 400), and
 *  - when authentication is enforced, only an authenticated session may
 *    select an org context at all (else 401). Anonymous callers cannot pick
 *    a tenant.
 */
export async function resolveOrgId(req: Request): Promise<number> {
  const raw = req.get("x-org-id");
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
      throw new InvalidOrgContextError(`Invalid X-Org-Id header: ${raw}`);
    }
    if (isAuthEnforced() && !req.session?.userId) {
      throw new InvalidOrgContextError("Authentication required to select an organization context", 401, "UNAUTHENTICATED");
    }
    if (!(await isKnownOrgId(parsed))) {
      throw new InvalidOrgContextError(`Unknown organization: ${parsed}`, 400, "UNKNOWN_ORG");
    }
    if (isAuthEnforced() && req.session?.userId) {
      await assertOrgAccessAllowed(req.session.userId, parsed);
    }
    return parsed;
  }
  // No header: in enforced-auth mode the context comes from the authenticated
  // user's home organization, never unconditionally from the default tenant.
  if (isAuthEnforced() && req.session?.userId) {
    const home = await getUserHomeOrgId(req.session.userId);
    if (home !== null) return home;
  }
  return getDefaultOrgId();
}

/**
 * Express middleware that 404s a `/:id` route when the target row belongs to
 * a different organization than the active org context. Rows with a NULL
 * orgId are treated as global/legacy and remain accessible from any org.
 *
 * Usage: `router.use("/resource/:id", orgOwnershipGuard(table, table.orgId, table.id))`
 * (registered before the routes it protects).
 */
export function orgOwnershipGuard(
  table: PgTable,
  orgIdColumn: PgColumn,
  idColumn: PgColumn,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const raw = String(req.params.id);
      // Static sibling routes (e.g. /compare, /import) also match `/:id` in a
      // router.use() prefix — let non-numeric segments fall through to them.
      if (!/^\d+$/.test(raw)) { next(); return; }
      const id = parseInt(raw, 10);
      const [row] = await db.select({ orgId: orgIdColumn }).from(table).where(eq(idColumn, id));
      if (!row) { res.status(404).json({ error: "Not found" }); return; }
      const rowOrgId = row.orgId as number | null;
      if (rowOrgId !== null && rowOrgId !== (await resolveOrgId(req))) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    } catch (err) { next(err); }
  };
}

// Per-user org-entitlement cache (home org + cross-org privilege), short TTL.
const userOrgAccessCache = new Map<number, { homeOrgId: number | null; crossOrg: boolean; at: number }>();
const USER_ACCESS_TTL_MS = 30_000;

/**
 * Authorization check for an explicitly requested org context.
 *
 * A user's home organization is derived from their linked employee record
 * (system_users.employee_id -> employees.org_id); users with no employee link
 * are treated as belonging to the default organization. Selecting any other
 * organization requires a cross-org privilege: a system role (e.g. Super
 * Administrator). Anything else is rejected with 403.
 */
async function loadUserOrgAccess(userId: number): Promise<{ homeOrgId: number | null; crossOrg: boolean; at: number } | null> {
  const now = Date.now();
  let entry = userOrgAccessCache.get(userId);
  if (entry && now - entry.at <= USER_ACCESS_TTL_MS) return entry;
  const [row] = await db.select({
    orgId: systemUsersTable.orgId,
    employeeId: systemUsersTable.employeeId,
    systemRole: rolesTable.systemRole,
  })
    .from(systemUsersTable)
    .leftJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(eq(systemUsersTable.id, userId));
  if (!row) return null;
  // Prefer the direct org_id column; fall back to the linked employee's org
  // for legacy rows that pre-date the column.
  let homeOrgId: number | null = row.orgId ?? null;
  if (homeOrgId == null && row.employeeId != null) {
    const [emp] = await db.select({ orgId: employeesTable.orgId }).from(employeesTable)
      .where(eq(employeesTable.id, row.employeeId));
    homeOrgId = emp?.orgId ?? null;
  }
  entry = { homeOrgId, crossOrg: row.systemRole === true, at: now };
  userOrgAccessCache.set(userId, entry);
  return entry;
}

/** Home organization of a user (their linked employee's org), or null when unknown. */
export async function getUserHomeOrgId(userId: number): Promise<number | null> {
  const entry = await loadUserOrgAccess(userId);
  return entry?.homeOrgId ?? null;
}

export async function assertOrgAccessAllowed(userId: number, requestedOrgId: number): Promise<void> {
  const entry = await loadUserOrgAccess(userId);
  if (!entry) {
    throw new InvalidOrgContextError("Unknown user for organization context", 403, "ORG_ACCESS_DENIED");
  }
  if (entry.crossOrg) return;
  const homeOrgId = entry.homeOrgId ?? (await getDefaultOrgId());
  if (requestedOrgId !== homeOrgId) {
    throw new InvalidOrgContextError("Not authorized for this organization", 403, "ORG_ACCESS_DENIED");
  }
}


/**
 * Row-level org visibility for admin governance modules. Global rows
 * (orgId null) are always visible. In demo mode (auth not enforced) all rows
 * are visible. Under enforced auth, a row in another org is visible only to
 * cross-org (system-role) users.
 */
export async function canAccessOrgRow(req: Request, rowOrgId: number | null): Promise<boolean> {
  if (rowOrgId == null) return true;
  if (!isAuthEnforced()) return true;
  const userId = req.session?.userId;
  if (!userId) return false;
  const entry = await loadUserOrgAccess(userId);
  if (!entry) return false;
  if (entry.crossOrg) return true;
  const homeOrgId = entry.homeOrgId ?? (await getDefaultOrgId());
  return rowOrgId === homeOrgId;
}

/**
 * Org id to stamp on a newly created row. An explicit body orgId is honored
 * in demo mode or for cross-org (system-role) users; everyone else is forced
 * to their own resolved org context (403 on mismatch).
 */
export async function resolveWriteOrgId(req: Request, bodyOrgId?: unknown): Promise<number> {
  const requested = typeof bodyOrgId === "number" && Number.isInteger(bodyOrgId) ? bodyOrgId : undefined;
  if (requested === undefined) return resolveOrgId(req);
  if (!isAuthEnforced()) return requested;
  const userId = req.session?.userId;
  if (!userId) {
    throw new InvalidOrgContextError("Authentication required to select an organization context", 401, "UNAUTHENTICATED");
  }
  await assertOrgAccessAllowed(userId, requested);
  return requested;
}

/** Test/ops hook: drop the per-user org-entitlement cache. */
export function invalidateOrgAccessCache(): void {
  userOrgAccessCache.clear();
}

/**
 * App-level middleware: validates any supplied `X-Org-Id` header up front so
 * invalid or unauthorized org contexts are rejected (400/401) before route
 * handlers run — regardless of per-route error handling.
 */
export function orgContextValidator(): RequestHandler {
  return async (req, res, next) => {
    try {
      if (req.get("x-org-id")) await resolveOrgId(req);
      next();
    } catch (err) {
      if (err instanceof InvalidOrgContextError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  };
}
