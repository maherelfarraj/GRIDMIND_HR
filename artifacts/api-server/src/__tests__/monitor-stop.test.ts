/**
 * Unit tests for the stop() contract of every background monitor/scheduler.
 *
 * Each stop function must:
 *   1. Clear the timer immediately (no new sweep starts after stop()).
 *   2. Await any sweep that is currently in flight before resolving.
 *   3. Resolve even when the in-flight sweep throws.
 *
 * Tests use injectable sweepFn parameters so no real DB connections are made.
 * Fake timers let the tests trigger setInterval-based sweeps synchronously.
 * The bounded-timeout path of stopBackgroundMonitors (in index.ts) is covered
 * by the spawned-server tests in shutdown-drain.test.ts.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  startHealthMonitor,
  stopHealthMonitor,
} from "../lib/health-monitor.js";
import {
  startGatewaySilenceMonitor,
  stopGatewaySilenceMonitor,
} from "../lib/gatewayDeviceAlerts.js";
import {
  startBackupScheduler,
  stopBackupScheduler,
  _triggerBackupCycleForTest,
} from "../lib/backupScheduler.js";
import {
  startPrivilegedSessionSweeper,
  stopPrivilegedSessionSweeper,
} from "../lib/privilegedSessionSweeper.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deferred promise: lets a test control exactly when a simulated sweep resolves. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Returns true if the given promise has already settled.
 * Flushes one microtask turn so that .then/.finally handlers that ran
 * synchronously after the last await have a chance to advance the chain.
 */
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(() => { settled = true; }).catch(() => { settled = true; });
  await Promise.resolve(); // one microtask turn
  return settled;
}

// ---------------------------------------------------------------------------
// Health monitor (setInterval, no immediate sweep)
// ---------------------------------------------------------------------------

