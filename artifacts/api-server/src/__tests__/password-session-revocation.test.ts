/**
 * Session revocation on password change (PILOT_AUTH=true).
 *
 * A password change — self-service or admin reset — must sign out every
 * other device: their session rows are deleted, so /auth/me returns 401.
 * The caller's own session survives a self-change.
 *
 * Runs under PILOT_AUTH=true (like pilot-auth-password.test.ts) so /auth/me
 * has no demo fallback and 401 genuinely means "session gone". Uses
 * dedicated fixture users and cleans up after.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const USERNAME = `sess-revoke-test-${SUFFIX}`;
const ADMIN_USERNAME = `sess-revoke-admin-${SUFFIX}`;
const PASSWORD = "RevokeStart123!";
const ADMIN_PASSWORD = "AdminRevoke123!";

let app: Express;
let userId: number;
let adminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Session Revoke Test",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash: await bcrypt.hash(PASSWORD, 10),
  }).returning();
  userId = user.id;

  // Super Administrator (roleId 1) actor for the admin reset endpoint.
  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "Session Revoke Admin",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
  }).returning();
  adminId = admin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, userId)).catch(() => {});
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, adminId)).catch(() => {});
});

async function loggedInAgent(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

describe("POST /auth/change-password revokes other sessions", () => {
  it("signs out a second device but keeps the caller's session", async () => {
    const deviceA = await loggedInAgent(USERNAME, PASSWORD);
    const deviceB = await loggedInAgent(USERNAME, PASSWORD);

    // Both devices are live before the change.
    expect((await deviceA.get("/api/auth/me")).status).toBe(200);
    expect((await deviceB.get("/api/auth/me")).status).toBe(200);

    const newPassword = "RevokedNow456!";
    const res = await deviceA
      .post("/api/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword });
    expect(res.status).toBe(200);

    // The other device is signed out; the caller stays signed in.
    expect((await deviceB.get("/api/auth/me")).status).toBe(401);
    expect((await deviceA.get("/api/auth/me")).status).toBe(200);

    // Restore the fixture password for the admin-reset test below.
    await db.update(systemUsersTable)
      .set({ passwordHash: await bcrypt.hash(PASSWORD, 10) })
      .where(eq(systemUsersTable.id, userId));
  });
});

describe("POST /users/:id/password revokes the target's sessions", () => {
  it("signs out all of the target user's devices on admin reset", async () => {
    const target = await loggedInAgent(USERNAME, PASSWORD);
    expect((await target.get("/api/auth/me")).status).toBe(200);

    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await admin
      .post(`/api/users/${userId}/password`)
      .send({ password: "AdminSet789!" });
    expect(res.status).toBe(200);

    // Target's session is gone; the admin's own session is untouched.
    expect((await target.get("/api/auth/me")).status).toBe(401);
    expect((await admin.get("/api/auth/me")).status).toBe(200);
  });

  it("keeps the admin's own session when resetting their own password", async () => {
    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await admin
      .post(`/api/users/${adminId}/password`)
      .send({ password: "AdminSelf789!" });
    expect(res.status).toBe(200);
    expect((await admin.get("/api/auth/me")).status).toBe(200);
  });
});
