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
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-7" });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Lobby/);
    expect(calls).toHaveLength(1);
  });

  it("maps a vendor failure status to a failed ack", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [{ id: 7, sn: "SN-7" }] }) },
      { match: (u) => u.endsWith("/reboot/"), respond: () => new Response("boom", { status: 500 }) },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-7" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/500/);
  });

  it("fails with guidance when unconfigured", async () => {
    const res = await new ZktecoAdapter().restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not configured/i);
  });

  it("reboots the terminal matching the requested serial on a multi-terminal server", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      {
        match: (u) => u.includes("/iclock/api/terminals/") && u.includes("page_size"),
        respond: () => json({ data: [{ id: 7, sn: "SN-7", alias: "Lobby" }, { id: 9, sn: "SN-9", alias: "Warehouse" }] }),
      },
      {
        match: (u, init) => /\/iclock\/api\/terminals\/\d+\/reboot\/$/.test(u) && init?.method === "POST",
        respond: (u) => { calls.push(u); return json({ ok: true }); },
      },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-9" });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Warehouse/);
    expect(calls).toEqual(["http://biotime.local:8000/iclock/api/terminals/9/reboot/"]);
  });

  it("never lets an alias equal to another device's serial redirect the reboot", async () => {
    // Terminal 7's mutable alias collides with terminal 9's serial: only the
    // canonical sn match may win.
    const calls: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [{ id: 7, sn: "SN-7", alias: "SN-9" }, { id: 9, sn: "SN-9", alias: "Warehouse" }] }) },
      { match: (u, init) => /\/iclock\/api\/terminals\/\d+\/reboot\/$/.test(u) && init?.method === "POST", respond: (u) => { calls.push(u); return json({ ok: true }); } },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-9" });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["http://biotime.local:8000/iclock/api/terminals/9/reboot/"]);
  });

  it("fails without rebooting anything when the identified terminal is not registered", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [{ id: 7, sn: "SN-7", alias: "Lobby" }] }) },
      { match: (u) => u.endsWith("/reboot/"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-MISSING" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/SN-MISSING.*not registered/i);
    expect(rebooted).toHaveLength(0);
  });

  it("refuses to reboot when the serial matches several terminals (duplicate sn)", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [{ id: 7, sn: "SN-7", alias: "Lobby" }, { id: 9, sn: "SN-7", alias: "Annex" }] }) },
      { match: (u) => u.endsWith("/reboot/"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-7" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/matches 2 terminals/i);
    expect(rebooted).toHaveLength(0);
  });

  it("refuses to reboot when a duplicate identifier lives on a later terminal page", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      {
        match: (u) => u.includes("page_size") && !u.includes("page=2"),
        respond: () => json({ data: [{ id: 7, sn: "SN-7", alias: "Lobby" }], next: "http://biotime.local:8000/iclock/api/terminals/?page_size=100&page=2" }),
      },
      { match: (u) => u.includes("page=2"), respond: () => json({ data: [{ id: 9, sn: "SN-7", alias: "Annex" }], next: null }) },
      { match: (u) => u.endsWith("/reboot/"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-7" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/matches 2 terminals/i);
    expect(rebooted).toHaveLength(0);
  });

  it("fails closed when the restart command carries no serial", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      { match: (u) => u.includes("page_size"), respond: () => json({ data: [{ id: 7, sn: "SN-7" }, { id: 9, sn: "SN-9" }] }) },
      { match: (u) => u.endsWith("/reboot/"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new ZktecoAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/did not identify/i);
    expect(rebooted).toHaveLength(0);
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
        match: (u, init) => u.includes("/api/devices?") && init?.method === "GET",
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
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "541" });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Front Door/);
    expect(calls).toHaveLength(1);
  });

  it("maps a vendor failure status to a failed ack", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?"), respond: () => json({ DeviceCollection: { rows: [{ id: 2 }] } }) },
      { match: (u) => u.endsWith("/reboot"), respond: () => new Response("err", { status: 503 }) },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "2" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/503/);
  });

  it("reboots the device matching the requested serial on a multi-device server", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      {
        match: (u, init) => u.includes("/api/devices?") && init?.method === "GET",
        respond: () => json({ DeviceCollection: { rows: [{ id: 541, name: "Front Door" }, { id: 542, name: "Back Gate" }] } }),
      },
      {
        match: (u, init) => /\/api\/devices\/\d+\/reboot$/.test(u) && init?.method === "POST",
        respond: (u) => { calls.push(u); return json({ ok: true }); },
      },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "542" });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Back Gate/);
    expect(calls).toEqual(["https://biostar.local/api/devices/542/reboot"]);
  });

  it("never lets a display name equal to another device's serial redirect the reboot", async () => {
    // Device 541's mutable name collides with device 999's id/serial: only
    // the canonical id match may win.
    const calls: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?"), respond: () => json({ DeviceCollection: { rows: [{ id: 541, name: "999" }, { id: 999, name: "Annex" }] } }) },
      { match: (u, init) => /\/api\/devices\/\d+\/reboot$/.test(u) && init?.method === "POST", respond: (u) => { calls.push(u); return json({ ok: true }); } },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "999" });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["https://biostar.local/api/devices/999/reboot"]);
  });

  it("matches by middleware device id when the identifier is numeric", async () => {
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?"), respond: () => json({ DeviceCollection: { rows: [{ id: 541, name: "Front Door" }, { id: 542, name: "Back Gate" }] } }) },
      { match: (u) => u.endsWith("/api/devices/541/reboot"), respond: () => json({ ok: true }) },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "541" });
    expect(res.ok).toBe(true);
  });

  it("fails without rebooting anything when the identified device is not registered", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?"), respond: () => json({ DeviceCollection: { rows: [{ id: 541, name: "Front Door" }] } }) },
      { match: (u) => u.endsWith("/reboot"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "SN-MISSING" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/SN-MISSING.*not registered/i);
    expect(rebooted).toHaveLength(0);
  });

  it("refuses to reboot when the serial matches several devices (duplicate id rows)", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?"), respond: () => json({ DeviceCollection: { rows: [{ id: 541, name: "Gate A" }, { id: 541, name: "Gate B" }] } }) },
      { match: (u) => u.endsWith("/reboot"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "541" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/matches 2 devices/i);
    expect(rebooted).toHaveLength(0);
  });

  it("refuses to reboot when a duplicate serial lives on a later device page", async () => {
    const rebooted: string[] = [];
    // Full first page (100 rows, first row id 999) forces the adapter to
    // fetch offset=100, where the duplicate id 999 lives.
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: i === 0 ? 999 : i + 1, name: `Dev-${i}` }));
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?") && u.includes("offset=0"), respond: () => json({ DeviceCollection: { rows: firstPage } }) },
      { match: (u) => u.includes("/api/devices?") && u.includes("offset=100"), respond: () => json({ DeviceCollection: { rows: [{ id: 999, name: "Gate" }] } }) },
      { match: (u) => u.endsWith("/reboot"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice({ serial: "999" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/matches 2 devices/i);
    expect(rebooted).toHaveLength(0);
  });

  it("fails closed when the restart command carries no serial", async () => {
    const rebooted: string[] = [];
    const fetchImpl = mockFetch([
      { match: (u) => u.endsWith("/api/login"), respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "s" } }) },
      { match: (u) => u.includes("/api/devices?"), respond: () => json({ DeviceCollection: { rows: [{ id: 541 }, { id: 542 }] } }) },
      { match: (u) => u.endsWith("/reboot"), respond: (u) => { rebooted.push(u); return json({ ok: true }); } },
    ]);
    const res = await new SupremaAdapter(cfg, fetchImpl).restartDevice();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/did not identify/i);
    expect(rebooted).toHaveLength(0);
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
