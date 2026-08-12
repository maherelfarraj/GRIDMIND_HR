/**
 * ZKTeco Native Protocol Adapter.
 *
 * Connects directly to ZKTeco fingerprint/face/card devices over TCP/UDP
 * port 4370 using a standalone binary protocol client (no vendor SDK required;
 * only Node.js built-in `net` module is used). Handles:
 *   - Comm-key authentication (CMD_AUTH — required on secured devices)
 *   - Full 40-byte attendance record parsing including the punch status byte
 *   - Lossless incremental polling with timestamp watermark + occurrence indexing
 *
 * ENV (GATEWAY_ADAPTER=ZKTECO_NATIVE):
 *   ZKTECO_DEVICE_HOST   device IP or hostname (required)
 *   ZKTECO_DEVICE_PORT   device port (default 4370)
 *   ZKTECO_COMM_KEY      communication key / admin password (default "0" = none)
 *   ZKTECO_TIMEOUT_MS    socket timeout in ms (default 5000)
 *
 * See lib/attendance-gateway/NATIVE_PROTOCOLS.md for validation checklist.
 *
 * SANITIZATION: only whitelisted scalar metadata fields are forwarded.
 * Raw biometric templates never leave the device layer.
 */

import type { DeviceAdapter, GatewayPunch, AdapterTestResult, AdapterSdkInfo, PunchEventType } from "../types.js";
import { sanitizeRaw } from "./genericRest.js";
import { ZkTcpClient, type ZkRawRecord, type ZkClientOptions } from "./zktecoProtocol.js";
import { toIsoTimestamp } from "./timestamp.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function pickMeta(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return sanitizeRaw(out);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function toIso(value: unknown): string | null {
  return toIsoTimestamp(value);
}

// ─── Punch-state mapping ──────────────────────────────────────────────────────

/**
 * ZKTeco attendance status codes 0–5, matching the ZKBioTime middleware
 * mapping in vendorStubs.ts for cross-path consistency.
 */
export const ZK_PUNCH_STATE: Record<number, PunchEventType> = {
  0: "CLOCK_IN",
  1: "CLOCK_OUT",
  2: "BREAK_START",
  3: "BREAK_END",
  4: "OVERTIME_START",
  5: "OVERTIME_END",
};

/** Whitelisted scalar metadata fields — no biometric data. */
export const ZK_NATIVE_META_KEYS = ["sn", "deviceUserId", "userSn", "verifyType", "recordTime", "status"];

// ─── Lossless cursor (timestamp watermark + occurrence-indexed id set) ─────────

export interface ZkNativeCursor {
  /** ISO timestamp of the last processed record (watermark). */
  t: string | null;
  /** Stable UIDs of all records AT exactly `t` (same-second deduplication). */
  ids: string[];
}

export function decodeCursor(cursor: string | null): ZkNativeCursor {
  if (!cursor) return { t: null, ids: [] };
  try {
    const c = JSON.parse(cursor) as Partial<ZkNativeCursor>;
    if (typeof c === "object" && c !== null && ("t" in c || "ids" in c)) {
      return { t: c.t ?? null, ids: Array.isArray(c.ids) ? c.ids.map(String) : [] };
    }
  } catch { /* legacy plain cursor */ }
  return { t: cursor, ids: [] };
}

