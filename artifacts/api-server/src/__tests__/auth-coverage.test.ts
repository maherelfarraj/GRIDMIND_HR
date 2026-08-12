/**
 * Auth-coverage guard — three layers of defence ensuring admin routes and other
 * privileged paths are always protected by `requireAuth`.
 *
 * LAYER 1 — STATIC (no DB, no server)
 *   Parse `routes/index.ts` and assert that every router.use(requireAuth) call
 *   appears BEFORE any admin or privileged router is mounted.  A PR that
 *   accidentally moves the global requireAuth call below a router, or removes
 *   it entirely, fails this check immediately without needing a running server.
 *
 * LAYER 2 — RUNTIME /admin/* (live supertest, no DB needed)
 *   Send unauthenticated requests to every /admin/* route with PILOT_AUTH=true
 *   and assert each returns 401.  Routes are discovered dynamically by scanning
 *   the admin route source files, so new endpoints are covered automatically.
 *
 * LAYER 3 — RUNTIME privileged non-/admin/* (live supertest, no DB needed)
 *   Send unauthenticated requests to the break-glass, dual-auth, and
 *   privileged-sessions endpoints (which sit outside the /admin prefix) and
 *   assert each returns 401.  These routers are mounted after the global
 *   requireAuth gate in routes/index.ts, proving that gate covers them.
 *
 * This test is included in scripts/regression.sh (suite: api-auth-coverage)
 * so it blocks PRs automatically via branch protection.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import request from "supertest";
import type { Express } from "express";

// ============================================================================
// LAYER 1: Static analysis of routes/index.ts
// ============================================================================

describe("Static: requireAuth must precede all admin router mounts in routes/index.ts", () => {
  const indexPath = resolve(__dirname, "../routes/index.ts");
  const source = readFileSync(indexPath, "utf-8");
  const lines = source.split("\n");

  /** Line index (0-based) of router.use(requireAuth) */
  const requireAuthLineIdx = lines.findIndex((l) =>
    /router\.use\(\s*requireAuth\s*\)/.test(l),
  );

  it("routes/index.ts contains router.use(requireAuth)", () => {
    expect(
      requireAuthLineIdx,
      "Expected to find router.use(requireAuth) in routes/index.ts — removing or renaming it breaks the global auth gate",
    ).toBeGreaterThan(-1);
  });

  it("adminBackupRouter is mounted AFTER router.use(requireAuth)", () => {
    const mountIdx = lines.findIndex(
      (l) => /router\.use\(/.test(l) && /adminBackupRouter/.test(l),
    );
    expect(mountIdx, "adminBackupRouter mount not found in index.ts").toBeGreaterThan(-1);
    expect(
      mountIdx,
      `adminBackupRouter (line ${mountIdx + 1}) must come after router.use(requireAuth) (line ${requireAuthLineIdx + 1})`,
    ).toBeGreaterThan(requireAuthLineIdx);
  });

  it("adminBranchesRouter is mounted AFTER router.use(requireAuth)", () => {
    const mountIdx = lines.findIndex(
      (l) => /router\.use\(/.test(l) && /adminBranchesRouter/.test(l),
    );
    expect(mountIdx, "adminBranchesRouter mount not found in index.ts").toBeGreaterThan(-1);
    expect(
      mountIdx,
      `adminBranchesRouter (line ${mountIdx + 1}) must come after router.use(requireAuth) (line ${requireAuthLineIdx + 1})`,
    ).toBeGreaterThan(requireAuthLineIdx);
  });

  it("adminLicenseRouter is mounted AFTER router.use(requireAuth)", () => {
    const mountIdx = lines.findIndex(
      (l) => /router\.use\(/.test(l) && /adminLicenseRouter/.test(l),
    );
    expect(mountIdx, "adminLicenseRouter mount not found in index.ts").toBeGreaterThan(-1);
    expect(
      mountIdx,
      `adminLicenseRouter (line ${mountIdx + 1}) must come after router.use(requireAuth) (line ${requireAuthLineIdx + 1})`,
    ).toBeGreaterThan(requireAuthLineIdx);
  });

  it("no unexpected router.use() calls appear before router.use(requireAuth)", () => {
    // The only router.use() calls allowed before requireAuth are the three that
    // have always been intentionally unauthenticated: authRouter (login endpoint),
    // healthRouter (liveness probe), and gatewayMachineRouter (HMAC-authenticated
    // machine-to-machine calls).  Any other use() before requireAuth is a bug.
    const allowed = /authRouter|healthRouter|gatewayMachineRouter/;
    const surprises = lines
      .slice(0, requireAuthLineIdx)
      .filter((l) => /^\s*router\.use\(/.test(l) && !allowed.test(l));

    expect(
      surprises,
      `Unexpected router.use() calls before requireAuth:\n${surprises.join("\n")}`,
    ).toHaveLength(0);
  });
});

// ============================================================================
// LAYER 2: Runtime — unauthenticated requests to /admin/* must return 401
// ============================================================================

// ---------------------------------------------------------------------------
// Dynamic route discovery
//
// Instead of a hand-maintained list that silently misses new endpoints, we
// scan each admin route source file at test-load time.  Any router.<method>()
// call whose path starts with "/admin/" is extracted automatically, so a
// developer who adds a new endpoint without auth middleware sees a failing
// test, not a silent pass.
//
// Path parameters (e.g. :id, :serverId) are replaced with the probe stub
// "999" — sufficient to reach the auth check, which fires before any DB
// look-up.
// ---------------------------------------------------------------------------

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

/**
 * Scan a route source file and return every admin endpoint it declares.
 * Matches lines of the form:
 *   router.get("/admin/...",
 *   router.post('/admin/...',
 * (with optional whitespace around the opening paren / quote).
 */
function discoverAdminRoutes(
  filePath: string,
): Array<{ method: HttpMethod; path: string }> {
  const source = readFileSync(filePath, "utf-8");
  const METHOD_RE =
    /router\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g;
  const routes: Array<{ method: HttpMethod; path: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = METHOD_RE.exec(source)) !== null) {
    const method = match[1] as HttpMethod;
    // Replace Express parameter tokens (:id, :serverId, …) with the stub "999"
    const path = match[2].replace(/:[^/]+/g, "999");

    if (path.startsWith("/admin/")) {
      routes.push({ method, path });
    }
  }

  return routes;
}

/**
 * Admin route source files to scan.  Add new admin route files here so the
 * test automatically discovers every endpoint they declare.
 */
const ADMIN_ROUTE_FILES = [
  resolve(__dirname, "../routes/adminBackup.ts"),
  resolve(__dirname, "../routes/adminBranches.ts"),
  resolve(__dirname, "../routes/adminLicense.ts"),
];

/**
 * Dynamically discovered admin routes — replaces the old hardcoded list.
 * Duplicate (method + path) pairs are deduplicated so parameterised routes
 * that share the same stub path (e.g. two :id routes on the same verb) are
 * only probed once.
 */
const seen = new Set<string>();
const ADMIN_ROUTES: Array<{ method: HttpMethod; path: string }> = [];
for (const file of ADMIN_ROUTE_FILES) {
  for (const route of discoverAdminRoutes(file)) {
    const key = `${route.method}:${route.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      ADMIN_ROUTES.push(route);
    }
  }
}

if (ADMIN_ROUTES.length === 0) {
  throw new Error(
    "auth-coverage: discoverAdminRoutes returned 0 routes — " +
      "the regex may be broken or the route files have been moved. " +
      "Fix the discovery logic before running auth coverage checks.",
  );
}

describe("Runtime: every /admin/* route returns 401 when unauthenticated (PILOT_AUTH=true)", () => {
  let app: Express;

  beforeAll(async () => {
    // Force auth enforcement — this is the production default and the guard we
    // are proving is present.  requireAuth only checks req.session.userId, so
    // no DB connection is needed for the 401 path.
    vi.stubEnv("PILOT_AUTH", "true");
    vi.resetModules();
    app = (await import("../app")).default;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  for (const { method, path } of ADMIN_ROUTES) {
    it(`${method.toUpperCase()} /api${path} → 401 with no session`, async () => {
      const res = await (request(app) as any)[method](`/api${path}`).send({});
      expect(res.status).toBe(401);
    });
  }
});

// ============================================================================
// LAYER 3: Runtime — unauthenticated requests to privileged non-/admin/* paths
// ============================================================================

/**
 * High-sensitivity endpoints that sit outside the /admin prefix but still
 * require authentication.  These are covered separately because the /admin
 * sweep only discovers paths that begin with /admin.
 *
 * All three routers (breakGlass, dualAuth, privilegedSessions) are mounted in
 * routes/index.ts AFTER router.use(requireAuth), so the global auth gate
 * applies to every endpoint they declare.  These assertions prove that a
 * regression moving or removing that gate would be caught before production.
 *
 * The list is intentionally exhaustive: every route declared in the three
 * source files is probed so that a new endpoint added without thought is
 * caught here rather than in a production incident.
 */
const PRIVILEGED_NON_ADMIN_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  // breakGlass.ts
  { method: "get",  path: "/break-glass" },
  { method: "post", path: "/break-glass" },
  { method: "post", path: "/break-glass/999/revoke" },
  // dualAuth.ts
  { method: "get",  path: "/dual-auth" },
  { method: "post", path: "/dual-auth" },
  { method: "post", path: "/dual-auth/999/approve" },
  { method: "post", path: "/dual-auth/999/reject" },
  // privilegedSessions.ts
  { method: "get",  path: "/privileged-sessions" },
  { method: "get",  path: "/privileged-sessions/999/activity" },
  { method: "post", path: "/privileged-sessions/999/review" },
];

describe("Runtime: every privileged non-/admin/* route returns 401 when unauthenticated (PILOT_AUTH=true)", () => {
  let app: Express;

  beforeAll(async () => {
    vi.stubEnv("PILOT_AUTH", "true");
    vi.resetModules();
    app = (await import("../app")).default;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  for (const { method, path } of PRIVILEGED_NON_ADMIN_ROUTES) {
    it(`${method.toUpperCase()} /api${path} → 401 with no session`, async () => {
      const res = await (request(app) as any)[method](`/api${path}`).send({});
      expect(res.status).toBe(401);
    });
  }
});
