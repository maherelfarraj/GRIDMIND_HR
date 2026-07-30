/**
 * Password-based login enforcement tests (PILOT_AUTH=true).
 *
 * PILOT_AUTH is read at module load time by auth.ts and requireAuth.ts, so
 * this file stubs the env var and re-imports the app with a fresh module
 * registry. All other test files run in demo mode; vitest runs files
 * sequentially (fileParallelism: false) so this does not leak.
 *
 * Uses a dedicated fixture user (never seeded accounts) and cleans up after.
 * Also covers the admin set-password endpoint (demo assertions run against
 * the same PILOT_AUTH app since the endpoint itself is auth-agnostic here).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const USERNAME = `pilot-auth-test-${SUFFIX}`;
const NOHASH_USERNAME = `pilot-nohash-test-${SUFFIX}`;
const NONADMIN_USERNAME = `pilot-nonadmin-test-${SUFFIX}`;
const PASSWORD = "CorrectHorse9!";

let app: Express;
let userId: number;
let noHashUserId: number;
let nonAdminUserId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [withHash] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Pilot Auth Test",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
    passwordHash,
  }).returning();
  userId = withHash.id;

  const [noHash] = await db.insert(systemUsersTable).values({
    username: NOHASH_USERNAME,
    email: `${NOHASH_USERNAME}@test.example`,
    fullNameEn: "Pilot NoHash Test",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
  }).returning();
  noHashUserId = noHash.id;

  // Non-admin user (HR Clerk, roleId 5) with a valid password — used to
  // verify the authorization boundary on the set-password endpoint.
  const [nonAdmin] = await db.insert(systemUsersTable).values({
    username: NONADMIN_USERNAME,
    email: `${NONADMIN_USERNAME}@test.example`,
    fullNameEn: "Pilot NonAdmin Test",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash,
  }).returning();
  nonAdminUserId = nonAdmin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, userId)).catch(() => {});
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, noHashUserId)).catch(() => {});
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, nonAdminUserId)).catch(() => {});
});

describe("PILOT_AUTH=true login enforcement", () => {
  it("succeeds with the correct password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(USERNAME);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("fails with a wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("fails when no password is supplied", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME });
    expect(res.status).toBe(401);
  });

  it("fails closed for an account with no stored hash, even with a password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: NOHASH_USERNAME, password: "anything" });
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns 401 without a session (no demo fallback)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("maintains a session after a successful password login", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username: USERNAME, password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(USERNAME);
  });
});

describe("POST /users/:id/password (set/reset)", () => {
  // requireAuth guards mutating routes under PILOT_AUTH — use a logged-in agent.
  async function loggedInAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username: USERNAME, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  it("rejects the request without a session (PILOT_AUTH enforced)", async () => {
    const res = await request(app)
      .post(`/api/users/${noHashUserId}/password`)
      .send({ password: "ValidPass123!" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for an authenticated non-admin user", async () => {
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: NONADMIN_USERNAME, password: PASSWORD });
    expect(login.status).toBe(200);

    const res = await agent
      .post(`/api/users/${noHashUserId}/password`)
      .send({ password: "ValidPass123!" });
    expect(res.status).toBe(403);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const agent = await loggedInAgent();
    const res = await agent
      .post(`/api/users/${noHashUserId}/password`)
      .send({ password: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown user", async () => {
    const agent = await loggedInAgent();
    const res = await agent
      .post("/api/users/99999999/password")
      .send({ password: "ValidPass123!" });
    expect(res.status).toBe(404);
  });

  it("stores a bcrypt hash (never plaintext) and enables login", async () => {
    const agent = await loggedInAgent();
    const newPassword = "FreshPass123!";
    const res = await agent
      .post(`/api/users/${noHashUserId}/password`)
      .send({ password: newPassword });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, noHashUserId));
    expect(row.passwordHash).toBeTruthy();
    expect(row.passwordHash).not.toBe(newPassword);
    expect(row.passwordHash!.startsWith("$2")).toBe(true);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: NOHASH_USERNAME, password: newPassword });
    expect(login.status).toBe(200);
  });

  it("does not leak passwordHash in user list or detail responses", async () => {
    const list = await request(app).get("/api/users");
    expect(list.status).toBe(200);
    for (const u of list.body) {
      expect(u.passwordHash).toBeUndefined();
    }
    const detail = await request(app).get(`/api/users/${userId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.passwordHash).toBeUndefined();
  });
});
