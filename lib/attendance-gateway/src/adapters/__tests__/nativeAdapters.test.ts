/**
 * Unit tests for ZktecoNativeAdapter and SupremaNativeAdapter.
 *
 * Both adapters accept injectable dependencies (ZkClientFactory / SupremaDeviceSDK)
 * so all paths are tested without real hardware or SDK installation.
 */

import { describe, it, expect } from "vitest";
import {
  ZktecoNativeAdapter,
  zktecoNativeConfigFromEnv,
  ZK_PUNCH_STATE,
  ZK_NATIVE_META_KEYS,
  pickMeta,
  toIso,
  decodeCursor as zkDecodeCursor,
  encodeCursor as zkEncodeCursor,
  type ZkNativeCursor,
  type ZkClientFactory,
  type ZkClientLike,
} from "../zktecoNative.js";
import {
  SupremaNativeAdapter,
  supremaNativeConfigFromEnv,
  BIOSTAR_TNA_KEY,
  SUPREMA_NATIVE_META_KEYS,
  decodeCursor as supremaDecodeCursor,
  encodeCursor as supremaEncodeCursor,
  type SupremaDeviceSDK,
  type SupremaLogEntry,
} from "../supremaNative.js";
import { type ZkRawRecord } from "../zktecoProtocol.js";

// ─── ZKTeco native helpers ────────────────────────────────────────────────────

function makeZkRecord(userId: string, recordTime: Date, status = 0, userSn = 1): ZkRawRecord {
  return { deviceUserId: userId, recordTime, status, userSn, verifyType: 0 };
}

/** Build a ZkClientFactory that returns a controllable mock. */
function mockZkFactory(
  records: ZkRawRecord[],
  opts: { connectFails?: boolean; deviceTimeMs?: number } = {},
): ZkClientFactory {
  return (_clientOpts): ZkClientLike => ({
    connect: opts.connectFails
      ? () => Promise.reject(new Error("ECONNREFUSED"))
      : () => Promise.resolve(),
    handshake: () =>
      opts.connectFails
        ? Promise.reject(new Error("ECONNREFUSED"))
        : Promise.resolve({ deviceTimeMs: opts.deviceTimeMs ?? Date.now() }),
    getAttendances: () => Promise.resolve(records),
    disconnect: () => Promise.resolve(),
  });
}

const ZK_CFG = { deviceHost: "192.168.1.100", devicePort: 4370, commKey: "0", timeoutMs: 5000 };

// ─── ZktecoNativeAdapter — unconfigured ──────────────────────────────────────

describe("ZktecoNativeAdapter — unconfigured", () => {
  const adapter = new ZktecoNativeAdapter();

  it("testConnection returns ok:false / NOT_CONFIGURED", async () => {
    const r = await adapter.testConnection();
    expect(r.ok).toBe(false);
    expect(r.status).toBe("NOT_CONFIGURED");
  });

  it("poll() throws — not silently empty", async () => {
    await expect(adapter.poll(null)).rejects.toThrow(/not operational|ZKTECO_DEVICE_HOST/i);
  });

  it("adapter type is ZKTECO_NATIVE", () => {
    expect(adapter.type).toBe("ZKTECO_NATIVE");
  });
});

// ─── ZktecoNativeAdapter — mock client ───────────────────────────────────────

describe("ZktecoNativeAdapter — testConnection", () => {
  it("returns ok:true when device is reachable", async () => {
    const adapter = new ZktecoNativeAdapter(ZK_CFG, mockZkFactory([], { deviceTimeMs: Date.now() }));
    const r = await adapter.testConnection();
    expect(r.ok).toBe(true);
    expect(r.status).toBe("REACHABLE");
    expect(typeof r.deviceTimeMs).toBe("number");
  });

  it("returns UNREACHABLE when connection fails", async () => {
    const adapter = new ZktecoNativeAdapter(ZK_CFG, mockZkFactory([], { connectFails: true }));
    const r = await adapter.testConnection();
    expect(r.ok).toBe(false);
    expect(r.status).toBe("UNREACHABLE");
  });
});

