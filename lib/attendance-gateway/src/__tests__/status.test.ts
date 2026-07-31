import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GatewayService } from "../service.js";
import { EncryptedQueue } from "../queue.js";
import type { DeviceAdapter, AdapterTestResult, AdapterSdkInfo } from "../types.js";
import type { HrClient } from "../hrClient.js";

const fakeHr = {} as unknown as HrClient;

async function makeQueue(): Promise<EncryptedQueue> {
  const dir = mkdtempSync(join(tmpdir(), "gw-status-"));
  const queue = new EncryptedQueue(join(dir, "q"), "test-key");
  await queue.init();
  return queue;
}

/** Adapter with configurable testConnection() and optional sdkInfo(). */
class FakeAdapter implements DeviceAdapter {
  readonly type = "ZKTECO_NATIVE" as const;
  constructor(
    private readonly test: AdapterTestResult,
    private readonly sdk?: AdapterSdkInfo,
  ) {
    if (sdk) this.sdkInfo = () => sdk;
  }
  sdkInfo?: () => AdapterSdkInfo;
  async testConnection(): Promise<AdapterTestResult> {
    return this.test;
  }
  async poll(): Promise<{ punches: []; nextCursor: null }> {
    return { punches: [], nextCursor: null };
  }
}

describe("GatewayService.status() — SDK presence and clock skew", () => {
  it("surfaces sdk_present/sdk_version and the full last_test_connection result", async () => {
    const adapter = new FakeAdapter(
      { ok: true, status: "REACHABLE", message: "device reachable", deviceTimeMs: Date.now() },
      { present: true, version: "2.9.1" },
    );
    const svc = new GatewayService(await makeQueue(), fakeHr, adapter);
    const s = await svc.status();

    expect(s.sdk_present).toBe(true);
    expect(s.sdk_version).toBe("2.9.1");
    expect(s.last_test_connection).toMatchObject({
      ok: true,
      status: "REACHABLE",
      requiresVendorSdk: false,
      message: "device reachable",
    });
    expect(typeof s.last_test_connection.deviceTimeMs).toBe("number");
  });

  it("computes clock_skew_ms from deviceTimeMs vs gateway wall time (small skew → no warning)", async () => {
    const adapter = new FakeAdapter({
      ok: true,
      status: "REACHABLE",
      message: "ok",
      deviceTimeMs: Date.now() + 5_000,
    });
    const svc = new GatewayService(await makeQueue(), fakeHr, adapter);
    const s = await svc.status();

    expect(s.clock_skew_ms).not.toBeNull();
    // 5s ahead, allow a little execution slack
    expect(Math.abs(s.clock_skew_ms! - 5_000)).toBeLessThan(2_000);
    expect("clock_skew_warning" in s).toBe(false);
  });

  it("includes clock_skew_warning when skew exceeds 60s (device ahead)", async () => {
    const adapter = new FakeAdapter({
      ok: true,
      status: "REACHABLE",
      message: "ok",
      deviceTimeMs: Date.now() + 120_000,
    });
    const svc = new GatewayService(await makeQueue(), fakeHr, adapter);
    const s = await svc.status();

    expect(s.clock_skew_ms!).toBeGreaterThan(60_000);
    expect((s as { clock_skew_warning?: string }).clock_skew_warning).toMatch(/skew/i);
  });

  it("includes clock_skew_warning when the device clock is far behind", async () => {
    const adapter = new FakeAdapter({
      ok: true,
      status: "REACHABLE",
      message: "ok",
      deviceTimeMs: Date.now() - 300_000,
    });
    const svc = new GatewayService(await makeQueue(), fakeHr, adapter);
    const s = await svc.status();

    expect(s.clock_skew_ms!).toBeLessThan(-60_000);
    expect((s as { clock_skew_warning?: string }).clock_skew_warning).toBeTruthy();
  });

  it("reports null skew and no warning when the adapter reports no deviceTimeMs", async () => {
    const adapter = new FakeAdapter({ ok: false, status: "UNREACHABLE", message: "down" });
    const svc = new GatewayService(await makeQueue(), fakeHr, adapter);
    const s = await svc.status();

    expect(s.last_test_connection.deviceTimeMs).toBeNull();
    expect(s.clock_skew_ms).toBeNull();
    expect("clock_skew_warning" in s).toBe(false);
  });

  it("falls back to requiresVendorSdk when the adapter has no sdkInfo()", async () => {
    const missingSdk = new FakeAdapter({
      ok: false,
      status: "NOT_CONFIGURED",
      requiresVendorSdk: true,
      message: "SDK module not found",
    });
    const s1 = await new GatewayService(await makeQueue(), fakeHr, missingSdk).status();
    expect(s1.sdk_present).toBe(false);
    expect(s1.sdk_version).toBeNull();

    const noSdkNeeded = new FakeAdapter({ ok: true, status: "REACHABLE", message: "ok" });
    const s2 = await new GatewayService(await makeQueue(), fakeHr, noSdkNeeded).status();
    expect(s2.sdk_present).toBe(true);
    expect(s2.sdk_version).toBeNull();
  });
});
