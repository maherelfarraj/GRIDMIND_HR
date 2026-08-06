/**
 * Session revocation on account deactivation (PILOT_AUTH=true).
 *
 * Setting isActive=false via PATCH /users/:id must immediately delete the
 * target user's session rows so their next request to any auth-gated endpoint
 * returns 401 — regardless of whether the endpoint re-checks isActive.
 *
 * Runs under PILOT_AUTH=true so /auth/me has no demo fallback and a 401
 * genuinely means "session gone". Uses dedicated fixture users and cleans up
 * after itself.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const TARGET_USERNAME = `deactivate-target-${SUFFIX}`;
const ADMIN_USERNAME = `deactivate-admin-${SUFFIX}`;
const TARGET_PASSWORD = "TargetActive123!";
const ADMIN_PASSWORD = "AdminDeactivate123!";

let app: Express;
let targetId: number;
let adminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [target] = await db.insert(systemUsersTable).values({
    username: TARGET_USERNAME,
    email: `${TARGET_USERNAME}@test.example`,
    fullNameEn: "Deactivation Target",
    fullNameAr: "اختبار إلغاء التفعيل",
    roleId: 5,
    isActive: true,
    passwordHash: await bcrypt.hash(TARGET_PASSWORD, 10),
  }).returning();
  targetId = target.id;

  // Super Administrator (roleId 1) to call PATCH /users/:id.
  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "Deactivation Admin",
    fullNameAr: "اختبار المدير",
    roleId: 1,
    isActive: true,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
  }).returning();
  adminId = admin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  // Re-activate target in case a test failed before the cleanup run.
  await db.update(systemUsersTable)
    .set({ isActive: true })
    .where(eq(systemUsersTable.id, targetId))
    .catch(() => {});
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, targetId)).catch(() => {});
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, adminId)).catch(() => {});
});

async function loggedInAgent(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

describe("PATCH /users/:id deactivation revokes sessions", () => {
  it("returns 401 for the deactivated user immediately after deactivation", async () => {
    const targetAgent = await loggedInAgent(TARGET_USERNAME, TARGET_PASSWORD);

    // Confirm the session is live before deactivation.
    expect((await targetAgent.get("/api/auth/me")).status).toBe(200);

    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const patch = await admin
      .patch(`/api/users/${targetId}`)
      .send({ isActive: false });
    expect(patch.status).toBe(200);
    expect(patch.body.isActive).toBe(false);

    // The target's session must be gone — 401, not 403 or a stale 200.
    expect((await targetAgent.get("/api/auth/me")).status).toBe(401);

    // The admin's own session is unaffected.
    expect((await admin.get("/api/auth/me")).status).toBe(200);
  });

  it("does not revoke sessions when a non-active field is updated", async () => {
    // Re-activate the target so we can log in again.
    await db.update(systemUsersTable)
      .set({ isActive: true })
      .where(eq(systemUsersTable.id, targetId));

    const targetAgent = await loggedInAgent(TARGET_USERNAME, TARGET_PASSWORD);
    expect((await targetAgent.get("/api/auth/me")).status).toBe(200);

    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    // Update a non-active field (fullNameEn) — sessions must survive.
    const patch = await admin
      .patch(`/api/users/${targetId}`)
      .send({ fullNameEn: "Deactivation Target Updated" });
    expect(patch.status).toBe(200);

    // Session still alive — no accidental revocation.
    expect((await targetAgent.get("/api/auth/me")).status).toBe(200);
  });
});
