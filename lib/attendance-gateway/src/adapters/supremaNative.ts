/**
 * Suprema Native Protocol Adapter.
 *
 * Connects directly to Suprema BioEntry/BioStation/FaceStation devices via
 * the BioStar 2 Device SDK over TCP (port 51211/51212). The SDK is a
 * proprietary C native library distributed by Suprema. Install the vendor-
 * provided Node.js binding on the gateway host before enabling this adapter:
 *
 *   npm install biostar2-device-sdk   # name of the Suprema-provided npm binding
 *
 * If the module name differs, set SUPREMA_SDK_MODULE to the actual package name.
 *
 * ENV (GATEWAY_ADAPTER=SUPREMA_NATIVE):
 *   SUPREMA_DEVICE_HOST       device IP or hostname (required)
 *   SUPREMA_DEVICE_PORT       device port (default 51211)
 *   SUPREMA_ADMIN_LOGIN_ID    admin login ID for device authentication
 *   SUPREMA_ADMIN_PASSWORD    admin password
 *   SUPREMA_CERT_PATH         path to CA cert file for TLS (optional)
 *   SUPREMA_SDK_MODULE        npm module name for the BioStar 2 Device SDK
 *                             binding (default "biostar2-device-sdk")
 *
 * See lib/attendance-gateway/NATIVE_PROTOCOLS.md for the full runbook.
 *
 * SANITIZATION: only whitelisted scalar metadata fields are forwarded.
 * Raw biometric templates, fingerprint minutiae, and face images must never
 * appear in a GatewayPunch — enforced by pickMeta() + sanitizeRaw().
 */

import { createRequire } from "module";
import type { DeviceAdapter, GatewayPunch, AdapterTestResult, AdapterSdkInfo, PunchEventType } from "../types.js";
import { sanitizeRaw } from "./genericRest.js";

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
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── BioStar 2 Device SDK typed interface ────────────────────────────────────
//
// These types model the BioStar 2 Device SDK API surface.  When Suprema ships
// their official Node.js binding (or you build a native addon with node-gyp),
// it should conform to this interface.  The adapter is coded against it so
// that only the dynamic require() line below needs to change if the module
// name differs.

/** A single T&A event log entry returned by the device SDK. */
export interface SupremaLogEntry {
  /** Monotonically increasing event index on the device (used as cursor). */
  id: number;
  /** Device-side user ID. */
  userId: string;
  /** T&A function key (1=in, 2=out, 3=break-start, 4=break-end, 5=ot-start, 6=ot-end). */
  tnaKey: number;
  /** Punch timestamp as a JS Date or ISO string. */
  datetime: Date | string;
}

/** BioStar 2 Device SDK module interface. */
export interface SupremaDeviceSDK {
  /**
   * Connect to the device and return an opaque session handle.
   * Throws when the device is unreachable or credentials are rejected.
   */
  connect(host: string, port: number, loginId: string, password: string, certPath?: string): Promise<unknown>;

  /** Disconnect a session handle. */
  disconnect(handle: unknown): Promise<void>;

  /**
   * Retrieve device info (serial number, firmware version, current time).
   * `deviceTimeMs` is the device epoch time in milliseconds.
   */
  getDeviceInfo(handle: unknown): Promise<{ deviceId: string; serialNumber: string; firmwareVersion?: string }>;

  /**
   * Return the device wall-clock time as epoch milliseconds.
   * Used to check clock skew (validation checklist item 1).
   */
  getDeviceTimeMs(handle: unknown): Promise<number>;

  /**
   * Fetch T&A event log entries with event id > `sinceId`.
   * Returns entries in ascending id order.
   * `limit` caps the batch size (use ≤ 1000 to bound memory).
   */
  getLogEntriesSince(handle: unknown, sinceId: number, limit: number): Promise<SupremaLogEntry[]>;

  /** Reboot the device. Optional — older SDK bindings may not expose it. */
  reboot?(handle: unknown): Promise<void>;
}

/** Module name for the BioStar 2 Device SDK binding. */
function sdkModuleName(env: NodeJS.ProcessEnv = process.env): string {
  return env.SUPREMA_SDK_MODULE ?? "biostar2-device-sdk";
}

/** Dynamically load the BioStar 2 Device SDK; throws with instructions if missing. */
export function loadSupremaSDK(moduleName: string = sdkModuleName()): SupremaDeviceSDK {
  const req = createRequire(import.meta.url);
  try {
    return req(moduleName) as SupremaDeviceSDK;
  } catch {
    throw new Error(
      `Suprema native adapter: '${moduleName}' SDK module not found on this gateway host.\n` +
      "Install the BioStar 2 Device SDK Node.js binding and restart the gateway:\n" +
      `  npm install ${moduleName}\n` +
      "If the package name differs, set SUPREMA_SDK_MODULE to the correct name.\n" +
      "See lib/attendance-gateway/NATIVE_PROTOCOLS.md for prerequisites.",
    );
  }
}