describe("ZktecoNativeAdapter — poll with mock client", () => {
  it("returns no punches on empty log", async () => {
    const adapter = new ZktecoNativeAdapter(ZK_CFG, mockZkFactory([]));
    const { punches, nextCursor } = await adapter.poll(null);
    expect(punches).toHaveLength(0);
    expect(nextCursor).toBeNull();
  });

  it("maps records to GatewayPunch with correct event types from status byte", async () => {
    const t = new Date("2024-03-15T09:00:00.000Z");
    const records = [
      makeZkRecord("EMP001", t, 0), // CLOCK_IN
      makeZkRecord("EMP002", t, 1), // CLOCK_OUT
      makeZkRecord("EMP003", t, 4), // OVERTIME_START
    ];
    const adapter = new ZktecoNativeAdapter(ZK_CFG, mockZkFactory(records));
    const { punches } = await adapter.poll(null);
    expect(punches).toHaveLength(3);
    expect(punches[0].eventType).toBe("CLOCK_IN");
    expect(punches[1].eventType).toBe("CLOCK_OUT");
    expect(punches[2].eventType).toBe("OVERTIME_START");
  });

  it("defaults unknown status codes to CLOCK_IN", async () => {
    const t = new Date("2024-03-15T09:00:00.000Z");
    const adapter = new ZktecoNativeAdapter(ZK_CFG, mockZkFactory([makeZkRecord("EMP001", t, 99)]));
    const { punches } = await adapter.poll(null);
    expect(punches).toHaveLength(1);
    expect(punches[0].eventType).toBe("CLOCK_IN");
  });

  it("sets a stable deviceEventUid across polls", async () => {
    const t = new Date("2024-03-15T09:00:00.000Z");
    const factory = mockZkFactory([makeZkRecord("EMP001", t)]);
    const { punches: p1 } = await new ZktecoNativeAdapter(ZK_CFG, factory).poll(null);
    const { punches: p2 } = await new ZktecoNativeAdapter(ZK_CFG, factory).poll(null);
    expect(p1[0].deviceEventUid).toBe(p2[0].deviceEventUid);
  });

  it("advances cursor and suppresses already-processed records", async () => {
    const t1 = new Date("2024-03-15T09:00:00.000Z");
    const t2 = new Date("2024-03-15T10:00:00.000Z");
    const factory = mockZkFactory([makeZkRecord("EMP001", t1), makeZkRecord("EMP002", t2)]);
    const adapter = new ZktecoNativeAdapter(ZK_CFG, factory);

    const { punches: first, nextCursor } = await adapter.poll(null);
    expect(first).toHaveLength(2);

    const { punches: second } = await new ZktecoNativeAdapter(ZK_CFG, factory).poll(nextCursor);
    expect(second).toHaveLength(0);
  });

  it("same-second double-punch (different users): both events arrive", async () => {
    const t = new Date("2024-03-15T09:00:00.000Z");
    const records = [makeZkRecord("EMP001", t, 0, 1), makeZkRecord("EMP002", t, 0, 2)];
    const factory = mockZkFactory(records);
    const adapter = new ZktecoNativeAdapter(ZK_CFG, factory);

    const { punches, nextCursor } = await adapter.poll(null);
    expect(punches).toHaveLength(2);

    const { punches: again } = await new ZktecoNativeAdapter(ZK_CFG, factory).poll(nextCursor);
    expect(again).toHaveLength(0);
  });

  it("same-second double-punch (SAME user): both events arrive with distinct UIDs", async () => {
    const t = new Date("2024-03-15T09:00:00.000Z");
    const records = [makeZkRecord("EMP001", t, 0, 1), makeZkRecord("EMP001", t, 1, 2)];
    const factory = mockZkFactory(records);
    const adapter = new ZktecoNativeAdapter(ZK_CFG, factory);

    const { punches, nextCursor } = await adapter.poll(null);
    expect(punches).toHaveLength(2);
    expect(punches[0].deviceEventUid).not.toBe(punches[1].deviceEventUid);

    const { punches: again } = await new ZktecoNativeAdapter(ZK_CFG, factory).poll(nextCursor);
    expect(again).toHaveLength(0);
  });

  it("skips records strictly older than the cursor watermark", async () => {
    const old   = new Date("2024-01-01T00:00:00.000Z");
    const fresh = new Date("2024-03-15T09:00:00.000Z");
    const newer = new Date("2024-03-16T08:00:00.000Z");
    const factory1 = mockZkFactory([makeZkRecord("EMP001", old), makeZkRecord("EMP002", fresh)]);
    const { nextCursor } = await new ZktecoNativeAdapter(ZK_CFG, factory1).poll(null);

    const factory2 = mockZkFactory([makeZkRecord("EMP001", old), makeZkRecord("EMP002", fresh), makeZkRecord("EMP003", newer)]);
    const { punches } = await new ZktecoNativeAdapter(ZK_CFG, factory2).poll(nextCursor);
    expect(punches).toHaveLength(1);
    expect(punches[0].deviceUserId).toBe("EMP003");
  });

  it("raw metadata includes verifyType and status but excludes biometric fields", async () => {
    const t = new Date("2024-03-15T09:00:00.000Z");
    const adapter = new ZktecoNativeAdapter(ZK_CFG, mockZkFactory([makeZkRecord("EMP001", t, 1)]));
    const { punches } = await adapter.poll(null);
    const raw = punches[0].raw ?? {};
    expect(raw).not.toHaveProperty("fingerprint_template");
    expect(raw).not.toHaveProperty("face_image");
    expect(raw).toHaveProperty("deviceUserId", "EMP001");
    expect(raw).toHaveProperty("status", 1);
    expect(raw).toHaveProperty("verifyType", 0);
  });
});

