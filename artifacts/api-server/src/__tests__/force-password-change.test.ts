/**
 * Forced first-login password change flow (PILOT_AUTH=true).
 *
 * Accounts provisioned with the shared demo password (or reset by an admin)
 * carry must_change_password=true. Login still succeeds, but the client is
 * told to route the user to a mandatory change-password screen; the flag
 * only clears through POST /auth/change-password with the correct current
 * password.
 *
 * Like pilot-auth-password.test.ts, this stubs PILOT_AUTH at import time
 * and uses self-cleaning fixture users (vitest runs files sequentially).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const USERNAME = `force-change-test-${SUFFIX}`;
const ADMIN_USERNAME = `force-change-admin-${SUFFIX}`;
const PROVISIONED_PASSWORD = "SharedDemo123!";
const NEW_PASSWORD = "MyOwnSecret456!";

let app: Express;
let userId: number;
let adminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const passwordHash = await bcrypt.hash(PROVISIONED_PASSWORD, 10);
  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Force Change Test",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
    passwordHash,
    mustChangePassword: true,
  }).returning();
  userId = user.id;

  // Admin (Super Administrator, roleId 1) without the flag — used to
  // exercise the admin reset path.
  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "Force Change Admin",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
    passwordHash,
    mustChangePassword: false,
  }).returning();
  adminId = admin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, userId)).catch(() => {});
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, adminId)).catch(() => {});
});

describe("forced password change on first login", () => {
  it("login succeeds with the provisioned password and reports mustChangePassword=true", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  it("GET /auth/me also carries the flag for an active session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);
  });

  it("rejects change-password without a session", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: PROVISIONED_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong current password", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "wrong-password", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);

    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(row.mustChangePassword).toBe(true);
  });

  it("rejects a too-short new password", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: PROVISIONED_PASSWORD, newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects reusing the current password as the new password", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: PROVISIONED_PASSWORD, newPassword: PROVISIONED_PASSWORD });
    expect(res.status).toBe(400);
  });

  it("blocks business endpoints for a flagged session with 403 PASSWORD_CHANGE_REQUIRED", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });

    for (const path of ["/api/employees", "/api/dashboard/stats", "/api/departments"]) {
      const res = await agent.get(path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    const post = await agent.post("/api/departments").send({ nameEn: "x" });
    expect(post.status).toBe(403);
    expect(post.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("still allows /auth/me, /auth/change-password and /auth/logout while flagged", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);

    // change-password reachable (wrong current password → 401, not 403)
    const cp = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "wrong-password", newPassword: NEW_PASSWORD });
    expect(cp.status).toBe(401);

    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
  });

  it("does not block an unflagged session's business endpoints", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: ADMIN_USERNAME, password: PROVISIONED_PASSWORD });
    const res = await agent.get("/api/employees");
    expect(res.status).toBe(200);
  });

  it("clears the flag with the correct current password and enables the new one", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: PROVISIONED_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.passwordHash).toBeUndefined();

    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(row.mustChangePassword).toBe(false);
    expect(row.passwordHash!.startsWith("$2")).toBe(true);

    // Old password no longer works; new one does and no longer flags.
    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PROVISIONED_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustChangePassword).toBe(false);
  });

  it("an admin password reset re-arms the flag", async () => {
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: ADMIN_USERNAME, password: PROVISIONED_PASSWORD });
    expect(login.status).toBe(200);

    const res = await agent
      .post(`/api/users/${userId}/password`)
      .send({ password: "AdminReset789!" });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(row.mustChangePassword).toBe(true);

    const relogin = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: "AdminReset789!" });
    expect(relogin.status).toBe(200);
    expect(relogin.body.mustChangePassword).toBe(true);
  });
});
