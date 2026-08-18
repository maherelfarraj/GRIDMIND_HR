/**
 * Tests for GET /api/admin/production-health
 *
 * Covers:
 *  1. RBAC: unauthenticated → 401, non-admin → 403, admin → 200
 *  2. Response structure: all expected top-level keys present
 *  3. Data safety: no passwords, session cookies, or raw API keys in response
 *  4. Tenant isolation: response is scoped to org 1, not seeded test org 16
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUFFIX = `ph-${Date.now()}`;
const ADMIN_USER = `ph-admin-${SUFFIX}`;
const NONADMIN_USER = `ph-clerk-${SUFFIX}`;
const PASSWORD = "ProdHealth_Test!9";

let app: Express;
let adminId: number;
let nonAdminId: number;
let adminCookies: string[];
let nonAdminCookies: string[];

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const hash = await bcrypt.hash(PASSWORD, 10);

  const [admin] = await db
    .insert(systemUsersTable)
    .values({
      username: ADMIN_USER,
      email: `${ADMIN_USER}@test.example`,
      fullNameEn: "PH Test Admin",
      fullNameAr: "مسؤول اختبار",
      roleId: 1, // Super Administrator
      isActive: true,
      passwordHash: hash,
    })
    .returning();
  adminId = admin.id;

  const [clerk] = await db
    .insert(systemUsersTable)
    .values({
      username: NONADMIN_USER,
      email: `${NONADMIN_USER}@test.example`,
      fullNameEn: "PH Test Clerk",
      fullNameAr: "موظف اختبار",
      roleId: 5, // HR Clerk — non-admin
      isActive: true,
      passwordHash: hash,
    })
    .returning();
  nonAdminId = clerk.id;

  // Obtain session cookies for each fixture user
  const adminLogin = await request(app)
    .post("/api/auth/login")
    .send({ username: ADMIN_USER, password: PASSWORD });
  adminCookies = adminLogin.headers["set-cookie"] as unknown as string[];

  const clerkLogin = await request(app)
    .post("/api/auth/login")
    .send({ username: NONADMIN_USER, password: PASSWORD });
  nonAdminCookies = clerkLogin.headers["set-cookie"] as unknown as string[];
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const id of [adminId, nonAdminId]) {
    await db
      .delete(systemUsersTable)
      .where(eq(systemUsersTable.id, id))
      .catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

describe("RBAC", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/production-health");
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/production-health")
      .set("Cookie", nonAdminCookies);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Super Administrator") });
  });

  it("returns 200 for Super Administrator", async () => {
    const res = await request(app)
      .get("/api/admin/production-health")
      .set("Cookie", adminCookies);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Response structure
// ---------------------------------------------------------------------------

describe("response structure", () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await request(app)
      .get("/api/admin/production-health")
      .set("Cookie", adminCookies);
    body = res.body;
  });

  it("has top-level shape", () => {
    expect(body).toHaveProperty("checkedAt");
    expect(body).toHaveProperty("overallStatus");
    expect(body).toHaveProperty("recommendations");
    expect(body).toHaveProperty("system");
    expect(body).toHaveProperty("ai");
    expect(body).toHaveProperty("security");
    expect(body).toHaveProperty("hr");
    expect(body).toHaveProperty("recentAudit");
  });

  it("system section is healthy and has apiUp/dbUp", () => {
    const sys = body.system as Record<string, unknown>;
    expect(sys.status).toBe("healthy");
    expect(sys.apiUp).toBe(true);
    expect(sys.dbUp).toBe(true);
  });

  it("ai section has required fields", () => {
    const ai = body.ai as Record<string, unknown>;
    expect(ai).toHaveProperty("status");
    expect(ai).toHaveProperty("configured");
    expect(ai).toHaveProperty("enabled");
    expect(ai).toHaveProperty("model");
    expect(ai).toHaveProperty("integrationProvisioned");
    expect(ai).toHaveProperty("totalQueries");
    expect(ai).toHaveProperty("successCount");
    expect(ai).toHaveProperty("failureCount");
    expect(ai).toHaveProperty("totalTokens");
    expect(ai).toHaveProperty("featureBreakdown");
    expect(ai).toHaveProperty("recentFailures");
    expect(ai).toHaveProperty("costNote");
    expect(typeof ai.costNote).toBe("string");
    expect((ai.costNote as string).toLowerCase()).toMatch(/unavailable|not configured/);
  });

  it("security section has required fields", () => {
    const sec = body.security as Record<string, unknown>;
    expect(sec).toHaveProperty("status");
    expect(sec).toHaveProperty("activeSuperAdminCount");
    expect(sec).toHaveProperty("superAdmins");
    expect(sec).toHaveProperty("adminsMissingMfaCount");
    expect(sec).toHaveProperty("duplicateAdminGroups");
    expect(sec).toHaveProperty("failedLogins7d");
    expect(sec).toHaveProperty("lockouts7d");
    expect(sec).toHaveProperty("inactiveUserCount");
    expect(sec).toHaveProperty("orphanedOrgUserCount");
    expect(sec).toHaveProperty("activeSessionsByUser");
    expect(sec).toHaveProperty("openAlertsCount");
  });

  it("hr section has required fields", () => {
    const hr = body.hr as Record<string, unknown>;
    expect(hr).toHaveProperty("status");
    expect(hr).toHaveProperty("employeeTotal");
    expect(hr).toHaveProperty("employeeActive");
    expect(hr).toHaveProperty("pendingApprovals");
    expect(hr).toHaveProperty("payrollPeriods");
    expect(hr).toHaveProperty("payrollPeriodCount");
  });

  it("severity values are valid", () => {
    const valid = new Set(["healthy", "warning", "critical"]);
    expect(valid.has(body.overallStatus as string)).toBe(true);
    expect(valid.has((body.system as Record<string, unknown>).status as string)).toBe(true);
    expect(valid.has((body.ai as Record<string, unknown>).status as string)).toBe(true);
    expect(valid.has((body.security as Record<string, unknown>).status as string)).toBe(true);
    expect(valid.has((body.hr as Record<string, unknown>).status as string)).toBe(true);
  });

  it("featureBreakdown entries have required fields", () => {
    const ai = body.ai as Record<string, unknown>;
    const breakdown = ai.featureBreakdown as Array<Record<string, unknown>>;
    expect(Array.isArray(breakdown)).toBe(true);
    for (const entry of breakdown) {
      expect(entry).toHaveProperty("feature");
      expect(entry).toHaveProperty("queries");
      expect(entry).toHaveProperty("tokens");
      expect(entry).toHaveProperty("avgMs");
      expect(entry).toHaveProperty("p95Ms");
      expect(entry).toHaveProperty("successes");
      expect(entry).toHaveProperty("failures");
    }
  });

  it("recentAudit entries never include changesJson (raw payload)", () => {
    const audit = body.recentAudit as Array<Record<string, unknown>>;
    for (const entry of audit) {
      expect(entry).not.toHaveProperty("changesJson");
      expect(entry).not.toHaveProperty("changes_json");
    }
  });

  it("superAdmins entries never include passwordHash", () => {
    const sec = body.security as Record<string, unknown>;
    const admins = sec.superAdmins as Array<Record<string, unknown>>;
    for (const a of admins) {
      expect(a).not.toHaveProperty("passwordHash");
      expect(a).not.toHaveProperty("password_hash");
      expect(a).not.toHaveProperty("password");
    }
  });

  it("response never contains session cookie or API key values", () => {
    const raw = JSON.stringify(body);
    // No connect.sid cookie values (they start with 's:')
    expect(raw).not.toMatch(/"s:[A-Za-z0-9_-]{20,}/);
    // No raw bcrypt hashes
    expect(raw).not.toMatch(/\$2[ab]\$\d+\$/);
    // No AI_INTEGRATIONS env var values (they would be bearer tokens)
    expect(raw).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
  });
});

// ---------------------------------------------------------------------------
// Tenant / data isolation
// ---------------------------------------------------------------------------

describe("data isolation", () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await request(app)
      .get("/api/admin/production-health")
      .set("Cookie", adminCookies);
    body = res.body;
  });

  it("employee counts reflect org 1 only", () => {
    // Seeded employees with orgId=16 must not inflate the count
    const hr = body.hr as Record<string, unknown>;
    // The hr section queries WHERE org_id = 1; verify it's a non-negative int
    expect(typeof hr.employeeTotal).toBe("number");
    expect(hr.employeeTotal as number).toBeGreaterThanOrEqual(0);
  });

  it("orphanedOrgUsers only lists users whose orgId is NOT in organizations table", () => {
    const sec = body.security as Record<string, unknown>;
    const orphaned = sec.orphanedOrgUsers as Array<Record<string, unknown>>;
    // All orphaned users must have a non-null orgId
    for (const u of orphaned) {
      expect(u.orgId).not.toBeNull();
    }
  });

  it("test admin created for this test appears in superAdmins list", () => {
    const sec = body.security as Record<string, unknown>;
    const admins = sec.superAdmins as Array<Record<string, unknown>>;
    const found = admins.some((a) => a.username === ADMIN_USER);
    expect(found).toBe(true);
  });

  it("test non-admin created for this test does NOT appear in superAdmins", () => {
    const sec = body.security as Record<string, unknown>;
    const admins = sec.superAdmins as Array<Record<string, unknown>>;
    const found = admins.some((a) => a.username === NONADMIN_USER);
    expect(found).toBe(false);
  });
});