// ─── zktecoNativeConfigFromEnv ────────────────────────────────────────────────

describe("zktecoNativeConfigFromEnv", () => {
  it("returns undefined when ZKTECO_DEVICE_HOST is absent", () => {
    expect(zktecoNativeConfigFromEnv({})).toBeUndefined();
  });

  it("parses env vars with defaults", () => {
    const cfg = zktecoNativeConfigFromEnv({ ZKTECO_DEVICE_HOST: "10.0.0.1", ZKTECO_COMM_KEY: "12345" });
    expect(cfg).toEqual({ deviceHost: "10.0.0.1", devicePort: 4370, commKey: "12345", timeoutMs: 5000 });
  });

  it("parses custom port and timeout", () => {
    const cfg = zktecoNativeConfigFromEnv({ ZKTECO_DEVICE_HOST: "10.0.0.2", ZKTECO_DEVICE_PORT: "9999", ZKTECO_TIMEOUT_MS: "10000" });
    expect(cfg?.devicePort).toBe(9999);
    expect(cfg?.timeoutMs).toBe(10000);
  });
});

// ─── ZKTeco cursor ────────────────────────────────────────────────────────────

describe("ZKTeco native cursor", () => {
  it("decodeCursor returns {t:null, ids:[]} for null", () => {
    expect(zkDecodeCursor(null)).toEqual({ t: null, ids: [] });
  });

  it("decodeCursor returns {t:cursor, ids:[]} for legacy plain-ISO string", () => {
    const r = zkDecodeCursor("2024-01-01T00:00:00.000Z");
    expect(r.t).toBe("2024-01-01T00:00:00.000Z");
    expect(r.ids).toEqual([]);
  });

  it("round-trips a full cursor", () => {
    const token: ZkNativeCursor = { t: "2024-03-15T09:00:00.000Z", ids: ["uid-1", "uid-2"] };
    const encoded = zkEncodeCursor(token);
    const decoded = zkDecodeCursor(encoded!);
    expect(decoded).toEqual(token);
  });

  it("encodeCursor returns null when t is null", () => {
    expect(zkEncodeCursor({ t: null, ids: [] })).toBeNull();
  });
});

// ─── ZKTeco punch-state mapping ───────────────────────────────────────────────

