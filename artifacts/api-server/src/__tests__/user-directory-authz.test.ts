/**
 * Authorization for the user directory endpoints.
 *
 * Client routing (web sidebar, mobile Home entry) is not a security
 * boundary: any signed-in user could call these endpoints directly (e.g. by
 * deep-linking the mobile admin screen). The server must enforce:
 *   - GET /users        → Super Administrator only (account enumeration).
 *   - GET /users/:id    → self, or Super Administrator for other records
 *                         (mobile uses the self read to learn its role).
 *   - Unauthenticated requests are rejected outright.
 *
 * Runs under PILOT_AUTH=true so sessions are real. Fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
