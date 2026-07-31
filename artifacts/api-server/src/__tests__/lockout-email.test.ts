/**
 * Lockout admin alert email tests (PILOT_AUTH=true).
 *
 * Mocks the SMTP adapter's send function so no real email is attempted,
 * then verifies that crossing the lockout threshold emails active admins
 * with the account name, source IP, and lockout scope — and that a failing
 * send never blocks or breaks the login response.
 *
 * Same env-stub + fresh-module-registry pattern as login-lockout.test.ts;
 * fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, systemUsersTable, auditLogsTable, notificationsTable, rolesTable } from "@workspace/db";
import type { Express } from "express";

const sendSmtpMail = vi.fn(async () => ({
  success: true, message: "mock sent", latencyMs: 1, simulated: false,
}));
vi.mock("../lib/smtp-adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/smtp-adapter.js")>()),
  sendSmtpMail,
}));

const SUFFIX = Date.now();
const USERNAME = `lockmail-user-${SUFFIX}`;
const PASSWORD = "LockoutPass123!";
const MAX_FAILURES = 3;
const ADMIN_EMAIL = `lockmail-admin-${SUFFIX}@test.example`;

let app: Express;
let throttle: typeof import("../lib/loginThrottle");
const userIds: number[] = [];

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.stubEnv("LOGIN_MAX_FAILURES", String(MAX_FAILURES));
  vi.stubEnv("LOGIN_LOCKOUT_MS", "1500");
  vi.resetModules();
  app = (await import("../app")).default;
  throttle = await import("../lib/loginThrottle");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Lockout Email Test",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash,
  }).returning();
  userIds.push(user.id);

  const [adminRole] = await db.select().from(rolesTable)
    .where(like(rolesTable.nameEn, "%dmin%"));
  const [admin] = await db.insert(systemUsersTable).values({
    username: `lockmail-admin-${SUFFIX}`,
    email: ADMIN_EMAIL,
    fullNameEn: "Lockout Email Admin",
    fullNameAr: "مشرف",
    roleId: adminRole.id,
    isActive: true,
    passwordHash,
  }).returning();
  userIds.push(admin.id);
});

afterAll(async () => {
  throttle.resetLoginThrottle();
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const id of userIds) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
  await db.delete(auditLogsTable).where(and(
    inArray(auditLogsTable.action, ["login.failed", "login.lockout"]),
    like(auditLogsTable.entityLabel, `%${SUFFIX}%`),
  )).catch(() => {});
  await db.delete(notificationsTable).where(and(
    eq(notificationsTable.notificationType, "security_alert"),
    like(notificationsTable.titleEn, `%${SUFFIX}%`),
  )).catch(() => {});
});

beforeEach(() => {
  throttle.resetLoginThrottle();
  sendSmtpMail.mockClear();
});

function loginAttempt(username: string, password: string) {
  return request(app).post("/api/auth/login").send({ username, password });
}

async function exhaustFailures(username: string) {
  for (let i = 0; i < MAX_FAILURES; i++) {
    const res = await loginAttempt(username, "wrong-password");
    expect(res.status).toBe(401);
  }
}

// The email is sent fire-and-forget; give the microtask/IO queue a beat.
async function waitForSend() {
  for (let i = 0; i < 50 && sendSmtpMail.mock.calls.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("lockout admin alert emails", () => {
  it("emails admins with account name, source IP, and lockout scope", async () => {
    await exhaustFailures(USERNAME);
    await waitForSend();

    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
    const [opts] = sendSmtpMail.mock.calls[0] as unknown as [
      { to: string[]; subject: string; text: string },
    ];
    expect(opts.to).toContain(ADMIN_EMAIL);
    expect(opts.subject).toContain(USERNAME);
    expect(opts.text).toContain(USERNAME);
    expect(opts.text).toMatch(/Source IP: \S+/);
    expect(opts.text).toMatch(/Lockout scope: (account|ip|account\+ip)/);
  });

  it("does not email again for attempts made while already locked", async () => {
    await exhaustFailures(USERNAME);
    await waitForSend();
    expect((await loginAttempt(USERNAME, PASSWORD)).status).toBe(429);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
  });

  it("a failing email send never blocks or breaks the login response", async () => {
    sendSmtpMail.mockRejectedValueOnce(new Error("SMTP down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await exhaustFailures(USERNAME);
      await waitForSend();
      // Login response path unaffected: locked-out response still normal.
      const res = await loginAttempt(USERNAME, PASSWORD);
      expect(res.status).toBe(429);
      // In-app notifications were still written despite the email failure.
      const rows = await db.select().from(notificationsTable).where(and(
        eq(notificationsTable.notificationType, "security_alert"),
        like(notificationsTable.titleEn, `%${USERNAME}%`),
      ));
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      errSpy.mockRestore();
    }
  });
});
