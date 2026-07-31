/**
 * Device clock-skew enforcement (runbook validation checklist item 1, made
 * continuous): skew > warn threshold → structured warning + flagged
 * heartbeat; skew > hard limit → poll() blocked with an explicit error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GatewayService } from "../service.js";
import { EncryptedQueue } from "../queue.js";
import type { AdapterTestResult, DeviceAdapter, GatewayPunch } from "../types.js";
import type { HrClient } from "../hrClient.js";

class SkewAdapter implements DeviceAdapter {
  readonly type = "ZKTECO_NATIVE" as const;
  pollCount = 0;
  constructor(private readonly skewMs: number | undefined) {}
  async testConnection(): Promise<AdapterTestResult> {
    return {
      ok: true,
      status: "REACHABLE",
      message: "device reachable",
      deviceTimeMs: Date.now() + (this.skewMs ?? 0),
      ...(this.skewMs === undefined ? {} : { clockSkewMs: Math.abs(this.skewMs) }),
    };
  }
  async poll(_since: string | null) {
    this.pollCount++;
    const punches: GatewayPunch[] = [];
    return { punches, nextCursor: null };
  }
}

async function makeService(adapter: DeviceAdapter, hr: HrClient, opts?: ConstructorParameters<typeof GatewayService>[3]) {
  const dir = mkdtempSync(join(tmpdir(), "gw-skew-"));
  const queue = new EncryptedQueue(join(dir, "q"), "test-key");
  await queue.init();
  const svc = new GatewayService(queue, hr, adapter, opts);
  await svc.init();
  return svc;
}

function mockHr() {
  const calls: unknown[] = [];
  return {
    calls,
    hr: {
      heartbeat: async (t: unknown) => { calls.push(t); return { status: 200, body: {} }; },
    } as unknown as HrClient,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("device clock-skew enforcement", () => {
  it("skew under the warn threshold: polls normally, no warning, clean heartbeat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new SkewAdapter(10_000);
    const { hr, calls } = mockHr();
    const svc = await makeService(adapter, hr);
    const { pollError } = await svc.tick();
    expect(pollError).toBeNull();
    expect(adapter.pollCount).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect((calls[0] as AdapterTestResult).message).toBe("device reachable");
    expect(svc.lastClockSkewMs).toBe(10_000);
  });

  it("skew over the warn threshold: structured warning logged, heartbeat flagged, poll still runs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new SkewAdapter(120_000); // 2 min: warn but under 5-min hard limit
    const { hr, calls } = mockHr();
    const svc = await makeService(adapter, hr);
    const { pollError } = await svc.tick();
    expect(pollError).toBeNull();
    expect(adapter.pollCount).toBe(1);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warn.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.event).toBe("device_clock_skew");
    expect(logged.clockSkewMs).toBe(120_000);
    expect(logged.pollBlocked).toBe(false);

    const hb = calls[0] as AdapterTestResult;
    expect(hb.clockSkewMs).toBe(120_000);
    expect(hb.message).toMatch(/clock skew 120000ms exceeds warning threshold/);
  });

  it("skew over the hard limit: poll blocked with explicit error, heartbeat says BLOCKED", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new SkewAdapter(400_000); // > 5 min
    const { hr, calls } = mockHr();
    const svc = await makeService(adapter, hr);
    const { pollError } = await svc.tick();
    expect(adapter.pollCount).toBe(0); // poll never reached the device
    expect(pollError).toMatch(/clock skew 400000ms exceeds hard limit 300000ms/i);
    expect(pollError).toMatch(/BLOCKED/);

    const logged = JSON.parse(warn.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.pollBlocked).toBe(true);

    const hb = calls[0] as AdapterTestResult;
    expect(hb.message).toMatch(/BLOCKED/);

    // direct pollOnce() is also refused while blocked
    await expect(svc.pollOnce()).rejects.toThrow(/clock skew/i);
  });

  it("recovers automatically once the device clock is fixed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let skew = 400_000;
    const adapter: DeviceAdapter = {
      type: "ZKTECO_NATIVE",
      testConnection: async () => ({ ok: true, status: "REACHABLE", message: "ok", clockSkewMs: skew }),
      poll: async () => ({ punches: [], nextCursor: null }),
    };
    const pollSpy = vi.spyOn(adapter, "poll");
    const { hr } = mockHr();
    const svc = await makeService(adapter, hr);

    expect((await svc.tick()).pollError).toMatch(/clock skew/i);
    expect(pollSpy).not.toHaveBeenCalled();

    skew = 5_000; // operator fixed the clock
    expect((await svc.tick()).pollError).toBeNull();
    expect(pollSpy).toHaveBeenCalledTimes(1);
  });

  it("respects custom thresholds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new SkewAdapter(20_000);
    const { hr } = mockHr();
    const svc = await makeService(adapter, hr, { clockSkewWarnMs: 5_000, clockSkewMaxMs: 15_000 });
    const { pollError } = await svc.tick();
    expect(pollError).toMatch(/hard limit 15000ms/);
    expect(adapter.pollCount).toBe(0);
  });

  it("clamps a hard limit configured below the warn threshold up to the warn threshold", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new SkewAdapter(0);
    const { hr } = mockHr();
    const svc = await makeService(adapter, hr, { clockSkewWarnMs: 120_000, clockSkewMaxMs: 60_000 });
    expect(svc.clockSkewMaxMs).toBe(120_000);
  });

  it("unknown skew (adapter without clockSkewMs) never blocks polling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new SkewAdapter(undefined);
    const { hr } = mockHr();
    const svc = await makeService(adapter, hr);
    const { pollError } = await svc.tick();
    expect(pollError).toBeNull();
    expect(adapter.pollCount).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect(svc.lastClockSkewMs).toBeNull();
  });
});
