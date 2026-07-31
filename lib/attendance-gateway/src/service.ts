import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { dirname } from "path";
import { EncryptedQueue } from "./queue.js";
import { HrClient } from "./hrClient.js";
import type { DeviceAdapter, GatewayPunch } from "./types.js";

/**
 * GatewayService — the core offline-first pipeline:
 *
 *   adapter.poll() → EncryptedQueue.enqueue() → flush() → HR core (signed)
 *
 * flush() drains the queue oldest-first with bounded retries and exponential
 * backoff between attempts. Batches survive process restarts (encrypted on
 * disk) and network outages; a later reconcile() confirms server-side state
 * per batch UUID.
 */
export interface FlushResult {
  sent: number;
  failed: number;
  retriedLater: number;
  details: Array<{ batchUuid: string; status: "SENT" | "FAILED" | "RETRY_LATER" | "REJECTED" | "BACKOFF"; httpStatus?: number }>;
}

export class GatewayService {
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;

  constructor(
    private readonly queue: EncryptedQueue,
    private readonly hr: HrClient,
    private readonly adapter: DeviceAdapter,
    opts?: { maxAttempts?: number; baseBackoffMs?: number; maxBackoffMs?: number; cursorPath?: string },
  ) {
    this.maxAttempts = opts?.maxAttempts ?? 10;
    this.baseBackoffMs = opts?.baseBackoffMs ?? 30_000;
    this.maxBackoffMs = opts?.maxBackoffMs ?? 15 * 60_000;
    this.cursorPath = opts?.cursorPath ?? null;
  }

  private readonly cursorPath: string | null;
  private cursor: string | null = null;
  lastPollAt: Date | null = null;
  lastFlushAt: Date | null = null;
  lastError: string | null = null;

  /** Restore the persisted adapter cursor (call once at startup). */
  async init(): Promise<void> {
    if (!this.cursorPath) return;
    try {
      const raw = await fs.readFile(this.cursorPath, "utf8");
      const parsed = JSON.parse(raw) as { cursor?: string | null };
      this.cursor = parsed.cursor ?? null;
    } catch {
      this.cursor = null; // first run / no cursor yet
    }
  }

