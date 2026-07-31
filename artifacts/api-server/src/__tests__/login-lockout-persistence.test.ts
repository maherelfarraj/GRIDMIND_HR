/**
 * Persistent login-throttle tests.
 *
 * Verifies that failure counters and lockout expiries are written through
 * to the login_throttle table, survive a simulated restart (fresh module
 * registry → fresh in-memory map hydrated from the DB), and that the
 * per-key write serialization keeps the persisted copy consistent under
 * race-prone sequences (rapid failures, failure→success).
 *
 * Same env-stubbing pattern as login-lockout.test.ts; vitest runs files
 * sequentially so the stubbed env does not leak. Self-cleaning: state is
 * wiped via resetLoginThrottle in beforeEach/afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db, loginThrottleTable } from "@workspace/db";

const MAX_FAILURES = 3;
const LOCKOUT_MS = 60_000;
const IP = "203.0.113.77";

type Throttle = typeof import("../lib/loginThrottle");
let throttle: Throttle;

/** Simulate a server restart: fresh module registry, fresh in-memory map. */
async function reimportThrottle(): Promise<Throttle> {
  vi.resetModules();
  return import("../lib/loginThrottle");
}

async function persistedRows() {
  return db.select().from(loginThrottleTable);
}

beforeAll(async () => {
  vi.stubEnv("LOGIN_MAX_FAILURES", String(MAX_FAILURES));
  vi.stubEnv("LOGIN_LOCKOUT_MS", String(LOCKOUT_MS));
  throttle = await reimportThrottle();
});

afterAll(async () => {
  throttle.resetLoginThrottle();
  await throttle.flushLoginThrottle();
  vi.unstubAllEnvs();
  vi.resetModules();
});

beforeEach(async () => {
  throttle.resetLoginThrottle();
  await throttle.flushLoginThrottle();
});

describe("login throttle persistence", () => {
  it("writes failure counters and lockouts through to the database", async () => {
    const now = Date.now();
    for (let i = 0; i < MAX_FAILURES; i++) throttle.recordFailure("persist-user", IP, now);
    await throttle.flushLoginThrottle();

    const rows = await persistedRows();
    const userRow = rows.find((r) => r.key === "user:persist-user");
    const ipRow = rows.find((r) => r.key === `ip:${IP}`);
    expect(userRow?.failures).toBe(MAX_FAILURES);
    expect(userRow?.lockedUntil).toBe(now + LOCKOUT_MS);
    expect(ipRow?.failures).toBe(MAX_FAILURES); // below IP threshold → not locked
    expect(ipRow?.lockedUntil).toBeNull();
  });

  it("an active lockout survives a restart (fresh module + hydration)", async () => {
    const now = Date.now();
    for (let i = 0; i < MAX_FAILURES; i++) throttle.recordFailure("restart-user", IP, now);
    expect(throttle.isLockedOut("restart-user", IP, now).locked).toBe(true);
    await throttle.flushLoginThrottle();

    // "Restart"
    throttle = await reimportThrottle();
    await throttle.loginThrottleReady;

    const lock = throttle.isLockedOut("restart-user", IP, now + 1000);
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterMs).toBeGreaterThan(0);
  });

  it("sub-threshold failure counts survive a restart too", async () => {
    throttle.recordFailure("counter-user", IP);
    throttle.recordFailure("counter-user", IP);
    await throttle.flushLoginThrottle();

    throttle = await reimportThrottle();
    await throttle.loginThrottleReady;

    expect(throttle.remainingAttempts("counter-user")).toBe(MAX_FAILURES - 2);
    // One more failure locks — the persisted count carried over.
    throttle.recordFailure("counter-user", IP);
    expect(throttle.isLockedOut("counter-user", IP).locked).toBe(true);
  });

  it("failure→success races cannot resurrect state after restart (per-key ordering)", async () => {
    // Enqueue upserts and the success-delete back-to-back WITHOUT awaiting,
    // so they would race on separate pool connections if unserialized.
    throttle.recordFailure("race-user", IP);
    throttle.recordFailure("race-user", IP);
    throttle.recordSuccess("race-user", IP);
    await throttle.flushLoginThrottle();

    expect((await persistedRows()).filter((r) => r.key.includes("race-user"))).toHaveLength(0);

    throttle = await reimportThrottle();
    await throttle.loginThrottleReady;
    expect(throttle.remainingAttempts("race-user")).toBe(MAX_FAILURES);
  });

  it("rapid consecutive failures persist the final (highest) count", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) throttle.recordFailure("rapid-user", IP);
    await throttle.flushLoginThrottle();
    const row = (await persistedRows()).find((r) => r.key === "user:rapid-user");
    expect(row?.failures).toBe(MAX_FAILURES - 1);
  });

  it("expired lockout rows are pruned during hydration, not loaded", async () => {
    const past = Date.now() - LOCKOUT_MS * 2;
    for (let i = 0; i < MAX_FAILURES; i++) throttle.recordFailure("expired-user", IP, past);
    await throttle.flushLoginThrottle();

    throttle = await reimportThrottle();
    await throttle.loginThrottleReady;
    await throttle.flushLoginThrottle();

    expect(throttle.isLockedOut("expired-user", IP).locked).toBe(false);
    expect((await persistedRows()).find((r) => r.key === "user:expired-user")).toBeUndefined();
  });
});