describe("ZK_PUNCH_STATE mapping", () => {
  it("maps all six standard punch codes", () => {
    expect(ZK_PUNCH_STATE[0]).toBe("CLOCK_IN");
    expect(ZK_PUNCH_STATE[1]).toBe("CLOCK_OUT");
    expect(ZK_PUNCH_STATE[2]).toBe("BREAK_START");
    expect(ZK_PUNCH_STATE[3]).toBe("BREAK_END");
    expect(ZK_PUNCH_STATE[4]).toBe("OVERTIME_START");
    expect(ZK_PUNCH_STATE[5]).toBe("OVERTIME_END");
  });

  it("ZK_NATIVE_META_KEYS excludes biometric field names", () => {
    const bio = ["template", "fingerprint", "face_image", "card_raw", "bio_data", "minutiae"];
    for (const k of bio) expect(ZK_NATIVE_META_KEYS).not.toContain(k);
  });
});

// ─── ZKTeco protocol helpers ──────────────────────────────────────────────────

describe("ZkTcpClient — protocol helpers (via zktecoProtocol module)", async () => {
  const { parseZkTime } = await import("../zktecoProtocol.js");

  it("parseZkTime decodes a ZKTeco epoch timestamp to a Date", () => {
    // 2024-03-15 09:00:00 in ZKTeco encoding:
    // second=0 + minute=0*60 + hour=9*3600 + (day-1=14)*86400 + month=2*86400*31 + year=24*86400*31*12
    const year=24, month=2, day=15, hour=9, minute=0, second=0;
    const encoded = second + minute*60 + hour*3600 + (day-1)*86400 + month*86400*31 + year*86400*31*12;
    const d = parseZkTime(encoded);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2); // 0-indexed March
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
  });
});

// ─── Suprema native helpers ───────────────────────────────────────────────────

function makeLogEntry(id: number, userId: string, tnaKey: number, datetime: string): SupremaLogEntry {
  return { id, userId, tnaKey, datetime };
}

function mockSupremaSDK(entries: SupremaLogEntry[], deviceId = "DEV-001", opts: { connectFails?: boolean; deviceTimeMs?: number } = {}): SupremaDeviceSDK {
  return {
    connect: opts.connectFails
      ? () => Promise.reject(new Error("Device unreachable"))
      : () => Promise.resolve("handle"),
    disconnect: () => Promise.resolve(),
    getDeviceInfo: () => Promise.resolve({ deviceId, serialNumber: deviceId }),
    getDeviceTimeMs: () => Promise.resolve(opts.deviceTimeMs ?? Date.now()),
    getLogEntriesSince: (_handle: unknown, sinceId: number, limit: number) =>
      Promise.resolve(entries.filter((e) => e.id > sinceId).slice(0, limit)),
  };
}

const SUPREMA_CFG = { deviceHost: "10.0.1.5", devicePort: 51211, adminLoginId: "admin", adminPassword: "pass" };

// ─── SupremaNativeAdapter — unconfigured ─────────────────────────────────────

describe("SupremaNativeAdapter — unconfigured", () => {
  const adapter = new SupremaNativeAdapter();

  it("testConnection returns ok:false / NOT_CONFIGURED / requiresVendorSdk:true", async () => {
    const r = await adapter.testConnection();
    expect(r.ok).toBe(false);
    expect(r.status).toBe("NOT_CONFIGURED");
    expect(r.requiresVendorSdk).toBe(true);
  });

  it("poll() throws — not silently empty", async () => {
    await expect(adapter.poll(null)).rejects.toThrow(/not operational|SUPREMA_DEVICE_HOST/i);
  });

  it("adapter type is SUPREMA_NATIVE", () => {
    expect(adapter.type).toBe("SUPREMA_NATIVE");
  });
});

// ─── SupremaNativeAdapter — SDK not installed ─────────────────────────────────

