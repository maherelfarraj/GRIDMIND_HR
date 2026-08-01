/**
 * Admin unlock tests (PILOT_AUTH=true).
 *
 * An admin can clear a login lockout immediately instead of waiting out the
 * timer: POST /users/:id/unlock clears the account's throttle key and the
 * source-IP keys from recent failed-login audit entries, records the unlock
 * in the audit trail, and GET /users surfaces lockedUntil so the UI can show
 * an Unlock action only for locked accounts.
 *
 * Same env-stub + fresh-module pattern as login-lockout.test.ts; fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, systemUsersTable, rolesTable, auditLogsTable, notificationsTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const VICTIM = `unlock-victim-${SUFFIX}`;
const NONADMIN = `unlock-plain-${SUFFIX}`;
const ADMIN = `unlock-admin-${SUFFIX}`;
const PASSWORD = "UnlockPass123!";
const MAX_FAILURES = 3;
const LOCKOUT_MS = 60_000; // long enough that it will NOT expire during the test

let app: Express;
let throttle: typeof import("../lib/loginThrottle");
const userIds: number[] = [];
let victimId: number;
let nonAdminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.stubEnv("LOGIN_MAX_FAILURES", String(MAX_FAILURES));
  vi.stubEnv("LOGIN_LOCKOUT_MS", String(LOCKOUT_MS));
  vi.resetModules();
  app = (await import("../app")).default;
  throttle = await import("../lib/loginThrottle");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [superAdminRole] = await db.select().from(rolesTable)
    .where(eq(rolesTable.nameEn, "Super Administrator"));
  expect(superAdminRole).toBeTruthy();
  const [plainRole] = await db.select().from(rolesTable)
    .where(eq(rolesTable.id, 5));

  const mk = async (username: string, roleId: number) => {
    const [row] = await db.insert(systemUsersTable).values({
      username,
      email: `${username}@test.example`,
      fullNameEn: "Unlock Test",
      fullNameAr: "اختبار",
      roleId,
      isActive: true,
      passwordHash,
    }).returning();
    userIds.push(row.id);
    return row.id;
  };
  victimId = await mk(VICTIM, plainRole?.id ?? 5);
  nonAdminId = await mk(NONADMIN, plainRole?.id ?? 5);
  await mk(ADMIN, superAdminRole.id);
});

afterAll(async () => {
  throttle.resetLoginThrottle();
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const id of userIds) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
  await db.delete(auditLogsTable).where(and(
    inArray(auditLogsTable.action, ["login.failed", "login.lockout", "user.unlock"]),
    like(auditLogsTable.entityLabel, `%${SUFFIX}%`),
  )).catch(() => {});
  await db.delete(notificationsTable).where(and(
    eq(notificationsTable.notificationType, "security_alert"),
    like(notificationsTable.titleEn, `%${SUFFIX}%`),
  )).catch(() => {});
});

beforeEach(() => {
  throttle.resetLoginThrottle();
});

function loginAttempt(username: string, password: string) {
  return request(app).post("/api/auth/login").send({ username, password });
}

async function loginCookie(username: string): Promise<string> {
  const res = await loginAttempt(username, PASSWORD);
  expect(res.status).toBe(200);
  const cookie = res.headers["set-cookie"]?.[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function lockOut(username: string) {
  for (let i = 0; i < MAX_FAILURES; i++) {
    expect((await loginAttempt(username, "wrong-password")).status).toBe(401);
  }
  expect((await loginAttempt(username, PASSWORD)).status).toBe(429);
}

describe("admin unlock", () => {
  it("GET /users reports lockedUntil for locked accounts and null otherwise", async () => {
    const adminCookie = await loginCookie(ADMIN);
    await lockOut(VICTIM);

    const res = await request(app).get("/api/users").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const victim = res.body.find((u: { id: number }) => u.id === victimId);
    expect(victim.lockedUntil).toBeTruthy();
    expect(new Date(victim.lockedUntil).getTime()).toBeGreaterThan(Date.now());
    const other = res.body.find((u: { id: number }) => u.id === nonAdminId);
    expect(other.lockedUntil).toBeNull();
  });

  it("admin unlock lets the user sign in immediately and records an audit entry", async () => {
    const adminCookie = await loginCookie(ADMIN);
    await lockOut(VICTIM);

    const res = await request(app)
      .post(`/api/users/${victimId}/unlock`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Correct password now works without waiting out the timer.
    expect((await loginAttempt(VICTIM, PASSWORD)).status).toBe(200);

    // No longer reported as locked.
    const list = await request(app).get("/api/users").set("Cookie", adminCookie);
    const victim = list.body.find((u: { id: number }) => u.id === victimId);
    expect(victim.lockedUntil).toBeNull();

    // Audit trail records the unlock, incl. the cleared throttle keys.
    const rows = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "user.unlock"),
      eq(auditLogsTable.entityLabel, VICTIM),
    ));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[rows.length - 1];
    expect(row.entityType).toBe("system_user");
    expect(row.entityId).toBe(victimId);
    expect(row.actorUserId).toBe(userIds[2]);
    const changes = JSON.parse(row.changesJson ?? "{}");
    expect(changes.clearedKeys).toContain(`user:${VICTIM.toLowerCase()}`);
  });

  it("also clears the source-IP throttle keys from recent failed logins", async () => {
    const adminCookie = await loginCookie(ADMIN);
    await lockOut(VICTIM);

    await request(app)
      .post(`/api/users/${victimId}/unlock`)
      .set("Cookie", adminCookie)
      .expect(200);

    const rows = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "user.unlock"),
      eq(auditLogsTable.entityLabel, VICTIM),
    ));
    const changes = JSON.parse(rows[rows.length - 1].changesJson ?? "{}");
    // The failed attempts came from the test client's IP; that key is cleared too.
    expect(changes.clearedIps.length).toBeGreaterThanOrEqual(1);
    expect(changes.clearedKeys.some((k: string) => k.startsWith("ip:"))).toBe(true);
  });

  it("rejects non-admin callers with 403 and leaves the lockout in place", async () => {
    const plainCookie = await loginCookie(NONADMIN);
    await lockOut(VICTIM);

    const res = await request(app)
      .post(`/api/users/${victimId}/unlock`)
      .set("Cookie", plainCookie);
    expect(res.status).toBe(403);

    // Still locked.
    expect((await loginAttempt(VICTIM, PASSWORD)).status).toBe(429);
  });

  it("returns 404 for an unknown user id", async () => {
    const adminCookie = await loginCookie(ADMIN);
    await request(app)
      .post("/api/users/999999/unlock")
      .set("Cookie", adminCookie)
      .expect(404);
  });

  it("unlocking an account that is not locked succeeds (idempotent)", async () => {
    const adminCookie = await loginCookie(ADMIN);
    const res = await request(app)
      .post(`/api/users/${victimId}/unlock`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
