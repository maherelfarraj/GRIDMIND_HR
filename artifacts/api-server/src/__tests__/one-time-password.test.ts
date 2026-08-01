/**
 * Admin-issued one-time passwords (POST /users/:id/one-time-password).
 *
 * The on-demand replacement for handing out first-login credentials via
 * startup provisioning artifacts:
 *   - Only Super Administrators may issue one.
 *   - Response returns the plaintext exactly once; only the bcrypt hash is
 *     stored, and the OTP actually works for login.
 *   - must_change_password is always set; sign-in with the OTP is forced
 *     through the change-password gate.
 *   - All of the target's existing sessions are revoked.
 *   - An audit event is written (user.otp_issued) that never contains the
 *     password value.
 *
 * Runs under PILOT_AUTH=true so sessions are real. Fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { desc, eq } from "drizzle-orm";
import { db, systemUsersTable, auditLogsTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const USERNAME = `otp-target-${SUFFIX}`;
const ADMIN_USERNAME = `otp-admin-${SUFFIX}`;
const NONADMIN_USERNAME = `otp-nonadmin-${SUFFIX}`;
const PASSWORD = "OtpTarget123!";
const ADMIN_PASSWORD = "OtpAdmin123!";
const NONADMIN_PASSWORD = "OtpNonAdmin123!";

let app: Express;
let userId: number;
let adminId: number;
let nonAdminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "OTP Target",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash: await bcrypt.hash(PASSWORD, 10),
  }).returning();
  userId = user.id;

  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "OTP Admin",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
  }).returning();
  adminId = admin.id;

  const [nonAdmin] = await db.insert(systemUsersTable).values({
    username: NONADMIN_USERNAME,
    email: `${NONADMIN_USERNAME}@test.example`,
    fullNameEn: "OTP Non Admin",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash: await bcrypt.hash(NONADMIN_PASSWORD, 10),
  }).returning();
  nonAdminId = nonAdmin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const id of [userId, adminId, nonAdminId]) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.actorUserId, id)).catch(() => {});
    await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, id)).catch(() => {});
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

async function loggedInAgent(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

describe("POST /users/:id/one-time-password", () => {
  it("rejects non-admin actors", async () => {
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.post(`/api/users/${userId}/one-time-password`);
    expect(res.status).toBe(403);
  });

  it("404s for a missing user", async () => {
    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await admin.post(`/api/users/999999/one-time-password`);
    expect(res.status).toBe(404);
  });

  it("issues a working OTP, revokes sessions, forces change, and audits the event only", async () => {
    const target = await loggedInAgent(USERNAME, PASSWORD);
    expect((await target.get("/api/auth/me")).status).toBe(200);

    const admin = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await admin.post(`/api/users/${userId}/one-time-password`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(USERNAME);
    expect(res.body.mustChangePassword).toBe(true);
    const otp: string = res.body.oneTimePassword;
    expect(typeof otp).toBe("string");
    expect(otp.length).toBeGreaterThanOrEqual(24);

    // Target's old session is dead; the admin's survives.
    expect((await target.get("/api/auth/me")).status).toBe(401);
    expect((await admin.get("/api/auth/me")).status).toBe(200);

    // Stored credential is a hash of the OTP, flagged must_change_password.
    const [row] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordHash).not.toBe(otp);
    expect(await bcrypt.compare(otp, row.passwordHash!)).toBe(true);

    // The OTP actually works for login, gated behind the password change.
    const fresh = request.agent(app);
    const login = await fresh.post("/api/auth/login").send({ username: USERNAME, password: otp });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);

    // Audit trail: event recorded, value never persisted.
    const [audit] = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.action, "user.otp_issued"))
      .orderBy(desc(auditLogsTable.id))
      .limit(1);
    expect(audit).toBeTruthy();
    expect(audit.entityId).toBe(userId);
    expect(audit.entityLabel).toBe(USERNAME);
    expect(audit.actorUserId).toBe(adminId);
    expect(audit.changesJson ?? "").not.toContain(otp);

    // Admin-facing visibility: the users list surfaces the pending
    // must-change-password state and the last OTP issuance (time + issuer),
    // without ever exposing a password value.
    const list = await admin.get("/api/users");
    expect(list.status).toBe(200);
    const listed = list.body.find((u: { id: number }) => u.id === userId);
    expect(listed).toBeTruthy();
    expect(listed.mustChangePassword).toBe(true);
    expect(listed.lastOtpIssuedAt).toBe(audit.createdAt.toISOString());
    expect(listed.lastOtpIssuedByUserId).toBe(adminId);
    expect(typeof listed.lastOtpIssuedByName).toBe("string");
    expect(listed.passwordHash).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain(otp);

    // Same surfacing on the single-user endpoint.
    const detail = await admin.get(`/api/users/${userId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.lastOtpIssuedAt).toBe(audit.createdAt.toISOString());
    expect(detail.body.lastOtpIssuedByUserId).toBe(adminId);
    expect(detail.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(detail.body)).not.toContain(otp);
  });
});