describe("SupremaNativeAdapter — configured but SDK module absent", () => {
  it("testConnection returns requiresVendorSdk:true", async () => {
    const adapter = new SupremaNativeAdapter({ ...SUPREMA_CFG, sdkModule: "__non_existent_suprema_sdk__" });
    const r = await adapter.testConnection();
    expect(r.ok).toBe(false);
    expect(r.requiresVendorSdk).toBe(true);
    expect(r.message).toMatch(/not found|install/i);
  });

  it("poll() throws with SDK-missing message", async () => {
    const adapter = new SupremaNativeAdapter({ ...SUPREMA_CFG, sdkModule: "__non_existent_suprema_sdk__" });
    await expect(adapter.poll(null)).rejects.toThrow(/not found|install/i);
  });
});

// ─── SupremaNativeAdapter — testConnection ────────────────────────────────────

describe("SupremaNativeAdapter — mock SDK (testConnection)", () => {
  it("returns ok:true when device is reachable", async () => {
    const sdk = mockSupremaSDK([], "DEV-001", { deviceTimeMs: Date.now() });
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, sdk);
    const r = await adapter.testConnection();
    expect(r.ok).toBe(true);
    expect(r.status).toBe("REACHABLE");
    expect(r.message).toMatch(/DEV-001/);
    expect(typeof r.deviceTimeMs).toBe("number");
  });

  it("returns UNREACHABLE when connection fails", async () => {
    const sdk = mockSupremaSDK([], "DEV-X", { connectFails: true });
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, sdk);
    const r = await adapter.testConnection();
    expect(r.ok).toBe(false);
    expect(r.status).toBe("UNREACHABLE");
  });
});

// ─── SupremaNativeAdapter — poll ─────────────────────────────────────────────

