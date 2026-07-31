/** Shared gateway types. No raw biometric templates ever leave the adapter layer. */

export type PunchEventType =
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "BREAK_START"
  | "BREAK_END"
  | "OVERTIME_START"
  | "OVERTIME_END";

export interface GatewayPunch {
  /** Device-native user id (mapped to an employee in the HR core). */
  deviceUserId?: string;
  /** Direct employee id when the source already knows it (CSV imports). */
  employeeId?: number;
  eventTime: string; // ISO 8601
  eventType: PunchEventType;
  /** Device-native event uid — drives server-side dedupe. */
  deviceEventUid?: string;
  /** Sanitized raw metadata (never biometric templates). */
  raw?: Record<string, unknown>;
}

/** Coarse classification of a connection-test outcome, surfaced to HR admins. */
export type AdapterConnectionStatus = "REACHABLE" | "AUTH_FAILED" | "UNREACHABLE" | "NOT_CONFIGURED";

export interface AdapterTestResult {
  ok: boolean;
  /** Machine-readable outcome so the HR core can render distinct failure states. */
  status: AdapterConnectionStatus;
  message: string;
  /** True when the adapter cannot run without a vendor SDK / licensed driver. */
  requiresVendorSdk?: boolean;
  deviceTimeMs?: number;
  /**
   * |deviceTimeMs - gateway Date.now()| computed at testConnection() time.
   * Only present when the device wall clock was actually read (never a
   * fallback value) — absence means "skew unknown", not "skew zero".
   */
  clockSkewMs?: number;
}

/** Whether a native vendor SDK is installed on this gateway host, and its version if known. */
export interface AdapterSdkInfo {
  present: boolean;
  version: string | null;
}

export interface DeviceAdapter {
  readonly type: "ZKTECO" | "SUPREMA" | "ZKTECO_NATIVE" | "SUPREMA_NATIVE" | "GENERIC_REST" | "CSV" | "SIMULATOR";
  /** Verify connectivity to the physical device / data source. */
  testConnection(): Promise<AdapterTestResult>;
  /**
   * Report native SDK availability (optional). Adapters that need no vendor
   * SDK may omit this; the service then infers presence from
   * `testConnection().requiresVendorSdk`.
   */
  sdkInfo?(): AdapterSdkInfo;
  /** Pull new punches since the given watermark (ISO time or device cursor). */
  poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }>;
}

export interface QueuedBatch {
  batchUuid: string;
  createdAtMs: number;
  attempts: number;
  /** Epoch ms before which flush() must skip this batch (exponential backoff). */
  nextAttemptAtMs?: number;
  /** True once maxAttempts is exhausted — kept on disk for operator recovery, never auto-retried. */
  terminal?: boolean;
  punches: GatewayPunch[];
}
