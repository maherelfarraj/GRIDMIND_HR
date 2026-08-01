import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GatewayService } from "../service.js";
import { EncryptedQueue } from "../queue.js";
import type { DeviceAdapter, GatewayPunch } from "../types.js";
import type { HrClient } from "../hrClient.js";

/** Adapter that emits a fixed batch once, then nothing. */
class OnceAdapter implements DeviceAdapter {
  readonly type = "SIMULATOR" as const;
  private emitted = false;
  constructor(private readonly punches: GatewayPunch[]) {}
  async testConnection() {
    return { ok: true, status: "REACHABLE" as const, message: "ok" };
  }
  async poll(sinceCursor: string | null) {
    if (this.emitted) return { punches: [], nextCursor: sinceCursor };
    this.emitted = true;
    return { punches: this.punches, nextCursor: "1" };
  }
}

const punch = (n: number): GatewayPunch => ({
  deviceUserId: "E-1",
  eventTime: new Date(Date.UTC(2030, 5, 12, 6, 0, n)).toISOString(),
  eventType: "CLOCK_IN",
  deviceEventUid: `u-${n}`,
});

/** HR client stub: accepts uploads, scripts reconcile responses, records calls. */
function fakeHr(reconcileResponder: (batches: Array<{ batchUuid: string; eventCount: number }>) => Array<{ batchUuid: string; status: string }>) {
  const calls: Array<Array<{ batchUuid: string; eventCount: number }>> = [];
  return {
    calls,
    client: {
      uploadBatch: async () => ({ status: 201, body: { ok: true, inserted: 1, duplicates: 0, unmapped: 0, errors: 0 } }),
      heartbeat: async () => ({ status: 200, body: { ok: true, clockDriftMs: 0, driftAlert: false } }),
      ackCommands: async () => ({ status: 200, body: { ok: true, results: [] } }),
      reconcile: async (batches: Array<{ batchUuid: string; eventCount: number }>) => {
        calls.push(batches);
        return { status: 200, body: { ok: true, results: reconcileResponder(batches) } };
      },
    } as unknown as HrClient,
  };
}

function makeService(dir: string, hr: HrClient, adapter: DeviceAdapter, reconcileIntervalMs?: number) {
  const queue = new EncryptedQueue(join(dir, "q"), "test-key");
  return {
    queue,
    svc: new GatewayService(queue, hr, adapter, {
      cursorPath: join(dir, "cursor.json"),
      sentLogPath: join(dir, "sent-log.json"),
      reconcileIntervalMs,
    }),
  };
}

describe("automatic sent-batch reconciliation", () => {
  it("records delivered batches in a persistent sent-log and reconciles them on tick", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-recon-"));
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "MISSING_ON_SERVER" })));
    const { queue, svc } = makeService(dir, hr.client, new OnceAdapter([punch(0), punch(1)]));
    await queue.init();
    await svc.init();

    await svc.tick(); // poll → flush (delivers) → auto-reconcile
    expect(hr.calls).toHaveLength(1);
    expect(hr.calls[0]).toHaveLength(1);
    expect(hr.calls[0][0].eventCount).toBe(2);
    expect(svc.lastReconcile?.missing).toEqual([hr.calls[0][0].batchUuid]);

    // Sent-log is persisted on disk alongside the queue.
    const raw = JSON.parse(await fsp.readFile(join(dir, "sent-log.json"), "utf8")) as { entries: Array<{ batchUuid: string }> };
    expect(raw.entries.map((e) => e.batchUuid)).toEqual([hr.calls[0][0].batchUuid]);

    // A restarted service restores the sent-log and keeps re-checking the
    // still-missing batch (rate limit elapsed → reconcile again).
    const { svc: svc2 } = makeService(dir, hr.client, new OnceAdapter([]), 60_000);
    await svc2.init();
    const summary = await svc2.maybeReconcile(Date.now() + 61_000);
    expect(summary?.missing).toEqual([hr.calls[0][0].batchUuid]);
    expect(hr.calls).toHaveLength(2);
  });

  it("drops server-confirmed batches from the sent-log and rate-limits reconcile calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-recon-"));
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "OK" })));
    const { queue, svc } = makeService(dir, hr.client, new OnceAdapter([punch(0)]));
    await queue.init();
    await svc.init();

    await svc.tick();
    expect(hr.calls).toHaveLength(1);
    expect(svc.lastReconcile?.missing).toEqual([]);

    // Confirmed batch was removed — nothing left to reconcile.
    expect(await svc.maybeReconcile(Date.now() + 999_999_999)).toBeNull();
    expect(hr.calls).toHaveLength(1);
    const raw = JSON.parse(await fsp.readFile(join(dir, "sent-log.json"), "utf8")) as { entries: unknown[] };
    expect(raw.entries).toEqual([]);
  });

  it("does not reconcile again before the configured interval elapses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-recon-"));
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "MISSING_ON_SERVER" })));
    const { queue, svc } = makeService(dir, hr.client, new OnceAdapter([punch(0)]), 120_000);
    await queue.init();
    await svc.init();

    await svc.tick();
    expect(hr.calls).toHaveLength(1);
    // Second tick immediately after: rate limit suppresses the reconcile.
    await svc.tick();
    expect(hr.calls).toHaveLength(1);
    // Past the interval it fires again.
    expect(await svc.maybeReconcile(Date.now() + 121_000)).not.toBeNull();
    expect(hr.calls).toHaveLength(2);
  });

  it("prunes sent-log entries past the retention window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-recon-"));
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "MISSING_ON_SERVER" })));
    const { queue, svc } = makeService(dir, hr.client, new OnceAdapter([punch(0)]));
    await queue.init();
    await svc.init();
    await svc.tick();
    expect(hr.calls).toHaveLength(1);

    // Far in the future: the entry is pruned, so no reconcile happens at all.
    const farFuture = Date.now() + GatewayService.DEFAULT_SENT_LOG_RETENTION_MS + 1;
    expect(await svc.maybeReconcile(farFuture)).toBeNull();
    expect(hr.calls).toHaveLength(1);
    const raw = JSON.parse(await fsp.readFile(join(dir, "sent-log.json"), "utf8")) as { entries: unknown[] };
    expect(raw.entries).toEqual([]);
  });
});