describe("SupremaNativeAdapter — poll with mock SDK", () => {
  it("returns no punches on empty log", async () => {
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, mockSupremaSDK([]));
    const { punches, nextCursor } = await adapter.poll(null);
    expect(punches).toHaveLength(0);
    expect(nextCursor).not.toBeNull();
  });

  it("maps T&A log entries to GatewayPunch with correct event types", async () => {
    const entries = [
      makeLogEntry(1, "EMP001", 1, "2024-03-15T09:00:00.000Z"),
      makeLogEntry(2, "EMP001", 2, "2024-03-15T17:30:00.000Z"),
    ];
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, mockSupremaSDK(entries, "DEV-A"));
    const { punches } = await adapter.poll(null);
    expect(punches).toHaveLength(2);
    expect(punches[0].eventType).toBe("CLOCK_IN");
    expect(punches[1].eventType).toBe("CLOCK_OUT");
    expect(punches[0].deviceEventUid).toBe("suprema-native-DEV-A-1");
    expect(punches[1].deviceEventUid).toBe("suprema-native-DEV-A-2");
  });

  it("advances cursor so already-seen events are not replayed", async () => {
    const entries = [
      makeLogEntry(1, "EMP001", 1, "2024-03-15T09:00:00.000Z"),
      makeLogEntry(2, "EMP002", 1, "2024-03-15T09:05:00.000Z"),
    ];
    const sdk = mockSupremaSDK(entries, "DEV-B");
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, sdk);

    const { nextCursor } = await adapter.poll(null);
    const { punches: second } = await new SupremaNativeAdapter(SUPREMA_CFG, sdk).poll(nextCursor);
    expect(second).toHaveLength(0);
  });

  it("picks up only new entries after cursor", async () => {
    const base = [makeLogEntry(1, "EMP001", 1, "2024-03-15T09:00:00.000Z")];
    const sdk1 = mockSupremaSDK(base, "DEV-C");
    const { nextCursor } = await new SupremaNativeAdapter(SUPREMA_CFG, sdk1).poll(null);

    const all = [...base, makeLogEntry(2, "EMP002", 1, "2024-03-15T10:00:00.000Z")];
    const sdk2 = mockSupremaSDK(all, "DEV-C");
    const { punches } = await new SupremaNativeAdapter(SUPREMA_CFG, sdk2).poll(nextCursor);
    expect(punches).toHaveLength(1);
    expect(punches[0].deviceUserId).toBe("EMP002");
  });

  it("skips non-T&A entries but still advances cursor past them", async () => {
    const entries = [
      makeLogEntry(1, "EMP001", 99, "2024-03-15T09:00:00.000Z"), // unknown key
      makeLogEntry(2, "EMP002", 1,  "2024-03-15T09:01:00.000Z"),
    ];
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, mockSupremaSDK(entries, "DEV-D"));
    const { punches, nextCursor } = await adapter.poll(null);
    expect(punches).toHaveLength(1);
    expect(punches[0].deviceUserId).toBe("EMP002");
    const decoded = supremaDecodeCursor(nextCursor);
    expect(decoded?.lastEventId).toBe(2);
  });

  it("terminal malformed entry (missing userId, bad datetime): cursor advances past it", async () => {
    // Entry 1: valid; entry 2: missing userId; entry 3: valid but only returned after cursor skips 2.
    const entries = [
      makeLogEntry(1, "EMP001", 1, "2024-03-15T09:00:00.000Z"),
      makeLogEntry(2, "",       1, "INVALID-DATE"),             // malformed: no userId, bad date
      makeLogEntry(3, "EMP003", 1, "2024-03-15T09:02:00.000Z"),
    ];
    const adapter = new SupremaNativeAdapter(SUPREMA_CFG, mockSupremaSDK(entries, "DEV-M"));
    const { punches, nextCursor } = await adapter.poll(null);
    // Events 1 and 3 forwarded; event 2 skipped.
    expect(punches.map((p) => p.deviceUserId)).toEqual(["EMP001", "EMP003"]);
    // Cursor must have advanced past event 3 (id=3).
    const decoded = supremaDecodeCursor(nextCursor);
    expect(decoded?.lastEventId).toBe(3);

    // Re-poll: all three events are behind the cursor → no output.
    const { punches: replay } = await new SupremaNativeAdapter(SUPREMA_CFG, mockSupremaSDK(entries, "DEV-M")).poll(nextCursor);
    expect(replay).toHaveLength(0);
  });

  it("resets cursor when device ID changes (device replacement)", async () => {
    const sdk1 = mockSupremaSDK([makeLogEntry(10, "EMP001", 1, "2024-01-01T09:00:00.000Z")], "DEV-E");
    const { nextCursor } = await new SupremaNativeAdapter(SUPREMA_CFG, sdk1).poll(null);

    const sdk2 = mockSupremaSDK([makeLogEntry(1, "EMP002", 1, "2024-03-01T09:00:00.000Z")], "DEV-F");
    const { punches } = await new SupremaNativeAdapter(SUPREMA_CFG, sdk2).poll(nextCursor);
    expect(punches).toHaveLength(1);
    expect(punches[0].deviceUserId).toBe("EMP002");
  });

  it("raw metadata excludes biometric fields", async () => {
    const sdk = mockSupremaSDK([makeLogEntry(1, "EMP001", 1, "2024-03-15T09:00:00.000Z")], "DEV-G");
    const { punches } = await new SupremaNativeAdapter(SUPREMA_CFG, sdk).poll(null);
    const raw = punches[0].raw ?? {};
    expect(raw).not.toHaveProperty("template");
    expect(raw).not.toHaveProperty("fingerprint");
    expect(raw).not.toHaveProperty("face_image");
    expect(raw).toHaveProperty("user_id", "EMP001");
    expect(raw).toHaveProperty("tna_key", 1);
  });
});

// ─── supremaNativeConfigFromEnv ───────────────────────────────────────────────

