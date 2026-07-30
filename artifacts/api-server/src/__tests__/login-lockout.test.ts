/**
 * Login brute-force lockout tests (PILOT_AUTH=true).
 *
 * Stubs env vars (small failure threshold and short lockout so expiry can be
 * tested in real time) and re-imports the app with a fresh module registry,
 * same pattern as pilot-auth-password.test.ts. Vitest runs files sequentially
 * so the stubbed env does not leak.
 *
 * Uses dedicated fixture users; throttle state is wiped in afterAll via the
 * freshly-imported module's reset helper.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const USERNAME = `lockout-test-${SUFFIX}`;
const USERNAME2 = `lockout-other-${SUFFIX}`;
const PASSWORD = "LockoutPass123!";
const MAX_FAILURES = 3;
const LOCKOUT_MS = 1500;

let app: Express;
let throttle: typeof import("../lib/loginThrottle");
const userIds: number[] = [];

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.stubEnv("LOGIN_MAX_FAILURES", String(MAX_FAILURES));
  vi.stubEnv("LOGIN_LOCKOUT_MS", String(LOCKOUT_MS));
  vi.resetModules();
  app = (await import("../app")).default;
  throttle = await import("../lib/loginThrottle");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const username of [USERNAME, USERNAME2]) {
    const [row] = await db.insert(systemUsersTable).values({
      username,
      email: `${username}@test.example`,
      fullNameEn: "Lockout Test",
      fullNameAr: "اختبار",
      roleId: 5,
      isActive: true,
      passwordHash,
    }).returning();
    userIds.push(row.id);
  }
});

afterAll(async () => {
  throttle.resetLoginThrottle();
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const id of userIds) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

beforeEach(() => {
  throttle.resetLoginThrottle();
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

describe("login lockout", () => {
  it("returns 401 (not 429) below the failure threshold", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      const res = await loginAttempt(USERNAME, "wrong-password");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    }
    // Correct password still works before the threshold.
    const ok = await loginAttempt(USERNAME, PASSWORD);
    expect(ok.status).toBe(200);
  });

  it("locks the account after repeated failures, with bilingual message and Retry-After", async () => {
    await exhaustFailures(USERNAME);

    // Even the CORRECT password is rejected during lockout.
    const res = await loginAttempt(USERNAME, PASSWORD);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Too many failed login attempts/);
    expect(res.body.errorAr).toContain("محاولات تسجيل الدخول");
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("throttles unknown usernames too (no user enumeration via lockout)", async () => {
    const ghost = `no-such-user-${SUFFIX}`;
    for (let i = 0; i < MAX_FAILURES; i++) {
      const res = await loginAttempt(ghost, "whatever");
      expect(res.status).toBe(401);
    }
    const res = await loginAttempt(ghost, "whatever");
    expect(res.status).toBe(429);
  });

  it("a successful login resets the failure counter", async () => {
    // Two failures, then a success…
    await loginAttempt(USERNAME, "wrong-password");
    await loginAttempt(USERNAME, "wrong-password");
    const ok = await loginAttempt(USERNAME, PASSWORD);
    expect(ok.status).toBe(200);

    // …means the counter starts over: MAX_FAILURES-1 more failures do not lock.
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      const res = await loginAttempt(USERNAME, "wrong-password");
      expect(res.status).toBe(401);
    }
    const stillOk = await loginAttempt(USERNAME, PASSWORD);
    expect(stillOk.status).toBe(200);
  });

  it("lockout expires automatically and the counter resets", async () => {
    await exhaustFailures(USERNAME);
    expect((await loginAttempt(USERNAME, PASSWORD)).status).toBe(429);

    await new Promise((r) => setTimeout(r, LOCKOUT_MS + 100));

    // After expiry the correct password works again.
    const ok = await loginAttempt(USERNAME, PASSWORD);
    expect(ok.status).toBe(200);
  });

  it("locking one account does not affect another (per-account keying)", async () => {
    await exhaustFailures(USERNAME);
    expect((await loginAttempt(USERNAME, PASSWORD)).status).toBe(429);

    const other = await loginAttempt(USERNAME2, PASSWORD);
    expect(other.status).toBe(200);
  });

  it("username keying is case-insensitive for throttling", async () => {
    await exhaustFailures(USERNAME);
    const res = await loginAttempt(USERNAME.toUpperCase(), PASSWORD);
    expect(res.status).toBe(429);
  });
});

describe("loginThrottle unit behaviour", () => {
  it("per-IP threshold locks after spraying many usernames from one IP", () => {
    const now = 1_000_000;
    const ip = "203.0.113.9";
    for (let i = 0; i < throttle.IP_MAX_FAILURES; i++) {
      throttle.recordFailure(`spray-user-${i}`, ip, now);
    }
    const lock = throttle.isLockedOut("yet-another-user", ip, now);
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterMs).toBeGreaterThan(0);
  });

  it("expired lockout resets the failure count", () => {
    const now = 2_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) throttle.recordFailure("expiry-user", "10.0.0.1", now);
    expect(throttle.isLockedOut("expiry-user", "10.0.0.1", now).locked).toBe(true);

    const later = now + LOCKOUT_MS + 1;
    expect(throttle.isLockedOut("expiry-user", "10.0.0.1", later).locked).toBe(false);
    // One new failure after expiry does not immediately re-lock.
    throttle.recordFailure("expiry-user", "10.0.0.1", later);
    expect(throttle.isLockedOut("expiry-user", "10.0.0.1", later).locked).toBe(false);
    expect(throttle.remainingAttempts("expiry-user")).toBe(MAX_FAILURES - 1);
  });
});
