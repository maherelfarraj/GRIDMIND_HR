import { randomUUID } from "crypto";
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
    opts?: { maxAttempts?: number; baseBackoffMs?: number; maxBackoffMs?: number },
  ) {
    this.maxAttempts = opts?.maxAttempts ?? 10;
    this.baseBackoffMs = opts?.baseBackoffMs ?? 30_000;
    this.maxBackoffMs = opts?.maxBackoffMs ?? 15 * 60_000;
  }

  private cursor: string | null = null;
  lastPollAt: Date | null = null;
  lastFlushAt: Date | null = null;
  lastError: string | null = null;

  /** Poll the device adapter and spool everything into the encrypted queue. */
  async pollOnce(): Promise<{ queued: number; batchUuid: string | null }> {
    const { punches, nextCursor } = await this.adapter.poll(this.cursor);
    this.cursor = nextCursor;
    this.lastPollAt = new Date();
    if (punches.length === 0) return { queued: 0, batchUuid: null };
    const batchUuid = randomUUID();
    await this.queue.enqueue({ batchUuid, createdAtMs: Date.now(), attempts: 0, punches });
    return { queued: punches.length, batchUuid };
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

  async status() {
    const pending = await this.queue.pending();
    const test = await this.adapter.testConnection();
    return {
      adapterType: this.adapter.type,
      adapterOk: test.ok,
      adapterMessage: test.message,
      requiresVendorSdk: test.requiresVendorSdk ?? false,
      pendingBatches: pending.length,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      lastFlushAt: this.lastFlushAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }
}
