/**
 * Failure path for session revocation on password change (PILOT_AUTH=true).
 *
 * If the session rows cannot be deleted, the endpoint must NOT report a
 * successful password change: the transaction rolls back, the old password
 * still works, and existing sessions remain intact (never a false success
 * that leaves stolen sessions alive under a "changed" password).
 *
 * Mocks revokeUserSessions to throw; separate file so the happy-path suite
 * keeps the real implementation.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

vi.mock("../lib/sessionRevocation.js", () => ({
  revokeUserSessions: vi.fn(async () => {
    throw new Error("simulated session-store failure");
  }),
}));

const SUFFIX = Date.now();
const USERNAME = `sess-revoke-fail-test-${SUFFIX}`;
const ADMIN_USERNAME = `sess-revoke-fail-admin-${SUFFIX}`;
const PASSWORD = "RevokeFail123!";
const ADMIN_PASSWORD = "AdminFail123!";

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
    fullNameEn: "Session Revoke Failure Test",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash: await bcrypt.hash(PASSWORD, 10),
  }).returning();
  userId = user.id;

  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "Session Revoke Failure Admin",
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

describe("password change fails closed when session revocation fails", () => {
  it("self-service: no success, password rolled back, other sessions intact", async () => {
    const deviceA = await loggedInAgent(USERNAME, PASSWORD);
    const deviceB = await loggedInAgent(USERNAME, PASSWORD);

    const res = await deviceA
      .post("/api/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "NeverLands456!" });
    expect(res.status).toBe(500);
    expect(res.body.success).toBeUndefined();

    // Password update rolled back: stored hash still matches the old
    // password, not the new one. (Asserted against the DB rather than via
    // failed logins, which would count toward the shared IP lockout.)
    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(await bcrypt.compare(PASSWORD, row.passwordHash!)).toBe(true);
    expect(await bcrypt.compare("NeverLands456!", row.passwordHash!)).toBe(false);
    expect((await request(app).post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD })).status).toBe(200);

    // Existing sessions untouched (consistent state, no partial change).
    expect((await deviceB.get("/api/auth/me")).status).toBe(200);
  });

  it("admin reset: no success and target password unchanged", async () => {
    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await admin
      .post(`/api/users/${userId}/password`)
      .send({ password: "AdminNeverLands789!" });
    expect(res.status).toBe(500);
    expect(res.body.success).toBeUndefined();

    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(await bcrypt.compare(PASSWORD, row.passwordHash!)).toBe(true);
    expect(await bcrypt.compare("AdminNeverLands789!", row.passwordHash!)).toBe(false);
  });
});
