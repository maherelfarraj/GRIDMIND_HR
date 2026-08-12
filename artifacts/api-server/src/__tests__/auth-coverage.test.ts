/**
 * Auth-coverage guard — two layers of defence ensuring admin routes and other
 * privileged paths are always protected by `requireAuth`.
 *
 * LAYER 1 — STATIC (no DB, no server)
 *   Parse `routes/index.ts` and assert that every router.use(requireAuth) call
 *   appears BEFORE any admin router is mounted.  A PR that accidentally moves
 *   the global requireAuth call below an admin router, or removes it entirely,
 *   fails this check immediately without needing a running server.
 *
 * LAYER 2 — RUNTIME (live supertest, no DB needed)
 *   Send unauthenticated requests to every /admin/* route with PILOT_AUTH=true
 *   and assert each returns 401.  requireAuth only reads req.session.userId, so
 *   no DB connection is required for these 401 checks.
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

/**
 * Complete list of admin endpoints.  When a new /admin/* route file is added,
 * add its paths here so the coverage gap is caught by the test rather than by
 * a production incident.
 */
const ADMIN_ROUTES: Array<{ method: "get" | "post" | "patch"; path: string }> = [
  // adminBackup
  { method: "get",   path: "/admin/backup-schedule" },
  { method: "get",   path: "/admin/backup" },
  { method: "get",   path: "/admin/backup-records" },
  { method: "post",  path: "/admin/backup-records/run" },
  { method: "post",  path: "/admin/backup-records/retry-offsite" },
  { method: "post",  path: "/admin/backup-records/999/retry-offsite" },
  { method: "patch", path: "/admin/backup-records/999/verify" },
  // adminBranches
  { method: "get",   path: "/admin/branch-servers" },
  { method: "post",  path: "/admin/branch-servers" },
  { method: "get",   path: "/admin/branch-servers/999" },
  { method: "patch", path: "/admin/branch-servers/999" },
  { method: "get",   path: "/admin/sync-queue" },
  { method: "post",  path: "/admin/sync-queue/999/resolve" },
  { method: "get",   path: "/admin/sync-status" },
  { method: "get",   path: "/admin/dr-status" },
  // adminLicense
  { method: "get",   path: "/admin/license" },
  { method: "post",  path: "/admin/license" },
];

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