  /**
   * Atomically persist the cursor (write temp file, then rename). The
   * in-memory cursor advances only AFTER persistence succeeds — if the write
   * or rename fails, the old cursor is retained and the next poll replays.
   */
  private async commitCursor(next: string | null): Promise<void> {
    if (this.cursorPath) {
      await fs.mkdir(dirname(this.cursorPath), { recursive: true });
      const tmp = `${this.cursorPath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ cursor: next }), "utf8");
      await fs.rename(tmp, this.cursorPath);
    }
    this.cursor = next;
  }

  /**
   * Poll the device adapter and spool everything into the encrypted queue.
   * The cursor is committed only AFTER the batch is durably enqueued: if the
   * enqueue fails, the next poll replays from the old cursor and server-side
   * UID dedupe absorbs any duplicates — no punch is ever lost.
   */
  async pollOnce(): Promise<{ queued: number; batchUuid: string | null }> {
    const { punches, nextCursor } = await this.adapter.poll(this.cursor);
    this.lastPollAt = new Date();
    if (punches.length === 0) {
      await this.commitCursor(nextCursor);
      return { queued: 0, batchUuid: null };
    }
    const batchUuid = randomUUID();
    await this.queue.enqueue({ batchUuid, createdAtMs: Date.now(), attempts: 0, punches });
    await this.commitCursor(nextCursor);
    return { queued: punches.length, batchUuid };
  }

  /**
   * One scheduler tick: poll + flush, then ALWAYS report connection health.
   * The heartbeat is decoupled from poll/flush failures on purpose — an
   * unreachable / misconfigured / auth-failing adapter makes pollOnce() throw,
   * and that is exactly when the HR core most needs the structured
   * testConnection() result (UNREACHABLE / AUTH_FAILED / NOT_CONFIGURED).
   */
  async tick(): Promise<{ pollError: string | null; heartbeatError: string | null }> {
    let pollError: string | null = null;
    try {
      await this.pollOnce();
      await this.flush();
    } catch (e) {
      pollError = e instanceof Error ? e.message : String(e);
      this.lastError = pollError;
    }
    let heartbeatError: string | null = null;
    try {
      await this.hr.heartbeat(await this.adapter.testConnection());
    } catch (e) {
      heartbeatError = e instanceof Error ? e.message : String(e);
      this.lastError = heartbeatError;
    }
    return { pollError, heartbeatError };
  }

  /** Queue an ad-hoc batch (e.g. parsed from a CSV upload). */
  async enqueuePunches(punches: GatewayPunch[]): Promise<string> {
    const batchUuid = randomUUID();
    await this.queue.enqueue({ batchUuid, createdAtMs: Date.now(), attempts: 0, punches });
    return batchUuid;
  }

  /**
   * Attempt to deliver all pending batches. Server-side batch idempotency
   * (uuid) + punch dedupe keys make aggressive retries safe.
   */
  async flush(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, failed: 0, retriedLater: 0, details: [] };
    for (const uuid of await this.queue.pending()) {
      const batch = await this.queue.read(uuid);
      if (!batch) continue;
      // Terminal batches stay on disk for operator recovery but are never
      // auto-retried; not-yet-due batches wait out their backoff window.
      if (batch.terminal) continue;
      if (batch.nextAttemptAtMs && Date.now() < batch.nextAttemptAtMs) {
        result.details.push({ batchUuid: uuid, status: "BACKOFF" });
        continue;
      }
      try {
        const { status } = await this.hr.uploadBatch(batch.batchUuid, batch.punches);
        if (status === 200 || status === 201) {
          await this.queue.remove(uuid);
          result.sent++;
          result.details.push({ batchUuid: uuid, status: "SENT", httpStatus: status });
        } else if (status === 401 || status === 403 || status === 422) {
          // Auth/policy rejection — retrying identical bytes cannot succeed.
          // Keep the batch for operator inspection but stop hammering.
          result.failed++;
          result.details.push({ batchUuid: uuid, status: "REJECTED", httpStatus: status });
          this.lastError = `batch ${uuid} rejected with ${status}`;
        } else {
          await this.handleRetry(uuid, batch.attempts, result, status);
        }
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        await this.handleRetry(uuid, batch.attempts, result);
      }
    }
    this.lastFlushAt = new Date();
    return result;
  }

  private async handleRetry(uuid: string, attempts: number, result: FlushResult, httpStatus?: number): Promise<void> {
    const updated = await this.queue.markAttempt(uuid, {
      baseBackoffMs: this.baseBackoffMs,
      maxBackoffMs: this.maxBackoffMs,
      maxAttempts: this.maxAttempts,
    });
    if (!updated || updated.terminal) {
      // Terminal: kept encrypted on disk for manual recovery, never auto-retried.
      result.failed++;
      result.details.push({ batchUuid: uuid, status: "FAILED", httpStatus });
    } else {
      result.retriedLater++;
      result.details.push({ batchUuid: uuid, status: "RETRY_LATER", httpStatus });
    }
  }

  /** Ask the HR core which locally-known batches it actually holds. */
  async reconcile(known: Array<{ batchUuid: string; eventCount: number }>) {
    return this.hr.reconcile(known);
  }

  /** Clock skew beyond this (either direction) breaches runbook validation checklist item 1. */
  static readonly CLOCK_SKEW_WARN_MS = 60_000;

  async status() {
    const pending = await this.queue.pending();
    const test = await this.adapter.testConnection();
    // sdk_present: adapters expose sdkInfo() when they load a native vendor
    // SDK; otherwise infer from the connection test (an adapter that flags
    // requiresVendorSdk on failure is telling us the SDK layer is missing).
    const sdk = this.adapter.sdkInfo?.() ?? { present: !(test.requiresVendorSdk ?? false), version: null };
    const deviceTimeMs = test.deviceTimeMs ?? null;
    const clockSkewMs = deviceTimeMs === null ? null : deviceTimeMs - Date.now();
    const skewExceeded = clockSkewMs !== null && Math.abs(clockSkewMs) > GatewayService.CLOCK_SKEW_WARN_MS;
    return {
      adapterType: this.adapter.type,
      adapterOk: test.ok,
      adapterMessage: test.message,
      requiresVendorSdk: test.requiresVendorSdk ?? false,
      sdk_present: sdk.present,
      sdk_version: sdk.version,
      last_test_connection: {
        ok: test.ok,
        status: test.status,
        requiresVendorSdk: test.requiresVendorSdk ?? false,
        message: test.message,
        deviceTimeMs,
      },
      clock_skew_ms: clockSkewMs,
      ...(skewExceeded
        ? {
            clock_skew_warning:
              `Device clock skew is ${Math.round(Math.abs(clockSkewMs!) / 1000)}s (limit 60s). ` +
              "Fix the device clock before go-live — see NATIVE_PROTOCOLS.md validation checklist item 1.",
          }
        : {}),
      pendingBatches: pending.length,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      lastFlushAt: this.lastFlushAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }
}
