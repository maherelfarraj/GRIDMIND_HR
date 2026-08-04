/**
 * Authorization for the user directory endpoints.
 *
 * Client routing (web sidebar, mobile Home entry) is not a security
 * boundary: any signed-in user could call these endpoints directly (e.g. by
 * deep-linking the mobile admin screen). The server must enforce:
 *   - GET /users        → Super Administrator only (account enumeration).
 *   - GET /users/:id    → self, or Super Administrator for other records
 *                         (mobile uses the self read to learn its role).
 *   - POST /users       → Super Administrator only (account creation).
 *   - PATCH /users/:id  → Super Administrator only (field updates).
 *   - POST /users/:id/password         → Super Administrator only.
 *   - POST /users/:id/one-time-password → Super Administrator only.
 *   - POST /users/:id/unlock           → Super Administrator only.
 *   - Unauthenticated requests are rejected outright.
 *
 * Runs under PILOT_AUTH=true so sessions are real. Fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const ADMIN_USERNAME = `dir-admin-${SUFFIX}`;
const NONADMIN_USERNAME = `dir-nonadmin-${SUFFIX}`;
const PATCH_TARGET_USERNAME = `dir-patch-target-${SUFFIX}`;
const ADMIN_PASSWORD = "DirAdmin123!";
const NONADMIN_PASSWORD = "DirNonAdmin123!";
const PATCH_TARGET_PASSWORD = "PatchTarget123!";

let app: Express;
let adminId: number;
let nonAdminId: number;
let patchTargetId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "Directory Admin",
    fullNameAr: "اختبار",
    roleId: 1, // Super Administrator
    isActive: true,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
  }).returning();
  adminId = admin.id;

  const [nonAdmin] = await db.insert(systemUsersTable).values({
    username: NONADMIN_USERNAME,
    email: `${NONADMIN_USERNAME}@test.example`,
    fullNameEn: "Directory Non Admin",
    fullNameAr: "اختبار",
    roleId: 5, // non-admin
    isActive: true,
    passwordHash: await bcrypt.hash(NONADMIN_PASSWORD, 10),
  }).returning();
  nonAdminId = nonAdmin.id;

  const [patchTarget] = await db.insert(systemUsersTable).values({
    username: PATCH_TARGET_USERNAME,
    email: `${PATCH_TARGET_USERNAME}@test.example`,
    fullNameEn: "Patch Target Original",
    fullNameAr: "هدف",
    roleId: 5, // non-admin
    isActive: true,
    passwordHash: await bcrypt.hash(PATCH_TARGET_PASSWORD, 10),
  }).returning();
  patchTargetId = patchTarget.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const id of [adminId, nonAdminId, patchTargetId]) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

async function loggedInAgent(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

describe("GET /users authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions (no account enumeration)", async () => {
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.get("/api/users");
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator sessions", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.get("/api/users");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // No password material ever leaves the endpoint.
    for (const u of res.body) expect(u.passwordHash).toBeUndefined();
  });
});

describe("GET /users/:id authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get(`/api/users/${nonAdminId}`);
    expect(res.status).toBe(401);
  });

  it("lets a non-admin read only their own record", async () => {
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);

    const self = await agent.get(`/api/users/${nonAdminId}`);
    expect(self.status).toBe(200);
    expect(self.body.username).toBe(NONADMIN_USERNAME);
    expect(typeof self.body.roleNameEn).toBe("string");
    expect(self.body.passwordHash).toBeUndefined();

    const other = await agent.get(`/api/users/${adminId}`);
    expect(other.status).toBe(403);
  });

  it("lets an admin read any record", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.get(`/api/users/${nonAdminId}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(NONADMIN_USERNAME);
  });
});

describe("PATCH /api/users/:id authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .patch(`/api/users/${patchTargetId}`)
      .send({ email: "should-not-apply@test.example" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and leaves the target unchanged", async () => {
    // Snapshot the target before the rejected mutation attempt.
    const [before] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));

    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent
      .patch(`/api/users/${patchTargetId}`)
      .send({ email: "hacked@test.example", fullNameEn: "Hacked" });
    expect(res.status).toBe(403);

    // The target row must be byte-for-byte equal to the snapshot.
    const [after] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));
    expect(after.email).toBe(before.email);
    expect(after.fullNameEn).toBe(before.fullNameEn);
    expect(after.fullNameAr).toBe(before.fullNameAr);
  });

  it("allows Super Administrator to update email and name fields", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const newEmail = `patched-${SUFFIX}@test.example`;
    const newFirstLast = "Patch Updated";

    const res = await agent
      .patch(`/api/users/${patchTargetId}`)
      .send({ email: newEmail, fullNameEn: newFirstLast });
    expect(res.status).toBe(200);

    // Updated fields must be reflected in the response.
    expect(res.body.email).toBe(newEmail);
    expect(res.body.fullNameEn).toBe(newFirstLast);

    // Sanity: the response must identify the correct user.
    expect(res.body.id).toBe(patchTargetId);
    expect(res.body.username).toBe(PATCH_TARGET_USERNAME);
  });

  it("never exposes passwordHash in any PATCH response", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);

    // Super Administrator update — check the 200 response.
    const ok = await agent
      .patch(`/api/users/${patchTargetId}`)
      .send({ fullNameAr: "محدث" });
    expect(ok.status).toBe(200);
    expect(ok.body.passwordHash).toBeUndefined();

    // Non-admin rejection — check the 403 response body too.
    const nonAdminAgent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const denied = await nonAdminAgent
      .patch(`/api/users/${patchTargetId}`)
      .send({ fullNameEn: "Should Not Apply" });
    expect(denied.status).toBe(403);
    expect(denied.body.passwordHash).toBeUndefined();

    // Unauthenticated — check the 401 response body.
    const unauth = await request(app)
      .patch(`/api/users/${patchTargetId}`)
      .send({ fullNameEn: "Also Should Not Apply" });
    expect(unauth.status).toBe(401);
    expect(unauth.body.passwordHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/users — account creation
// ---------------------------------------------------------------------------

const CREATED_USER_IDS: number[] = [];

afterEach(async () => {
  // Clean up any users created by POST /users tests.
  for (const id of CREATED_USER_IDS.splice(0)) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

function newUserPayload(label: string) {
  return {
    username: `create-test-${label}-${SUFFIX}`,
    email: `create-test-${label}-${SUFFIX}@test.example`,
    fullNameEn: "Create Test",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    preferredLanguage: "en",
  };
}

describe("POST /api/users authorization", () => {
  it("rejects unauthenticated requests with 401 and does not create a user", async () => {
    const payload = newUserPayload("unauth");
    const res = await request(app).post("/api/users").send(payload);
    expect(res.status).toBe(401);

    // Confirm no row was created.
    const rows = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, payload.username));
    expect(rows).toHaveLength(0);
  });

  it("rejects non-admin sessions with 403 and does not create a user", async () => {
    const payload = newUserPayload("nonadmin");
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(403);

    // Confirm no row was created.
    const rows = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, payload.username));
    expect(rows).toHaveLength(0);
  });

  it("allows Super Administrator to create a user and returns 201", async () => {
    const payload = newUserPayload("admin");
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(201);
    expect(res.body.username).toBe(payload.username);
    expect(res.body.passwordHash).toBeUndefined();

    // Track the created ID so afterEach can remove it.
    CREATED_USER_IDS.push(res.body.id as number);

    // Confirm the row exists in the DB.
    const rows = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, res.body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe(payload.username);
  });
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/password — admin-initiated password reset
// ---------------------------------------------------------------------------

const STRONG_PASSWORD = "TestReset999!";

describe("POST /api/users/:id/password authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post(`/api/users/${patchTargetId}/password`)
      .send({ password: STRONG_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and leaves the password hash unchanged", async () => {
    const [before] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));

    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent
      .post(`/api/users/${patchTargetId}/password`)
      .send({ password: STRONG_PASSWORD });
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("allows Super Administrator to reset a password", async () => {
    const [before] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));

    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent
      .post(`/api/users/${patchTargetId}/password`)
      .send({ password: STRONG_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The stored hash must have changed.
    const [after] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));
    expect(after.passwordHash).not.toBe(before.passwordHash);
    // mustChangePassword must be set so the user is forced to pick a new one.
    expect(after.mustChangePassword).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/one-time-password — OTP issuance
// ---------------------------------------------------------------------------

describe("POST /api/users/:id/one-time-password authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post(`/api/users/${patchTargetId}/one-time-password`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and does not change the password hash", async () => {
    const [before] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));

    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.post(`/api/users/${patchTargetId}/one-time-password`);
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("allows Super Administrator to issue an OTP and returns the plaintext exactly once", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.post(`/api/users/${patchTargetId}/one-time-password`);
    expect(res.status).toBe(200);

    // The response must contain the one-time password — it is never stored
    // or sent again.
    expect(typeof res.body.oneTimePassword).toBe("string");
    expect(res.body.oneTimePassword.length).toBeGreaterThan(0);
    expect(res.body.username).toBe(PATCH_TARGET_USERNAME);
    expect(res.body.mustChangePassword).toBe(true);

    // The DB row must reflect mustChangePassword = true.
    const [row] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, patchTargetId));
    expect(row.mustChangePassword).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/unlock — account unlock
// ---------------------------------------------------------------------------

describe("POST /api/users/:id/unlock authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post(`/api/users/${patchTargetId}/unlock`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.post(`/api/users/${patchTargetId}/unlock`);
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to unlock an account", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.post(`/api/users/${patchTargetId}/unlock`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
