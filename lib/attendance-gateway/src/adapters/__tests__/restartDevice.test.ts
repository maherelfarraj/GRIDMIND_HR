import { describe, it, expect, vi } from "vitest";
import { ZktecoAdapter, SupremaAdapter } from "../vendorStubs.js";
import { GenericRestAdapter } from "../genericRest.js";
import { ZktecoNativeAdapter, type ZkClientLike } from "../zktecoNative.js";
import { SupremaNativeAdapter, type SupremaDeviceSDK } from "../supremaNative.js";

function mockFetch(routes: Array<{ match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Response }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url, init));
    if (!route) return new Response("not found", { status: 404 });
    return route.respond(url, init);
  }) as typeof fetch;
}

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

// ─── ZKTeco (ZKBioTime middleware) ───────────────────────────────────────────

describe("ZktecoAdapter.restartDevice (ZKBioTime middleware)", () => {
  const cfg = { baseUrl: "http://biotime.local:8000", username: "gw", password: "pw" };

  it("looks up the terminal and issues its reboot action", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      {
        match: (u) => u.includes("/iclock/api/terminals/") && u.includes("page_size"),
        respond: () => json({ data: [{ id: 7, sn: "SN-7", alias: "Lobby" }] }),
      },
      {
        match: (u, init) => u.endsWith("/iclock/api/terminals/7/reboot/") && init?.method === "POST",
        respond: (u) => { calls.push(u); return json({ ok: true }); },
      },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Lobby/);
    expect(calls).toHaveLength(1);
  });

  it("maps a vendor failure status to a failed ack", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [{ id: 7 }] }) },
      { match: (u) => u.endsWith("/reboot/"), respond: () => new Response("boom", { status: 500 }) },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/500/);
  });

  it("fails with guidance when unconfigured", async () => {
    const res = await new ZktecoAdapter().restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not configured/i);
  });

  it("fails when no terminal is registered", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [] }) },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no registered terminal/i);
  });
});

// ─── Suprema (BioStar 2 server) ──────────────────────────────────────────────

describe("SupremaAdapter.restartDevice (BioStar 2 server)", () => {
  const cfg = { baseUrl: "https://biostar.local", loginId: "gw", password: "pw" };

  it("looks up the device and issues its reboot action", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch([
      {
        match: (u) => u.endsWith("/api/login"),
        respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "sess-1" } }),
      },
      {
        match: (u, init) => u.endsWith("/api/devices") && init?.method === "GET",
        respond: (_u, init) => {
          const h = init?.headers as Record<string, string>;
          if (h?.["bs-session-id"] !== "sess-1") return new Response("no", { status: 401 });
          return json({ DeviceCollection: { rows: [{ id: 541, name: "Front Door" }] } });
        },
      },
      {
        match: (u, init) => u.endsWith("/api/devices/541/reboot") && init?.method === "POST",
        respond: (u) => { calls.push(u); return json({ ok: true }); },
      },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Front Door/);
    expect(calls).toHaveLength(1);
  });

  it("maps a vendor failure status to a failed ack", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.endsWith("/api/devices"), respond: () => json({ DeviceCollection: { rows: [{ id: 2 }] } }) },
      { match: (u) => u.endsWith("/reboot"), respond: () => new Response("err", { status: 503 }) },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/503/);
  });

  it("fails with guidance when unconfigured", async () => {
    const res = await new SupremaAdapter().restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not configured/i);
  });
});

// ─── Generic REST ────────────────────────────────────────────────────────────

describe("GenericRestAdapter.restartDevice", () => {
  it("POSTs {baseUrl}/restart with auth headers", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = mockFetch([
      { match: (u, init) => u.endsWith("/restart") && init?.method === "POST", respond: (_u, init) => { seen = init; return json({ ok: true }); } },
    ]);
    const res = await new GenericRestAdapter("http://device.local", "key-1", fetchImpl).restartDevice();
    expect(res.ok).toBe(true);
    expect((seen?.headers as Record<string, string>).authorization).toBe("Bearer key-1");
  });

  it("maps non-2xx and network errors to failed acks", async () => {
    const res500 = await new GenericRestAdapter("http://device.local", undefined, mockFetch([
      { match: (u) => u.endsWith("/restart"), respond: () => new Response("no", { status: 500 }) },
    ])).restartDevice();
    expect(res500.ok).toBe(false);
    const resErr = await new GenericRestAdapter("http://device.local", undefined, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch).restartDevice();
    expect(resErr.ok).toBe(false);
    expect(resErr.message).toMatch(/ECONNREFUSED/);
  });
});

// ─── ZKTeco native (binary protocol) ─────────────────────────────────────────

describe("ZktecoNativeAdapter.restartDevice (CMD_RESTART)", () => {
  const cfg = { deviceHost: "10.0.0.5", devicePort: 4370, commKey: "0", timeoutMs: 1000 };

  function fakeClient(overrides: Partial<ZkClientLike> = {}): ZkClientLike {
    return {
      connect: vi.fn(async () => {}),
      handshake: vi.fn(async () => ({ deviceTimeMs: Date.now() })),
      getAttendances: vi.fn(async () => []),
      restart: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("connects, sends CMD_RESTART, and disconnects", async () => {
    const client = fakeClient();
    const res = await new ZktecoNativeAdapter(cfg, () => client).restartDevice();
    expect(res.ok).toBe(true);
    expect(client.restart).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it("maps connection failures to a failed ack", async () => {
    const client = fakeClient({ connect: vi.fn(async () => { throw new Error("connect timeout"); }) });
    const res = await new ZktecoNativeAdapter(cfg, () => client).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/connect timeout/);
  });

  it("fails with guidance when unconfigured", async () => {
    const res = await new ZktecoNativeAdapter().restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not configured/i);
  });
});

// ─── Suprema native (Device SDK) ─────────────────────────────────────────────

describe("SupremaNativeAdapter.restartDevice (Device SDK)", () => {
  const cfg = { deviceHost: "10.0.0.9", devicePort: 51211, adminLoginId: "admin", adminPassword: "pw" };

  function fakeSdk(overrides: Partial<SupremaDeviceSDK> = {}): SupremaDeviceSDK {
    return {
      connect: vi.fn(async () => ({ h: 1 })),
      disconnect: vi.fn(async () => {}),
      getDeviceInfo: vi.fn(async () => ({ deviceId: "dev-1", serialNumber: "SN-9" })),
      getDeviceTimeMs: vi.fn(async () => Date.now()),
      getLogEntriesSince: vi.fn(async () => []),
      reboot: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("connects, calls sdk.reboot, and disconnects", async () => {
    const sdk = fakeSdk();
    const res = await new SupremaNativeAdapter(cfg, sdk).restartDevice();
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/SN-9/);
    expect(sdk.reboot).toHaveBeenCalledTimes(1);
    expect(sdk.disconnect).toHaveBeenCalled();
  });

  it("fails clearly when the SDK binding lacks reboot()", async () => {
    const sdk = fakeSdk();
    delete (sdk as { reboot?: unknown }).reboot;
    const res = await new SupremaNativeAdapter(cfg, sdk).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/does not expose reboot/i);
  });

  it("maps SDK reboot failures to a failed ack", async () => {
    const sdk = fakeSdk({ reboot: vi.fn(async () => { throw new Error("device busy"); }) });
    const res = await new SupremaNativeAdapter(cfg, sdk).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/device busy/);
  });

  it("fails with guidance when unconfigured", async () => {
    const res = await new SupremaNativeAdapter().restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not configured/i);
  });
});
