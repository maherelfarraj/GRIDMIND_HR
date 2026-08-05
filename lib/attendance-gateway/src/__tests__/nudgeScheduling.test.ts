/**
 * Scheduling behaviour for the on-demand connection-test nudge.
 *
 * Verifies via fake timers:
 *  1. Normal interval fires when testRequested=false.
 *  2. Early tick fires after nudgeIntervalMs when testRequested=true.
 *  3. No double-fire: exactly one tick fires when a nudge is active.
 *  4. No tight loop: nudgeIntervalMs is floored at MIN_NUDGE_INTERVAL_MS (5 s).
 *  5. Normal cadence resumes once testRequested clears.
 *  6. GatewayService.tick() propagates testRequested from the heartbeat body.
 *
 * NOTE: tests use vi.advanceTimersByTimeAsync() rather than
 * vi.runAllTimersAsync() because the scheduler's self-scheduling setTimeout
 * chain is intentionally infinite — runAllTimers would spin forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runScheduler, MIN_NUDGE_INTERVAL_MS } from "../scheduler.js";
import { GatewayService } from "../service.js";
import type { EncryptedQueue } from "../queue.js";
import type { HrClient } from "../hrClient.js";
import type { DeviceAdapter } from "../types.js";

// ---------------------------------------------------------------------------
// runScheduler unit tests (fake timers)
// ---------------------------------------------------------------------------

describe("runScheduler — normal cadence (no testRequested)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires the first tick immediately (setTimeout 0), then on the poll interval", async () => {
    const pollIntervalMs = 60_000;
    const nudgeIntervalMs = 10_000;

    const tick = vi.fn(async () => ({ testRequested: false }));
    const handle = runScheduler(tick, pollIntervalMs, nudgeIntervalMs);

    // First tick is scheduled with setTimeout(fn, 0) — advance past it.
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    // Just before the next regular interval — no second tick yet.
    await vi.advanceTimersByTimeAsync(pollIntervalMs - 1);
    expect(tick).toHaveBeenCalledTimes(1);

    // Past the interval — second tick fires.
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);

    handle.stop();
  });
});

describe("runScheduler — testRequested=true triggers early nudge", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires the next tick after nudgeIntervalMs, not pollIntervalMs, when testRequested=true", async () => {
    const pollIntervalMs = 60_000;
    const nudgeIntervalMs = 10_000;
    let callCount = 0;

    // First tick returns testRequested=true; subsequent return false.
    const tick = vi.fn(async () => {
      callCount++;
      return { testRequested: callCount === 1 };
    });

    const handle = runScheduler(tick, pollIntervalMs, nudgeIntervalMs);

    // First tick (immediate, testRequested=true).
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    // Advance to just before nudge — no tick yet.
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs - 1);
    expect(tick).toHaveBeenCalledTimes(1);

    // Advance past nudge — second tick fires (much sooner than pollIntervalMs).
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);

    // The second tick returned testRequested=false, so the scheduler switches
    // back to pollIntervalMs. Verify it does NOT fire again at nudgeIntervalMs.
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(2); // still 2

    // But it does fire after the full poll interval (minus the nudge we just advanced through).
    await vi.advanceTimersByTimeAsync(pollIntervalMs - nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(3);

    handle.stop();
  });

  it("no double-fire: exactly one tick fires per scheduled interval", async () => {
    const pollIntervalMs = 30_000;
    const nudgeIntervalMs = 10_000;

    const tick = vi.fn(async () => ({ testRequested: true }));
    const handle = runScheduler(tick, pollIntervalMs, nudgeIntervalMs);

    // Tick 1 (immediate).
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    // Advance exactly one nudge — exactly one more tick (not two, not zero).
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(2);

    // Another nudge — still one at a time.
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(3);

    handle.stop();
  });
});

describe("runScheduler — floor prevents tight loops", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("floors nudgeIntervalMs at MIN_NUDGE_INTERVAL_MS even when caller supplies a smaller value", async () => {
    const pollIntervalMs = 60_000;
    const tooShortNudge = 100; // ms — would be a hot loop without the floor
    const tickTimes: number[] = [];

    // Always return testRequested=true to keep nudging.
    const tick = vi.fn(async () => {
      tickTimes.push(Date.now());
      return { testRequested: true };
    });

    const handle = runScheduler(tick, pollIntervalMs, tooShortNudge);

    // Tick 1 (immediate).
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    // Advance 3 × MIN_NUDGE_INTERVAL_MS; should get exactly 3 more ticks
    // (not thousands at 100 ms cadence).
    await vi.advanceTimersByTimeAsync(3 * MIN_NUDGE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(4); // 1 immediate + 3 nudges

    // Consecutive intervals are ≥ MIN_NUDGE_INTERVAL_MS.
    for (let i = 1; i < tickTimes.length; i++) {
      expect(tickTimes[i] - tickTimes[i - 1]).toBeGreaterThanOrEqual(MIN_NUDGE_INTERVAL_MS);
    }

    handle.stop();
  });
});

describe("runScheduler — normal cadence resumes when testRequested clears", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("uses pollIntervalMs again once testRequested returns false", async () => {
    const pollIntervalMs = 60_000;
    const nudgeIntervalMs = 10_000;
    let callCount = 0;

    // Ticks 1–2: testRequested=true. Tick 3+: false.
    const tick = vi.fn(async () => {
      callCount++;
      return { testRequested: callCount <= 2 };
    });

    const handle = runScheduler(tick, pollIntervalMs, nudgeIntervalMs);

    // Tick 1 (immediate, testRequested=true).
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    // Tick 2 (nudge, testRequested=true).
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(2);

    // Tick 3 (nudge, testRequested=false — switches to poll cadence).
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(3);

    // Another nudgeIntervalMs should NOT fire (now on pollIntervalMs).
    await vi.advanceTimersByTimeAsync(nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(3);

    // Full pollIntervalMs should fire tick 4.
    await vi.advanceTimersByTimeAsync(pollIntervalMs - nudgeIntervalMs);
    expect(tick).toHaveBeenCalledTimes(4);

    handle.stop();
  });
});

describe("runScheduler — stop() prevents further ticks", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not fire after stop() is called before the first tick", async () => {
    const tick = vi.fn(async () => ({ testRequested: false }));
    const handle = runScheduler(tick, 10_000, 5_000);

    // Stop before any tick fires.
    handle.stop();

    await vi.advanceTimersByTimeAsync(100_000);
    expect(tick).toHaveBeenCalledTimes(0);
  });

  it("does not fire after stop() is called after the first tick", async () => {
    const tick = vi.fn(async () => ({ testRequested: false }));
    const handle = runScheduler(tick, 10_000, 5_000);

    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    handle.stop();

    await vi.advanceTimersByTimeAsync(100_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GatewayService.tick() propagates testRequested from heartbeat body
// ---------------------------------------------------------------------------

const fakeQueue = {
  enqueue: async () => {},
  pending: async () => [] as string[],
  read: async () => null,
  remove: async () => {},
  markAttempt: async () => null,
} as unknown as EncryptedQueue;

const fakeAdapter: DeviceAdapter = {
  type: "SIMULATOR" as const,
  testConnection: async () => ({ ok: true, status: "REACHABLE" as const, message: "ok" }),
  poll: async () => ({ punches: [], nextCursor: null }),
};

function makeHr(testRequested: boolean): HrClient {
  return {
    heartbeat: vi.fn(async () => ({
      status: 200,
      body: { ok: true, clockDriftMs: 0, driftAlert: false, testRequested },
    })),
    ackCommands: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
    uploadBatch: vi.fn(async () => ({ status: 200, body: {} })),
    reconcile: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
  } as unknown as HrClient;
}

describe("GatewayService.tick() — testRequested propagation", () => {
  it("returns testRequested=true when heartbeat body carries testRequested=true", async () => {
    const svc = new GatewayService(fakeQueue, makeHr(true), fakeAdapter);
    const result = await svc.tick();
    expect(result.testRequested).toBe(true);
  });

  it("returns testRequested=false when heartbeat body carries testRequested=false", async () => {
    const svc = new GatewayService(fakeQueue, makeHr(false), fakeAdapter);
    const result = await svc.tick();
    expect(result.testRequested).toBe(false);
  });

  it("returns testRequested=false when heartbeat body omits testRequested", async () => {
    const hr = {
      heartbeat: vi.fn(async () => ({ status: 200, body: { ok: true } })),
      ackCommands: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
      uploadBatch: vi.fn(async () => ({ status: 200, body: {} })),
      reconcile: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
    } as unknown as HrClient;
    const svc = new GatewayService(fakeQueue, hr, fakeAdapter);
    const result = await svc.tick();
    expect(result.testRequested).toBe(false);
  });

  it("returns testRequested=false (not throwing) when the heartbeat call fails", async () => {
    const hr = {
      heartbeat: vi.fn(async () => { throw new Error("network error"); }),
      ackCommands: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
      uploadBatch: vi.fn(async () => ({ status: 200, body: {} })),
      reconcile: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
    } as unknown as HrClient;
    const svc = new GatewayService(fakeQueue, hr, fakeAdapter);
    const result = await svc.tick();
    expect(result.testRequested).toBe(false);
    expect(result.heartbeatError).toBe("network error");
  });
});
