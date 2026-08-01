/**
 * Security-alert email outage watchdog tests.
 *
 * Verifies that when a security alert email fails to send (SMTP unconfigured
 * or send error), admins get an in-app notification — deduplicated to one
 * warning per outage window — and that a successful send closes the window
 * so a later failure warns again.
 *
 * Also exercises the full login-lockout path with a failing SMTP send to
 * prove the warning is raised end-to-end. Fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, systemUsersTable, auditLogsTable, notificationsTable, rolesTable } from "@workspace/db";
import type { Express } from "express";

const sendSmtpMail = vi.fn(async () => ({
  success: false as const,
  message: "SMTP not configured — missing environment variables: SMTP_HOST, SMTP_USER, SMTP_PASS",
  latencyMs: 1,
  simulated: false,
}));
vi.mock("../lib/smtp-adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/smtp-adapter.js")>()),
  sendSmtpMail,
}));

const SUFFIX = Date.now();
const USERNAME = `mailout-user-${SUFFIX}`;
const PASSWORD = "OutagePass123!";
const MAX_FAILURES = 3;
const OUTAGE_TITLE = "Security alert emails are not being delivered";

let app: Express;
let throttle: typeof import("../lib/loginThrottle");
let watchdog: typeof import("../lib/email-alert-status");
const userIds: number[] = [];
let adminId: number;

async function countOutageNotifications(): Promise<number> {
  const rows = await db.select().from(notificationsTable).where(and(
    eq(notificationsTable.recipientUserId, adminId),
    eq(notificationsTable.titleEn, OUTAGE_TITLE),
  ));
  return rows.length;
}

async function deleteOutageNotifications(): Promise<void> {
  await db.delete(notificationsTable)
    .where(eq(notificationsTable.titleEn, OUTAGE_TITLE));
}

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.stubEnv("LOGIN_MAX_FAILURES", String(MAX_FAILURES));
  vi.stubEnv("LOGIN_LOCKOUT_MS", "1500");
  vi.resetModules();
  app = (await import("../app")).default;
  throttle = await import("../lib/loginThrottle");
  watchdog = await import("../lib/email-alert-status");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Email Outage Test",
    fullNameAr: "اختبار",
    roleId: 5,
    isActive: true,
    passwordHash,
  }).returning();
  userIds.push(user.id);

  const [adminRole] = await db.select().from(rolesTable)
    .where(like(rolesTable.nameEn, "%dmin%"));
  const [admin] = await db.insert(systemUsersTable).values({
    username: `mailout-admin-${SUFFIX}`,
    email: `mailout-admin-${SUFFIX}@test.example`,
    fullNameEn: "Email Outage Admin",
    fullNameAr: "مشرف",
    roleId: adminRole.id,
    isActive: true,
    passwordHash,
  }).returning();
  userIds.push(admin.id);
  adminId = admin.id;
});

afterAll(async () => {
  throttle.resetLoginThrottle();
  watchdog.resetSecurityEmailDeliveryStatus();
  vi.unstubAllEnvs();
  vi.resetModules();
  await deleteOutageNotifications().catch(() => {});
  await db.delete(notificationsTable).where(and(
    eq(notificationsTable.notificationType, "security_alert"),
    like(notificationsTable.titleEn, `%${SUFFIX}%`),
  )).catch(() => {});
  await db.delete(auditLogsTable).where(and(
    inArray(auditLogsTable.action, ["login.failed", "login.lockout"]),
    like(auditLogsTable.entityLabel, `%${SUFFIX}%`),
  )).catch(() => {});
  for (const id of userIds) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

beforeEach(async () => {
  throttle.resetLoginThrottle();
  watchdog.resetSecurityEmailDeliveryStatus();
  sendSmtpMail.mockClear();
  await deleteOutageNotifications();
});

describe("security email outage watchdog (unit)", () => {
  it("raises one admin notification on the first failure of an outage", async () => {
    const raised = await watchdog.recordSecurityEmailOutcome(
      { success: false, message: "SMTP not configured" }, "test alert");
    expect(raised).toBe(true);
    expect(await countOutageNotifications()).toBe(1);
    const status = watchdog.getSecurityEmailDeliveryStatus();
    expect(status.outageActive).toBe(true);
    expect(status.lastFailureMessage).toContain("SMTP not configured");
  });

  it("does not re-warn on repeated failures within the same outage window", async () => {
    await watchdog.recordSecurityEmailOutcome({ success: false, message: "down" }, "test alert");
    const second = await watchdog.recordSecurityEmailOutcome({ success: false, message: "still down" }, "test alert");
    const third = await watchdog.recordSecurityEmailOutcome({ success: false, message: "still down" }, "test alert");
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(await countOutageNotifications()).toBe(1);
  });

  it("a successful send closes the outage window; a later failure warns again", async () => {
    await watchdog.recordSecurityEmailOutcome({ success: false, message: "down" }, "test alert");
    await watchdog.recordSecurityEmailOutcome({ success: true }, "test alert");
    expect(watchdog.getSecurityEmailDeliveryStatus().outageActive).toBe(false);
    const raisedAgain = await watchdog.recordSecurityEmailOutcome(
      { success: false, message: "down again" }, "test alert");
    expect(raisedAgain).toBe(true);
    expect(await countOutageNotifications()).toBe(2);
  });
});

describe("login lockout with failing SMTP (end-to-end)", () => {
  it("crossing the lockout threshold with SMTP unconfigured surfaces an in-app outage warning", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      const res = await request(app).post("/api/auth/login")
        .send({ username: USERNAME, password: "wrong-password" });
      expect(res.status).toBe(401);
    }
    // Email send + watchdog run fire-and-forget; wait for the notification.
    let count = 0;
    for (let i = 0; i < 50; i++) {
      count = await countOutageNotifications();
      if (count > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
    expect(count).toBe(1);
    const [row] = await db.select().from(notificationsTable).where(and(
      eq(notificationsTable.recipientUserId, adminId),
      eq(notificationsTable.titleEn, OUTAGE_TITLE),
    ));
    expect(row.bodyEn).toContain("SMTP not configured");
    expect(row.bodyEn).toContain(USERNAME);
  });
});

describe("GET /api/integration-governance/security-email-status", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/integration-governance/security-email-status");
    expect(res.status).toBe(401);
  });

  it("returns the current delivery status to an authenticated user", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login")
      .send({ username: `mailout-admin-${SUFFIX}`, password: PASSWORD });
    expect(login.status).toBe(200);

    // Healthy baseline
    let res = await agent.get("/api/integration-governance/security-email-status");
    expect(res.status).toBe(200);
    expect(res.body.outageActive).toBe(false);
    expect(res.body.lastFailureMessage).toBeNull();

    // After a failure, the endpoint reflects the outage
    await watchdog.recordSecurityEmailOutcome({ success: false, message: "SMTP relay down" }, "test alert");
    res = await agent.get("/api/integration-governance/security-email-status");
    expect(res.status).toBe(200);
    expect(res.body.outageActive).toBe(true);
    expect(res.body.lastFailureMessage).toBe("SMTP relay down");
    expect(res.body.lastFailureAt).toBeTruthy();
    expect(res.body.outageSince).toBeTruthy();

    // A success closes the outage
    await watchdog.recordSecurityEmailOutcome({ success: true }, "test alert");
    res = await agent.get("/api/integration-governance/security-email-status");
    expect(res.body.outageActive).toBe(false);
    expect(res.body.lastSuccessAt).toBeTruthy();
  });
});
