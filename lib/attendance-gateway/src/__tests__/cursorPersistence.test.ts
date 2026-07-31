import { describe, it, expect, vi, afterEach } from "vitest";
import { promises as fsp } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GatewayService } from "../service.js";
import { EncryptedQueue } from "../queue.js";
import type { DeviceAdapter, GatewayPunch } from "../types.js";
import type { HrClient } from "../hrClient.js";

/** Adapter that pages through a fixed punch list, one punch per poll. */
class StepAdapter implements DeviceAdapter {
  readonly type = "SIMULATOR" as const;
  pollCalls: Array<string | null> = [];
  constructor(private readonly punches: GatewayPunch[]) {}
  async testConnection() {
    return { ok: true, status: "REACHABLE" as const, message: "ok" };
  }
  async poll(sinceCursor: string | null) {
    this.pollCalls.push(sinceCursor);
    const idx = sinceCursor ? parseInt(sinceCursor, 10) : 0;
    if (idx >= this.punches.length) return { punches: [], nextCursor: sinceCursor };
    return { punches: [this.punches[idx]], nextCursor: String(idx + 1) };
  }
}

const punch = (n: number): GatewayPunch => ({
  deviceUserId: "E-1",
  eventTime: new Date(Date.UTC(2030, 5, 12, 6, 0, n)).toISOString(),
  eventType: "CLOCK_IN",
  deviceEventUid: `u-${n}`,
});

const fakeHr = {} as unknown as HrClient;

describe("GatewayService cursor durability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists the cursor and restores it after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cursor-"));
    const cursorPath = join(dir, "device-cursor.json");
    const queue = new EncryptedQueue(join(dir, "q"), "test-key");
    await queue.init();
    const adapter = new StepAdapter([punch(0), punch(1), punch(2)]);

    const svc1 = new GatewayService(queue, fakeHr, adapter, { cursorPath });
    await svc1.init();
    await svc1.pollOnce(); // consumes punch 0, cursor → "1"

    // simulate a process restart: fresh service instance, same cursor file
    const svc2 = new GatewayService(queue, fakeHr, adapter, { cursorPath });
    await svc2.init();
    const res = await svc2.pollOnce();
    expect(res.queued).toBe(1);
    // the restarted service resumed from the persisted cursor, not from scratch
    expect(adapter.pollCalls).toEqual([null, "1"]);
  });

  it("does not advance the cursor when the queue write fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cursor-"));
    const cursorPath = join(dir, "device-cursor.json");
    const queue = new EncryptedQueue(join(dir, "q"), "test-key");
    await queue.init();
    const failingQueue = Object.create(queue) as EncryptedQueue;
    let fail = true;
    failingQueue.enqueue = async (batch) => {
      if (fail) throw new Error("disk full");
      return queue.enqueue(batch);
    };

    const adapter = new StepAdapter([punch(0), punch(1)]);
    const svc = new GatewayService(failingQueue, fakeHr, adapter, { cursorPath });
    await svc.init();

    await expect(svc.pollOnce()).rejects.toThrow("disk full");
    fail = false;
    const res = await svc.pollOnce();
    expect(res.queued).toBe(1);
    // second poll replayed from the SAME cursor — the punch was not lost
    expect(adapter.pollCalls).toEqual([null, null]);
  });

  it("does not advance the in-memory cursor when cursor persistence fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cursor-"));
    const cursorPath = join(dir, "device-cursor.json");
    const queue = new EncryptedQueue(join(dir, "q"), "test-key");
    await queue.init();
    const adapter = new StepAdapter([punch(0), punch(1)]);
    const svc = new GatewayService(queue, fakeHr, adapter, { cursorPath });
    await svc.init();

    // inject a one-time failure of the atomic rename step
    const realRename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, "rename").mockRejectedValueOnce(new Error("disk pulled"));
    await expect(svc.pollOnce()).rejects.toThrow("disk pulled");
    vi.mocked(fsp.rename).mockImplementation(realRename);

    const res = await svc.pollOnce();
    expect(res.queued).toBe(1);
    // the failed commit kept the OLD cursor — the same punch was re-polled
    expect(adapter.pollCalls).toEqual([null, null]);

    // and once persistence works, a restart resumes from the committed cursor
    const svc2 = new GatewayService(queue, fakeHr, adapter, { cursorPath });
    await svc2.init();
    await svc2.pollOnce();
    expect(adapter.pollCalls).toEqual([null, null, "1"]);
  });
});