export function encodeCursor(token: ZkNativeCursor): string | null {
  if (!token.t) return null;
  return JSON.stringify(token);
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ZktecoNativeConfig {
  deviceHost: string;
  devicePort: number;
  commKey: string;
  timeoutMs: number;
}

export function zktecoNativeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ZktecoNativeConfig | undefined {
  const { ZKTECO_DEVICE_HOST, ZKTECO_DEVICE_PORT, ZKTECO_COMM_KEY, ZKTECO_TIMEOUT_MS } = env;
  if (!ZKTECO_DEVICE_HOST) return undefined;
  return {
    deviceHost: ZKTECO_DEVICE_HOST,
    devicePort: ZKTECO_DEVICE_PORT ? parseInt(ZKTECO_DEVICE_PORT, 10) : 4370,
    commKey: ZKTECO_COMM_KEY ?? "0",
    timeoutMs: ZKTECO_TIMEOUT_MS ? parseInt(ZKTECO_TIMEOUT_MS, 10) : 5000,
  };
}

// ─── Injectable client factory (for testing) ─────────────────────────────────

/**
 * Factory that creates a ZkTcpClient-compatible object.
 * Injected in tests to avoid real network calls.
 */
export interface ZkClientLike {
  connect(): Promise<void>;
  handshake(): Promise<{ deviceTimeMs: number }>;
  getAttendances(): Promise<ZkRawRecord[]>;
  /** Reboot the terminal (CMD_RESTART). Optional for older client fakes. */
  restart?(): Promise<void>;
  disconnect(): Promise<void>;
}

export type ZkClientFactory = (opts: ZkClientOptions) => ZkClientLike;

const defaultZkClientFactory: ZkClientFactory = (opts) => new ZkTcpClient(opts);

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ZktecoNativeAdapter implements DeviceAdapter {
  readonly type = "ZKTECO_NATIVE" as const;

  private readonly config?: ZktecoNativeConfig;
  private readonly clientFactory: ZkClientFactory;

  constructor(config?: ZktecoNativeConfig, clientFactory?: ZkClientFactory) {
    this.config = config;
    this.clientFactory = clientFactory ?? defaultZkClientFactory;
  }

  private makeClient(): ZkClientLike {
    const cfg = this.config!;
    return this.clientFactory({ host: cfg.deviceHost, port: cfg.devicePort, commKey: cfg.commKey, timeoutMs: cfg.timeoutMs });
  }

  /**
   * Connect, handshake once, run callback, then always disconnect.
   * The handshake result is passed to the callback so callers receive device
   * metadata (e.g. deviceTimeMs) without triggering a second handshake.
   */
  private async withClient<T>(fn: (client: ZkClientLike, hs: { deviceTimeMs: number }) => Promise<T>): Promise<T> {
    const client = this.makeClient();
    await client.connect();
    const hs = await client.handshake();
    try {
      return await fn(client, hs);
    } finally {
      try { await client.disconnect(); } catch { /* best-effort */ }
    }
  }

  /**
   * The ZKTeco native path speaks the binary protocol directly over Node's
   * built-in `net` module — no vendor SDK install is required, so the "SDK"
   * is always present. Version is null because there is no external module.
   */
  sdkInfo(): AdapterSdkInfo {
    return { present: true, version: null };
  }

  async testConnection(): Promise<AdapterTestResult> {
    if (!this.config) {
      return {
        ok: false,
        status: "NOT_CONFIGURED",
        requiresVendorSdk: false,
        message:
          "ZKTeco native adapter is not configured. Set ZKTECO_DEVICE_HOST " +
          "(and optionally ZKTECO_DEVICE_PORT, ZKTECO_COMM_KEY, ZKTECO_TIMEOUT_MS).",
      };
    }
    try {
      // withClient() handles connect + handshake; the callback receives the
      // handshake result directly — no second handshake is issued.
      const { deviceTimeMs } = await this.withClient(async (_client, hs) => hs);
      // Clock-skew check: devices report local time with no auto time-sync,
      // so a drifting device clock silently skews every punch timestamp.
      const clockSkewMs = Math.abs(deviceTimeMs - Date.now());
      return {
        ok: true,
        status: "REACHABLE",
        message: `ZKTeco device reachable (${this.config.deviceHost}:${this.config.devicePort})`,
        deviceTimeMs,
        clockSkewMs,
      };
    } catch (e) {
      const msg = errMsg(e);
      const isAuth = /auth|comm.*key|CMD_AUTH/i.test(msg) && !/ECONNREFUSED|timeout/i.test(msg);
      return {
        ok: false,
        status: isAuth ? "AUTH_FAILED" : "UNREACHABLE",
        message: isAuth
          ? `ZKTeco device authentication failed: ${msg}`
          : `ZKTeco device unreachable at ${this.config.deviceHost}:${this.config.devicePort} — ${msg}`,
      };
    }
  }

  /** Reboot the terminal over the native binary protocol (CMD_RESTART). */
  async restartDevice(): Promise<{ ok: boolean; message: string }> {
    if (!this.config) {
      return { ok: false, message: "ZKTeco native adapter is not configured (ZKTECO_DEVICE_HOST unset) — cannot reboot" };
    }
    try {
      return await this.withClient(async (client) => {
        if (!client.restart) {
          return { ok: false, message: "ZKTeco protocol client does not support CMD_RESTART" };
        }
        await client.restart();
        return { ok: true, message: `Reboot (CMD_RESTART) issued to ZKTeco terminal at ${this.config!.deviceHost}` };
      });
    } catch (e) {
      return { ok: false, message: `ZKTeco native reboot failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    if (!this.config) {
      throw new Error("ZKTeco native adapter not operational: ZKTECO_DEVICE_HOST is not set.");
    }

    const cur = decodeCursor(sinceCursor);
    const prevT  = cur.t;
    const prevIds = new Set(cur.ids);

    return this.withClient(async (client, _hs) => {
      const records = await client.getAttendances();

      const punches: GatewayPunch[] = [];
      let maxT   = prevT;
      const maxIds = new Set(prevIds);

      // Occurrence counter disambiguates same-user/same-second punches.
      // ZKTeco devices use second-granular timestamps; the device memory
      // ordering is stable, so the occurrence index is stable across replays.
      const batchOccurrences = new Map<string, number>();

      for (const rec of records) {
        const eventTime = toIso(rec.recordTime);
        if (!eventTime) continue;

        // Skip records strictly older than the watermark.
        if (prevT && eventTime < prevT) continue;

        // Map vendor status 0–5 to event type; skip unknown statuses.
        const eventType = ZK_PUNCH_STATE[rec.status] ?? "CLOCK_IN";

        // Stable UID with occurrence index (handles same-user/same-second).
        const baseKey = `zk-native-${this.config!.deviceHost}-${rec.deviceUserId}-${rec.recordTime.getTime()}`;
        const occ = batchOccurrences.get(baseKey) ?? 0;
        batchOccurrences.set(baseKey, occ + 1);
        const uid = occ === 0 ? baseKey : `${baseKey}-${occ}`;

        // Skip records AT the watermark that were already processed.
        if (prevT && eventTime === prevT && prevIds.has(uid)) continue;

        const raw = pickMeta(
          {
            sn:           this.config!.deviceHost,
            deviceUserId: rec.deviceUserId,
            userSn:       rec.userSn,
            verifyType:   rec.verifyType,
            recordTime:   eventTime,
            status:       rec.status,
          },
          ZK_NATIVE_META_KEYS,
        );

        punches.push({ deviceUserId: rec.deviceUserId, eventTime, eventType, deviceEventUid: uid, raw });

        // Advance boundary tracker.
        if (!maxT || eventTime > maxT) {
          maxT = eventTime;
          maxIds.clear();
          maxIds.add(uid);
        } else if (eventTime === maxT) {
          maxIds.add(uid);
        }
      }

      return { punches, nextCursor: encodeCursor({ t: maxT, ids: [...maxIds] }) };
    });
  }
}