// ─── T&A key → event type mapping ────────────────────────────────────────────

/**
 * BioStar 2 device T&A keys 1–6, matching the BioStar 2 server middleware
 * mapping in vendorStubs.ts for cross-path consistency.
 */
export const BIOSTAR_TNA_KEY: Record<number, PunchEventType> = {
  1: "CLOCK_IN",
  2: "CLOCK_OUT",
  3: "BREAK_START",
  4: "BREAK_END",
  5: "OVERTIME_START",
  6: "OVERTIME_END",
};

/** Whitelisted scalar metadata fields — no biometric data. */
export const SUPREMA_NATIVE_META_KEYS = ["event_id", "device_id", "user_id", "tna_key", "datetime"];

// ─── Cursor (monotonic event id) ──────────────────────────────────────────────

export interface SupremaNativeCursor {
  /**
   * Last event id fully processed (inclusive).
   * The next poll fetches entries with id > lastEventId.
   */
  lastEventId: number;
  /** Device serial number — cursor is only valid for the same device. */
  deviceId: string;
}

export function decodeCursor(cursor: string | null): SupremaNativeCursor | null {
  if (!cursor) return null;
  try {
    const c = JSON.parse(cursor) as Partial<SupremaNativeCursor>;
    if (typeof c.lastEventId === "number" && typeof c.deviceId === "string") {
      return { lastEventId: c.lastEventId, deviceId: c.deviceId };
    }
  } catch { /* fresh start */ }
  return null;
}

