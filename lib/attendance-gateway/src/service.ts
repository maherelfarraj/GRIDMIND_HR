import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { dirname } from "path";
import { EncryptedQueue } from "./queue.js";
import { HrClient } from "./hrClient.js";
import type { AdapterTestResult, DeviceAdapter, GatewayPunch } from "./types.js";

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
export interface SentLogEntry {
  batchUuid: string;
  eventCount: number;
  sentAtMs: number;
}

export interface ReconcileSummary {
  checked: number;
  missing: string[];
  mismatched: string[];
  at: string;
}

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

  /** Skew above this logs a structured warning + flags the heartbeat (default 60s). */
  readonly clockSkewWarnMs: number;

  /** Skew above this hard limit blocks poll() entirely (default 5 min). */
  readonly clockSkewMaxMs: number;

  constructor(
    private readonly queue: EncryptedQueue,
    private readonly hr: HrClient,
    private readonly adapter: DeviceAdapter,
    opts?: {
      maxAttempts?: number; baseBackoffMs?: number; maxBackoffMs?: number; cursorPath?: string;
      clockSkewWarnMs?: number; clockSkewMaxMs?: number;
      sentLogPath?: string; reconcileIntervalMs?: number; sentLogRetentionMs?: number;
    },
  ) {
    this.maxAttempts = opts?.maxAttempts ?? 10;
    this.baseBackoffMs = opts?.baseBackoffMs ?? 30_000;
    this.maxBackoffMs = opts?.maxBackoffMs ?? 15 * 60_000;
    this.clockSkewWarnMs = opts?.clockSkewWarnMs ?? 60_000;
    // The hard limit can never sit below the warning threshold — a config
    // like warn=120s/max=60s would block without ever having warned.
    this.clockSkewMaxMs = Math.max(opts?.clockSkewMaxMs ?? 300_000, this.clockSkewWarnMs);
    this.cursorPath = opts?.cursorPath ?? null;
    this.sentLogPath = opts?.sentLogPath ?? null;
    // Reconcile cadence is rate-limited to at least once per minute so a
    // misconfigured gateway can never spam the server audit log — the server
    // writes one audit row per reconcile request.
    this.reconcileIntervalMs = Math.max(opts?.reconcileIntervalMs ?? GatewayService.DEFAULT_RECONCILE_INTERVAL_MS, 60_000);
    this.sentLogRetentionMs = opts?.sentLogRetentionMs ?? GatewayService.DEFAULT_SENT_LOG_RETENTION_MS;
  }

  /** Default: reconcile recently delivered batches every 15 minutes. */
  static readonly DEFAULT_RECONCILE_INTERVAL_MS = 15 * 60_000;

  /** Default: keep unconfirmed sent-log entries for 7 days before pruning. */
  static readonly DEFAULT_SENT_LOG_RETENTION_MS = 7 * 24 * 60 * 60_000;

  private readonly cursorPath: string | null;

  /** Local record of batches this gateway believes it delivered. */
  private readonly sentLogPath: string | null;

  readonly reconcileIntervalMs: number;

  private readonly sentLogRetentionMs: number;

  private sentLog: SentLogEntry[] = [];

  lastReconcileAt: Date | null = null;

  lastReconcile: ReconcileSummary | null = null;

  private cursor: string | null = null;

  lastPollAt: Date | null = null;

  lastFlushAt: Date | null = null;

  lastError: string | null = null;

  /** Last measured device clock skew (ms); null when unknown/not measured. */
  lastClockSkewMs: number | null = null;

  /** Non-null while polling is blocked because skew exceeds the hard limit. */
  private clockSkewBlockReason: string | null = null;

  /** Restore the persisted adapter cursor (call once at startup). */
  async init(): Promise<void> {
    if (this.cursorPath) {
      try {
        const raw = await fs.readFile(this.cursorPath, "utf8");
        const parsed = JSON.parse(raw) as { cursor?: string | null };
        this.cursor = parsed.cursor ?? null;
      } catch {
        this.cursor = null; // first run / no cursor yet
      }
    }
    if (this.sentLogPath) {
      try {
        const raw = await fs.readFile(this.sentLogPath, "utf8");
        const parsed = JSON.parse(raw) as { entries?: SentLogEntry[] };
        this.sentLog = Array.isArray(parsed.entries)
          ? parsed.entries.filter(
              (e) => typeof e?.batchUuid === "string" && Number.isFinite(e.eventCount) && Number.isFinite(e.sentAtMs),
            )
          : [];
      } catch {
        this.sentLog = []; // first run / no sent log yet
      }
    }
  }

  /** Atomically persist the sent-log (same temp-file + rename pattern as the cursor). */
  private async persistSentLog(): Promise<void> {
    if (!this.sentLogPath) return;
    await fs.mkdir(dirname(this.sentLogPath), { recursive: true });
    const tmp = `${this.sentLogPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ entries: this.sentLog }), "utf8");
    await fs.rename(tmp, this.sentLogPath);
  }

  /**
   * Remember a successfully delivered batch so a later automatic reconcile
   * can verify the server still holds it. Only batch metadata is recorded
   * (uuid, count, time) — never punch payloads — so the log needs no
   * encryption. Persistence failures are non-fatal: delivery already
   * succeeded, and losing a log entry only skips one verification.
   */
  private async recordSent(batchUuid: string, eventCount: number): Promise<void> {
    this.sentLog = this.sentLog.filter((e) => e.batchUuid !== batchUuid);
    this.sentLog.push({ batchUuid, eventCount, sentAtMs: Date.now() });
    try {
      await this.persistSentLog();
    } catch (e) {
      console.warn(`[gateway] failed to persist sent-log: ${e instanceof Error ? e.message : String(e)}`);
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
    if (this.clockSkewBlockReason) throw new Error(this.clockSkewBlockReason);
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
  async tick(): Promise<{ pollError: string | null; heartbeatError: string | null; testRequested: boolean }> {
    // Capture when testConnection() was called — the server uses this to
    // decide whether the result is fresh enough to answer a pending
    // admin-requested connection test (connectionTestRunAt must be ≥
    // connTestRequestedAt). Captured before the call so latency is minimal.
    const connectionTestRunAt = Date.now();
    // testConnection() runs FIRST so the device clock-skew gate applies to
    // this tick's poll (not the next one). The same result feeds the
    // heartbeat below — no second connection round-trip.
    let test: AdapterTestResult | null = null;
    try {
      test = await this.adapter.testConnection();
    } catch (e) {
      // Defensive: adapters return structured failures rather than throwing.
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    const heartbeatTest = test ? this.evaluateClockSkew(test) : null;

    let pollError: string | null = null;
    try {
      await this.pollOnce();
    } catch (e) {
      pollError = e instanceof Error ? e.message : String(e);
      this.lastError = pollError;
    }
    // Flush regardless: previously spooled (pre-skew) batches are still valid.
    try {
      await this.flush();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      pollError = pollError ?? msg;
    }

    // Automatic reconciliation of recently delivered batches: lost/mismatched
    // batches surface on the HR core admin page without any manual trigger.
    // Failures are non-fatal — the next due tick simply tries again.
    try {
      await this.maybeReconcile();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      console.error(`[gateway] automatic reconcile failed: ${msg}`);
    }

    let heartbeatError: string | null = null;
    let testRequested = false;
    try {
      const t = heartbeatTest ?? await this.adapter.testConnection();
      const { body } = await this.hr.heartbeat(t, {
        sdk: this.resolveSdkInfo(t),
        deviceClockSkewMs: GatewayService.computeClockSkewMs(t),
        // Tell the server when this tick ran testConnection() so it can
        // determine whether the result is fresh enough to answer a pending
        // admin-requested test (result must post-date the request).
        connectionTestRunAt,
      });
      testRequested = body.testRequested === true;
      if (testRequested) {
        // testRequested: true means a test is still pending — the result in
        // this heartbeat pre-dates the admin's request. The scheduler will
        // fire a nudge tick so the next heartbeat carries a fresh result.
        console.info(JSON.stringify({
          level: "info",
          event: "conn_test_pending",
          adapterType: this.adapter.type,
          message: "Admin-requested connection test outstanding — scheduling early tick to deliver a fresh result",
        }));
      }
      if (Array.isArray(body.commands) && body.commands.length > 0) {
        await this.executeCommands(body.commands);
      }
    } catch (e) {
      heartbeatError = e instanceof Error ? e.message : String(e);
      this.lastError = heartbeatError;
    }
    return { pollError, heartbeatError, testRequested };
  }

  /**
   * Execute remote commands delivered in a heartbeat response and ack every
   * outcome — including failures and unsupported operations — so the HR core
   * never waits on a command that can't run here.
   */
  private async executeCommands(commands: Array<{ id: number; command: string; deviceSerial?: string | null }>): Promise<void> {
    const acks: Array<{ commandId: number; ok: boolean; message?: string }> = [];
    for (const cmd of commands) {
      if (cmd.command === "RECONCILE") {
        // HR-admin-requested immediate reconcile: same bypass semantics as
        // the operator's local /reconcile endpoint (skips the local rate
        // limit; server-side audit dedupe still applies).
        try {
          const summary = await this.reconcileNow();
          acks.push({
            commandId: cmd.id,
            ok: true,
            message: summary
              ? `Reconciled ${summary.checked} batch${summary.checked === 1 ? "" : "es"}: ${summary.missing.length} missing, ${summary.mismatched.length} count mismatch`
              : "Nothing to reconcile — no unconfirmed batches in the sent-log",
          });
        } catch (e) {
          acks.push({ commandId: cmd.id, ok: false, message: e instanceof Error ? e.message : String(e) });
        }
        continue;
      }
      if (cmd.command !== "RESTART") {
        acks.push({ commandId: cmd.id, ok: false, message: `Unsupported command: ${cmd.command}` });
        continue;
      }
      if (!this.adapter.restartDevice) {
        acks.push({ commandId: cmd.id, ok: false, message: `Adapter ${this.adapter.type} does not support remote restart` });
        continue;
      }
      try {
        const result = await this.adapter.restartDevice({ serial: cmd.deviceSerial ?? null });
        acks.push({ commandId: cmd.id, ok: result.ok, message: result.message });
      } catch (e) {
        acks.push({ commandId: cmd.id, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    if (acks.length > 0) await this.hr.ackCommands(acks);
  }

  /**
   * Enforce the device clock-skew policy on a fresh testConnection() result:
   * warn past the soft threshold, block polling past the hard limit.
   * Returns the (possibly annotated) test result to send as the heartbeat.
   */
  private evaluateClockSkew(test: AdapterTestResult): AdapterTestResult {
    const skew = test.ok && typeof test.clockSkewMs === "number" ? test.clockSkewMs : null;
    this.lastClockSkewMs = skew;
    if (skew === null || skew <= this.clockSkewWarnMs) {
      this.clockSkewBlockReason = null;
      return test;
    }
    const blocked = skew > this.clockSkewMaxMs;
    const warning = blocked
      ? `Device clock skew ${skew}ms exceeds hard limit ${this.clockSkewMaxMs}ms — punch polling is BLOCKED until the device clock is corrected (sync the device time, then re-test the connection)`
      : `Device clock skew ${skew}ms exceeds warning threshold ${this.clockSkewWarnMs}ms — fix the device clock before punch timestamps drift further`;
    console.warn(JSON.stringify({
      level: "warn",
      event: "device_clock_skew",
      adapterType: this.adapter.type,
      clockSkewMs: skew,
      warnThresholdMs: this.clockSkewWarnMs,
      hardLimitMs: this.clockSkewMaxMs,
      pollBlocked: blocked,
      message: warning,
    }));
    this.clockSkewBlockReason = blocked ? warning : null;
    if (blocked) this.lastError = warning;
    return { ...test, message: `${test.message} — ${warning}` };
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
          await this.recordSent(batch.batchUuid, batch.punches.length);
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

  /**
   * Periodic sent-log reconciliation. Rate-limited by reconcileIntervalMs so
   * it never spams the server audit log (one audit row per reconcile call):
   *  - entries the server confirms OK are dropped from the sent-log;
   *  - MISSING/COUNT_MISMATCH entries stay so every reconcile keeps
   *    re-reporting them until an operator resolves the loss;
   *  - entries older than the retention window are pruned (with a warning)
   *    so the log cannot grow without bound.
   * Returns null when skipped (nothing to check or not yet due).
   */
  async maybeReconcile(nowMs: number = Date.now()): Promise<ReconcileSummary | null> {
    await this.pruneSentLog(nowMs);
    if (this.sentLog.length === 0) return null;
    if (this.lastReconcileAt && nowMs - this.lastReconcileAt.getTime() < this.reconcileIntervalMs) return null;
    return this.runReconcile(nowMs);
  }

  /**
   * Operator-triggered reconcile: bypasses the local rate limit so an on-site
   * operator can get a fresh verdict immediately. Server-side audit dedupe
   * still applies (the server writes/dedupes its own audit rows), and running
   * this also resets the local rate-limit window, so a manual check never
   * ADDS to the automatic cadence. Returns null when the sent-log is empty
   * (nothing to check).
   */
  async reconcileNow(nowMs: number = Date.now()): Promise<ReconcileSummary | null> {
    await this.pruneSentLog(nowMs);
    if (this.sentLog.length === 0) return null;
    return this.runReconcile(nowMs);
  }

  /** Prune sent-log entries past the retention window (with a warning). */
  private async pruneSentLog(nowMs: number): Promise<void> {
    const expired = this.sentLog.filter((e) => nowMs - e.sentAtMs > this.sentLogRetentionMs);
    if (expired.length > 0) {
      console.warn(
        `[gateway] pruning ${expired.length} sent-log entr${expired.length === 1 ? "y" : "ies"} past retention without server confirmation: ${expired.map((e) => e.batchUuid).join(", ")}`,
      );
      this.sentLog = this.sentLog.filter((e) => nowMs - e.sentAtMs <= this.sentLogRetentionMs);
      await this.persistSentLog();
    }
  }

  private async runReconcile(nowMs: number): Promise<ReconcileSummary> {
    const known = this.sentLog.map((e) => ({ batchUuid: e.batchUuid, eventCount: e.eventCount }));
    const { status, body } = await this.hr.reconcile(known);
    if (status !== 200 || !Array.isArray(body.results)) {
      throw new Error(`reconcile request failed with HTTP ${status}`);
    }
    this.lastReconcileAt = new Date(nowMs);
    const missing = body.results.filter((r) => r.status === "MISSING_ON_SERVER").map((r) => r.batchUuid);
    const mismatched = body.results.filter((r) => r.status === "COUNT_MISMATCH").map((r) => r.batchUuid);
    const confirmed = new Set(body.results.filter((r) => r.status === "OK").map((r) => r.batchUuid));
    if (confirmed.size > 0) {
      this.sentLog = this.sentLog.filter((e) => !confirmed.has(e.batchUuid));
      await this.persistSentLog();
    }
    const summary: ReconcileSummary = {
      checked: body.results.length,
      missing,
      mismatched,
      at: new Date(nowMs).toISOString(),
    };
    this.lastReconcile = summary;
    if (missing.length > 0 || mismatched.length > 0) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "reconcile_discrepancy",
        missing,
        mismatched,
        message: "Server is missing or disagrees with locally delivered punch batches — check the HR core gateway page",
      }));
    }
    return summary;
  }

  /** Clock skew beyond this (either direction) breaches runbook validation checklist item 1. */
  static readonly CLOCK_SKEW_WARN_MS = 60_000;

  async status() {
    const uuids = await this.queue.pending();
    let pendingCount = 0;
    let terminalCount = 0;
    for (const uuid of uuids) {
      const batch = await this.queue.read(uuid);
      if (!batch) continue;
      if (batch.terminal) terminalCount++;
      else pendingCount++;
    }
    const test = await this.adapter.testConnection();
    const sdk = this.resolveSdkInfo(test);
    const deviceTimeMs = test.deviceTimeMs ?? null;
    const clockSkewMs = GatewayService.computeClockSkewMs(test);
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
      // Terminal batches are no longer counted as pending — they will never
      // be auto-retried and need explicit operator action (requeue).
      pendingBatches: pendingCount,
      terminalBatches: terminalCount,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      lastFlushAt: this.lastFlushAt?.toISOString() ?? null,
      lastError: this.lastError,
      // Automatic reconciliation state: how many delivered batches still
      // await server confirmation, and the last reconcile outcome.
      unconfirmedSentBatches: this.sentLog.length,
      lastReconcileAt: this.lastReconcileAt?.toISOString() ?? null,
      lastReconcile: this.lastReconcile,
      reconcileIntervalMs: this.reconcileIntervalMs,
      clockSkewMs: typeof test.clockSkewMs === "number" ? test.clockSkewMs : this.lastClockSkewMs,
      clockSkewBlocked: this.clockSkewBlockReason !== null,
    };
  }

  /**
   * List batches that exhausted their delivery attempts and were marked
   * terminal — kept encrypted on disk, never auto-retried. Operators inspect
   * these and requeue them once the underlying failure is fixed.
   */
  async listTerminalBatches(): Promise<
    Array<{ batchUuid: string; createdAtMs: number; attempts: number; punchCount: number }>
  > {
    const out: Array<{ batchUuid: string; createdAtMs: number; attempts: number; punchCount: number }> = [];
    for (const uuid of await this.queue.pending()) {
      const batch = await this.queue.read(uuid);
      if (batch?.terminal) {
        out.push({
          batchUuid: batch.batchUuid,
          createdAtMs: batch.createdAtMs,
          attempts: batch.attempts,
          punchCount: batch.punches.length,
        });
      }
    }
    return out;
  }

  /**
   * Operator recovery: reset a batch's attempts/terminal state so the next
   * flush retries it immediately. Returns null when the batch is unknown.
   */
  async requeueBatch(batchUuid: string): Promise<{ batchUuid: string; punchCount: number } | null> {
    const batch = await this.queue.read(batchUuid);
    if (!batch) return null;
    batch.attempts = 0;
    delete batch.terminal;
    delete batch.nextAttemptAtMs;
    await this.queue.enqueue(batch);
    return { batchUuid: batch.batchUuid, punchCount: batch.punches.length };
  }

  /**
   * Last-resort recovery: export a spooled batch's punches as CSV compatible
   * with the CSV import path (parseCsvPunches). Only punch metadata is
   * emitted — the `raw` field (and anything else) never leaves the spool, so
   * no vendor payloads or biometric-adjacent data can end up in the file.
   * Only TERMINAL batches are exportable — a pending/retrying batch is still
   * on the automatic delivery path and must not be pulled out of it early.
   * Returns null when the batch is unknown or not terminal (indistinguishable
   * on purpose: no disclosure about non-exportable batches).
   */
  async exportBatchCsv(batchUuid: string): Promise<{ batchUuid: string; punchCount: number; csv: string } | null> {
    const batch = await this.queue.read(batchUuid);
    if (!batch || !batch.terminal) return null;
    const clean = (v: string | number | undefined, field: string): string => {
      const s = v === undefined ? "" : String(v);
      if (/[,\r\n"]/.test(s)) {
        // The CSV import parser splits naively on commas; refuse to emit a
        // file it would mis-parse rather than silently corrupt punches.
        throw new Error(`cannot export batch ${batchUuid}: ${field} value contains a comma/quote/newline`);
      }
      return s;
    };
    const rows = batch.punches.map((p) =>
      [
        clean(p.deviceUserId, "device_user_id"),
        clean(p.employeeId, "employee_id"),
        clean(p.eventTime, "event_time"),
        clean(p.eventType, "event_type"),
        clean(p.deviceEventUid, "event_uid"),
      ].join(","),
    );
    const csv = ["device_user_id,employee_id,event_time,event_type,event_uid", ...rows].join("\n") + "\n";
    return { batchUuid: batch.batchUuid, punchCount: batch.punches.length, csv };
  }

  /**
   * Operator discard: permanently remove a terminal batch from the encrypted
   * spool once its punches have been recovered via another path (e.g. CSV
   * export → re-import).
   *
   * Safety gate: unless `force` is set, the method first asks the HR core to
   * confirm it holds this batch at the expected punch count. If the server
   * returns anything other than OK (MISSING_ON_SERVER, COUNT_MISMATCH, or a
   * network error), the discard is refused — the operator must either fix the
   * discrepancy or pass `force: true` to override.
   *
   * Returns:
   *  { ok: true, punchCount }                       — batch discarded
   *  { ok: false, reason: "NOT_FOUND" }             — unknown or non-terminal
   *  { ok: false, reason: "NOT_CONFIRMED",
   *    serverStatus: string }                        — server check failed
   */
  async discardBatch(
    batchUuid: string,
    opts?: { force?: boolean },
  ): Promise<
    | { ok: true; punchCount: number }
    | { ok: false; reason: "NOT_FOUND" }
    | { ok: false; reason: "NOT_CONFIRMED"; serverStatus: string }
  > {
    const batch = await this.queue.read(batchUuid);
    if (!batch || !batch.terminal) return { ok: false, reason: "NOT_FOUND" };

    if (!opts?.force) {
      try {
        const { status, body } = await this.hr.reconcile([{ batchUuid: batch.batchUuid, eventCount: batch.punches.length }]);
        if (status !== 200 || !Array.isArray(body.results) || body.results.length === 0) {
          return { ok: false, reason: "NOT_CONFIRMED", serverStatus: `reconcile failed with HTTP ${status}` };
        }
        const result = body.results[0];
        if (result.status !== "OK") {
          return { ok: false, reason: "NOT_CONFIRMED", serverStatus: result.status };
        }
      } catch (e) {
        return { ok: false, reason: "NOT_CONFIRMED", serverStatus: e instanceof Error ? e.message : String(e) };
      }
    }

    await this.queue.remove(batchUuid);
    return { ok: true, punchCount: batch.punches.length };
  }

  /**
   * sdk_present: adapters expose sdkInfo() when they load a native vendor
   * SDK; otherwise infer from the connection test (an adapter that flags
   * requiresVendorSdk on failure is telling us the SDK layer is missing).
   */
  private resolveSdkInfo(test: { requiresVendorSdk?: boolean }): { present: boolean; version: string | null } {
    return this.adapter.sdkInfo?.() ?? { present: !(test.requiresVendorSdk ?? false), version: null };
  }

  /** Device↔gateway clock skew from the connection test, or null when unknown. */
  static computeClockSkewMs(test: { deviceTimeMs?: number | null }): number | null {
    const deviceTimeMs = test.deviceTimeMs ?? null;
    return deviceTimeMs === null ? null : deviceTimeMs - Date.now();
  }
}