describe("stopHealthMonitor", () => {
  afterEach(async () => {
    // Ensure the module is left clean even if a test fails mid-way.
    vi.useRealTimers();
    await stopHealthMonitor();
  });

  it("resolves immediately when no sweep is in progress", async () => {
    vi.useFakeTimers();
    const d = deferred();
    startHealthMonitor(() => d.promise); // interval won't fire — timers frozen
    await expect(stopHealthMonitor()).resolves.toBeUndefined();
    d.resolve(); // satisfy the deferred so there are no dangling promises
  });

  it("awaits an in-flight sweep before resolving", async () => {
    vi.useFakeTimers();
    const d = deferred();
    startHealthMonitor(() => d.promise);

    // Trigger the interval to start a sweep.
    vi.advanceTimersByTime(60_001);
    // inFlightSweep is now set (synchronously by the interval callback).

    const stopPromise = stopHealthMonitor();

    // Not yet settled — the sweep is still pending.
    expect(await isSettled(stopPromise)).toBe(false);

    // Resolve the sweep; stop() must settle shortly after.
    d.resolve();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("resolves even when the in-flight sweep throws", async () => {
    vi.useFakeTimers();
    const d = deferred();
    startHealthMonitor(() => d.promise);
    vi.advanceTimersByTime(60_001);

    const stopPromise = stopHealthMonitor();
    d.reject(new Error("sweep DB failure"));
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("no new sweep starts after stop() is called", async () => {
    vi.useFakeTimers();
    let calls = 0;
    startHealthMonitor(async () => { calls++; });

    await stopHealthMonitor();
    const callsAfterStop = calls;

    // Advance well past several interval periods — the cleared timer must
    // not fire any new callbacks.
    vi.advanceTimersByTime(300_000);
    await Promise.resolve();
    expect(calls).toBe(callsAfterStop);
  });
});

// ---------------------------------------------------------------------------
// Gateway silence monitor (setInterval, no immediate sweep)
// ---------------------------------------------------------------------------

describe("stopGatewaySilenceMonitor", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await stopGatewaySilenceMonitor();
  });

  it("resolves immediately when no sweep is in progress", async () => {
    vi.useFakeTimers();
    const d = deferred();
    startGatewaySilenceMonitor(() => d.promise);
    await expect(stopGatewaySilenceMonitor()).resolves.toBeUndefined();
    d.resolve();
  });

  it("awaits an in-flight sweep before resolving", async () => {
    vi.useFakeTimers();
    const d = deferred();
    startGatewaySilenceMonitor(() => d.promise);
    vi.advanceTimersByTime(60_001);

    const stopPromise = stopGatewaySilenceMonitor();
    expect(await isSettled(stopPromise)).toBe(false);

    d.resolve();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("resolves even when the in-flight sweep throws", async () => {
    vi.useFakeTimers();
    const d = deferred();
    startGatewaySilenceMonitor(() => d.promise);
    vi.advanceTimersByTime(60_001);

    const stopPromise = stopGatewaySilenceMonitor();
    d.reject(new Error("gateway DB error"));
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("no new sweep starts after stop() is called", async () => {
    vi.useFakeTimers();
    let calls = 0;
    startGatewaySilenceMonitor(async () => { calls++; });

    await stopGatewaySilenceMonitor();
    const callsAfterStop = calls;

    vi.advanceTimersByTime(300_000);
    await Promise.resolve();
    expect(calls).toBe(callsAfterStop);
  });
});

// ---------------------------------------------------------------------------
// Backup scheduler (node-cron — never fires on a real schedule during tests)
// ---------------------------------------------------------------------------

describe("stopBackupScheduler", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await stopBackupScheduler();
  });

  it("resolves immediately when no cycle is in progress", async () => {
    // The cron task is scheduled but will never fire on the real schedule.
    startBackupScheduler();
    await expect(stopBackupScheduler()).resolves.toBeUndefined();
  });

  it("awaits an in-flight backup cycle before resolving", async () => {
    const d = deferred();
    startBackupScheduler();

    // Simulate the cron callback firing with a slow, injectable cycle.
    _triggerBackupCycleForTest(() => d.promise);

    const stopPromise = stopBackupScheduler();
    expect(await isSettled(stopPromise)).toBe(false);

    d.resolve();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("resolves even when the in-flight cycle throws", async () => {
    const d = deferred();
    startBackupScheduler();
    _triggerBackupCycleForTest(() => d.promise);

    const stopPromise = stopBackupScheduler();
    d.reject(new Error("pg_dump failed"));
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("a second triggered cycle is ignored while one is already in flight", async () => {
    const d1 = deferred();
    let calls = 0;
    startBackupScheduler();
    _triggerBackupCycleForTest(async () => { calls++; await d1.promise; });

    // A second trigger while the first is running must be a no-op.
    _triggerBackupCycleForTest(async () => { calls++; });
    d1.resolve();
    await stopBackupScheduler();
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Privileged-session sweeper (setInterval + immediate sweep on start)
// ---------------------------------------------------------------------------

describe("stopPrivilegedSessionSweeper", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await stopPrivilegedSessionSweeper();
  });

  it("resolves immediately once the startup sweep finishes and no interval sweep is running", async () => {
    // Start with an immediately-resolving sweep so the startup sweep is done.
    startPrivilegedSessionSweeper(async () => {});
    // Give the startup sweep's microtasks a turn to settle.
    await Promise.resolve();
    await Promise.resolve();
    await expect(stopPrivilegedSessionSweeper()).resolves.toBeUndefined();
  });

  it("awaits the in-flight startup sweep before resolving", async () => {
    const d = deferred();
    startPrivilegedSessionSweeper(() => d.promise);
    // The startup sweep fires immediately (synchronously); inFlightSweep is set.

    const stopPromise = stopPrivilegedSessionSweeper();

    // Not yet settled — the startup sweep is still pending.
    expect(await isSettled(stopPromise)).toBe(false);

    d.resolve();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("awaits an in-flight interval sweep before resolving", async () => {
    vi.useFakeTimers();
    // Use a deferred so the startup sweep resolves quickly, then control
    // the interval sweep separately.
    const dStart = deferred();
    dStart.resolve(); // startup sweep is instant
    const dInterval = deferred();
    let callCount = 0;
    startPrivilegedSessionSweeper(async () => {
      callCount++;
      if (callCount === 1) {
        await dStart.promise; // startup: instant
      } else {
        await dInterval.promise; // interval: slow
      }
    });

    // Wait for the startup sweep to finish.
    await Promise.resolve();
    await Promise.resolve();

    // Trigger the interval sweep.
    vi.advanceTimersByTime(60_001);

    const stopPromise = stopPrivilegedSessionSweeper();
    expect(await isSettled(stopPromise)).toBe(false);

    dInterval.resolve();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("resolves even when the in-flight sweep throws", async () => {
    const d = deferred();
    startPrivilegedSessionSweeper(() => d.promise);

    const stopPromise = stopPrivilegedSessionSweeper();
    d.reject(new Error("session DB write failed"));
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("no new interval sweep starts after stop() is called", async () => {
    vi.useFakeTimers();
    let calls = 0;
    // Start with immediate-resolving sweep so we can stop cleanly.
    startPrivilegedSessionSweeper(async () => { calls++; });

    // Allow the startup sweep to settle.
    await Promise.resolve();
    await Promise.resolve();

    await stopPrivilegedSessionSweeper();
    const callsAtStop = calls; // should be 1 (startup sweep)

    // Advance past several interval periods — no new sweeps must fire.
    vi.advanceTimersByTime(300_000);
    await Promise.resolve();
    expect(calls).toBe(callsAtStop);
  });
});