export function encodeCursor(deviceId: string, lastEventId: number): string {
  return JSON.stringify({ deviceId, lastEventId });
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SupremaNativeConfig {
  deviceHost: string;
  devicePort: number;
  adminLoginId: string;
  adminPassword: string;
  certPath?: string;
  sdkModule?: string;
}

export function supremaNativeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupremaNativeConfig | undefined {
  const { SUPREMA_DEVICE_HOST, SUPREMA_DEVICE_PORT, SUPREMA_ADMIN_LOGIN_ID, SUPREMA_ADMIN_PASSWORD, SUPREMA_CERT_PATH, SUPREMA_SDK_MODULE } = env;
  if (!SUPREMA_DEVICE_HOST) return undefined;
  return {
    deviceHost: SUPREMA_DEVICE_HOST,
    devicePort: SUPREMA_DEVICE_PORT ? parseInt(SUPREMA_DEVICE_PORT, 10) : 51211,
    adminLoginId: SUPREMA_ADMIN_LOGIN_ID ?? "",
    adminPassword: SUPREMA_ADMIN_PASSWORD ?? "",
    certPath: SUPREMA_CERT_PATH,
    sdkModule: SUPREMA_SDK_MODULE,
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/** Page size for getLogEntriesSince — caps memory per batch. */
const LOG_PAGE_SIZE = 500;
/** Maximum pages to drain per poll to bound latency. */
const MAX_PAGES = 20;

export class SupremaNativeAdapter implements DeviceAdapter {
  readonly type = "SUPREMA_NATIVE" as const;

  /** Injectable SDK — set in tests to avoid dynamic loading. */
  private readonly _sdk?: SupremaDeviceSDK;

  constructor(private readonly config?: SupremaNativeConfig, sdk?: SupremaDeviceSDK) {
    this._sdk = sdk;
  }

  /** Load SDK (test injection takes priority over dynamic require). */
  private sdk(): SupremaDeviceSDK {
    if (this._sdk) return this._sdk;
    return loadSupremaSDK(this.config?.sdkModule);
  }

  /** Connect, run callback, then always disconnect. */
  private async withDevice<T>(fn: (handle: unknown, deviceId: string) => Promise<T>): Promise<T> {
    const cfg = this.config!;
    const sdk = this.sdk();
    const handle = await sdk.connect(cfg.deviceHost, cfg.devicePort, cfg.adminLoginId, cfg.adminPassword, cfg.certPath);
    let deviceId = cfg.deviceHost;
    try {
      const info = await sdk.getDeviceInfo(handle);
      deviceId = info.serialNumber ?? info.deviceId ?? cfg.deviceHost;
    } catch { /* device info unavailable on some firmware */ }
    try {
      return await fn(handle, deviceId);
    } finally {
      try { await sdk.disconnect(handle); } catch { /* best-effort */ }
    }
  }

  /**
   * Report whether the BioStar 2 Device SDK binding is installed on this
   * gateway host, plus its version when the module exposes one.
   */
  sdkInfo(): AdapterSdkInfo {
    try {
      const sdk = this.sdk() as SupremaDeviceSDK & { version?: unknown };
      const version = typeof sdk.version === "string" ? sdk.version : null;
      return { present: true, version };
    } catch {
      return { present: false, version: null };
    }
  }

  async testConnection(): Promise<AdapterTestResult> {
    if (!this.config) {
      return {
        ok: false,
        status: "NOT_CONFIGURED",
        requiresVendorSdk: true,
        message:
          "Suprema native adapter is not configured. Set SUPREMA_DEVICE_HOST " +
          "(and optionally SUPREMA_DEVICE_PORT, SUPREMA_ADMIN_LOGIN_ID, SUPREMA_ADMIN_PASSWORD, SUPREMA_CERT_PATH).",
      };
    }
    try {
      // Verify the SDK module is loadable before attempting a connection.
      this.sdk();
    } catch (e) {
      return { ok: false, status: "NOT_CONFIGURED", requiresVendorSdk: true, message: errMsg(e) };
    }
    try {
      const result = await this.withDevice(async (handle, deviceId) => {
        const sdk = this.sdk();
        let deviceTimeMs = Date.now();
        let deviceTimeRead = false;
        try {
          deviceTimeMs = await sdk.getDeviceTimeMs(handle);
          deviceTimeRead = true;
        } catch { /* optional on some firmware */ }
        return { deviceId, deviceTimeMs, deviceTimeRead };
      });
      return {
        ok: true,
        status: "REACHABLE",
        message: `Suprema device reachable (ID: ${result.deviceId})`,
        deviceTimeMs: result.deviceTimeMs,
        // Only report skew when the device clock was actually read — the
        // Date.now() fallback would always yield a meaningless ~0 skew.
        ...(result.deviceTimeRead ? { clockSkewMs: Math.abs(result.deviceTimeMs - Date.now()) } : {}),
      };
    } catch (e) {
      const msg = errMsg(e);
      const isAuth = /auth|401|403|password|login/i.test(msg);
      return {
        ok: false,
        status: isAuth ? "AUTH_FAILED" : "UNREACHABLE",
        message: isAuth
          ? `Suprema device authentication failed: ${msg}`
          : `Suprema device unreachable at ${this.config.deviceHost}:${this.config.devicePort} — ${msg}`,
      };
    }
  }

  /** Reboot the device through the BioStar 2 Device SDK. */
  async restartDevice(): Promise<{ ok: boolean; message: string }> {
    if (!this.config) {
      return { ok: false, message: "Suprema native adapter is not configured (SUPREMA_DEVICE_HOST unset) — cannot reboot" };
    }
    let sdk: SupremaDeviceSDK;
    try {
      sdk = this.sdk();
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    }
    if (!sdk.reboot) {
      return { ok: false, message: "Installed BioStar 2 Device SDK binding does not expose reboot() — upgrade the SDK module to enable remote restart" };
    }
    try {
      return await this.withDevice(async (handle, deviceId) => {
        await sdk.reboot!(handle);
        return { ok: true, message: `Reboot issued to Suprema device ${deviceId} via Device SDK` };
      });
    } catch (e) {
      return { ok: false, message: `Suprema device reboot failed: ${errMsg(e)}` };
    }
  }

  async poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    if (!this.config) {
      throw new Error("Suprema native adapter not operational: SUPREMA_DEVICE_HOST is not set.");
    }
    // Throws with install instructions if the SDK module is missing.
    this.sdk();

    const prev = decodeCursor(sinceCursor);
    const startEventId = prev ? prev.lastEventId : 0;

    return this.withDevice(async (handle, deviceId) => {
      const sdk = this.sdk();
      // Reset to 0 when cursor belongs to a different device (replacement/swap).
      const sinceId = (prev && prev.deviceId !== deviceId) ? 0 : startEventId;

      const punches: GatewayPunch[] = [];
      let lastEventId = sinceId;
      let finished = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        const entries = await sdk.getLogEntriesSince(handle, lastEventId, LOG_PAGE_SIZE);
        for (const entry of entries) {
          // Advance the cursor for EVERY consumed entry — including entries
          // with malformed/missing timestamps or non-T&A event types — so the
          // adapter can always make durable forward progress even on a device
          // that emits a run of unrecognized or invalid records.
          if (entry.id > lastEventId) lastEventId = entry.id;
          const eventType = BIOSTAR_TNA_KEY[entry.tnaKey];
          const eventTime = toIso(entry.datetime);
          if (!eventTime || !entry.userId) continue;
          if (!eventType) continue; // non-T&A event: cursor advanced above, not forwarded
          const raw = pickMeta(
            { event_id: entry.id, device_id: deviceId, user_id: entry.userId, tna_key: entry.tnaKey, datetime: eventTime },
            SUPREMA_NATIVE_META_KEYS,
          );
          punches.push({
            deviceUserId: entry.userId,
            eventTime,
            eventType,
            deviceEventUid: `suprema-native-${deviceId}-${entry.id}`,
            raw,
          });
        }
        if (entries.length < LOG_PAGE_SIZE) { finished = true; break; }
      }

      const nextCursor = encodeCursor(deviceId, lastEventId);
      // If pagination stopped early, the next poll will resume from lastEventId.
      void finished; // explicit acknowledgement — nextCursor handles both cases
      return { punches, nextCursor };
    });
  }
}