describe("supremaNativeConfigFromEnv", () => {
  it("returns undefined when SUPREMA_DEVICE_HOST is absent", () => {
    expect(supremaNativeConfigFromEnv({})).toBeUndefined();
  });

  it("parses env vars with defaults", () => {
    const cfg = supremaNativeConfigFromEnv({
      SUPREMA_DEVICE_HOST: "10.0.0.5",
      SUPREMA_ADMIN_LOGIN_ID: "admin",
      SUPREMA_ADMIN_PASSWORD: "pw",
    });
    expect(cfg).toMatchObject({ deviceHost: "10.0.0.5", devicePort: 51211, adminLoginId: "admin", adminPassword: "pw" });
    expect(cfg?.certPath).toBeUndefined();
  });

  it("parses custom port, cert path, and sdk module", () => {
    const cfg = supremaNativeConfigFromEnv({
      SUPREMA_DEVICE_HOST: "10.0.0.6",
      SUPREMA_DEVICE_PORT: "51212",
      SUPREMA_CERT_PATH: "/etc/certs/ca.pem",
      SUPREMA_SDK_MODULE: "my-sdk",
    });
    expect(cfg?.devicePort).toBe(51212);
    expect(cfg?.certPath).toBe("/etc/certs/ca.pem");
    expect(cfg?.sdkModule).toBe("my-sdk");
  });
});

// ─── Suprema cursor ───────────────────────────────────────────────────────────

describe("Suprema native cursor", () => {
  it("decodeCursor returns null for null input", () => {
    expect(supremaDecodeCursor(null)).toBeNull();
  });

  it("decodeCursor returns null for invalid JSON", () => {
    expect(supremaDecodeCursor("not-json")).toBeNull();
  });

  it("round-trips a valid cursor", () => {
    const encoded = supremaEncodeCursor("DEV-42", 100);
    expect(supremaDecodeCursor(encoded)).toEqual({ deviceId: "DEV-42", lastEventId: 100 });
  });
});

// ─── Suprema T&A key mapping ─────────────────────────────────────────────────

describe("BIOSTAR_TNA_KEY mapping", () => {
  it("maps all six standard T&A keys", () => {
    expect(BIOSTAR_TNA_KEY[1]).toBe("CLOCK_IN");
    expect(BIOSTAR_TNA_KEY[2]).toBe("CLOCK_OUT");
    expect(BIOSTAR_TNA_KEY[3]).toBe("BREAK_START");
    expect(BIOSTAR_TNA_KEY[4]).toBe("BREAK_END");
    expect(BIOSTAR_TNA_KEY[5]).toBe("OVERTIME_START");
    expect(BIOSTAR_TNA_KEY[6]).toBe("OVERTIME_END");
  });

  it("SUPREMA_NATIVE_META_KEYS excludes biometric field names", () => {
    const bio = ["template", "fingerprint", "face_image", "card_raw", "minutiae"];
    for (const k of bio) expect(SUPREMA_NATIVE_META_KEYS).not.toContain(k);
  });
});

// ─── Shared pickMeta + toIso ──────────────────────────────────────────────────

describe("pickMeta sanitization", () => {
  it("drops non-whitelisted fields", () => {
    const row = { sn: "ABC", fingerprint_template: Buffer.from("bio"), deviceUserId: "U1", face_image: "b64" };
    const r = pickMeta(row as unknown as Record<string, unknown>, ZK_NATIVE_META_KEYS);
    expect(r).not.toHaveProperty("fingerprint_template");
    expect(r).not.toHaveProperty("face_image");
    expect(r).toHaveProperty("sn", "ABC");
  });

  it("drops non-scalar (object/buffer) values even if key is whitelisted", () => {
    const row = { sn: { nested: "obj" }, deviceUserId: "U2" };
    const r = pickMeta(row as unknown as Record<string, unknown>, ZK_NATIVE_META_KEYS);
    expect(r).not.toHaveProperty("sn");
    expect(r).toHaveProperty("deviceUserId", "U2");
  });
});

describe("toIso", () => {
  it("converts a Date object to ISO 8601", () => {
    const d = new Date("2024-03-15T09:00:00.000Z");
    expect(toIso(d)).toBe("2024-03-15T09:00:00.000Z");
  });

  it("converts a vendor local-time string", () => {
    expect(toIso("2024-03-15 08:30:00")).toMatch(/2024-03-15T08:30:00/);
  });

  it("returns null for empty string, non-string, or invalid date", () => {
    expect(toIso("")).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso(12345)).toBeNull();
    expect(toIso("not-a-date")).toBeNull();
  });
});
