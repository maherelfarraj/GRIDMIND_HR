import { describe, it, expect, vi, afterEach } from "vitest";
import { promises as fsp } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GatewayService } from "../service.js";
import { EncryptedQueue } from "../queue.js";
import type { DeviceAdapter, GatewayPunch } from "../types.js";
import type { HrClient } from "../hrClient.js";

/**
 * Service-level restart test: proves the WHOLE chain — adapter cursor +
 * cursor-file persistence + encrypted queue — loses nothing and duplicates
 * nothing when the gateway process dies mid-backlog and a fresh instance is
 * started against the same on-disk state.
 */

/** Adapter that pages through a device backlog, `pageSize` punches per poll. */
class BacklogAdapter implements DeviceAdapter {
  readonly type = "SIMULATOR" as const;
  pollCalls: Array<string | null> = [];
  constructor(private readonly punches: GatewayPunch[], private readonly pageSize: number) {}
  async testConnection() {
    return { ok: true, status: "REACHABLE" as const, message: "ok" };
  }
  async poll(sinceCursor: string | null) {
    this.pollCalls.push(sinceCursor);
    const idx = sinceCursor ? parseInt(sinceCursor, 10) : 0;
    if (idx >= this.punches.length) return { punches: [], nextCursor: sinceCursor };
    const page = this.punches.slice(idx, idx + this.pageSize);
    return { punches: page, nextCursor: String(idx + page.length) };
  }
}

const punch = (n: number): GatewayPunch => ({
  deviceUserId: "E-1",
  eventTime: new Date(Date.UTC(2030, 5, 12, 6, 0, n)).toISOString(),
  eventType: "CLOCK_IN",
  deviceEventUid: `u-${n}`,
});

const fakeHr = {} as unknown as HrClient;

/** Read every batch left in the queue and return all deviceEventUids, in enqueue order. */
async function queueUids(queue: EncryptedQueue): Promise<string[]> {
  const uids: string[] = [];
  for (const uuid of await queue.pending()) {
    const batch = await queue.read(uuid);
    if (!batch) continue;
    for (const p of batch.punches) uids.push(p.deviceEventUid!);
  }
  return uids;
}

describe("GatewayService restart mid-backlog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a fresh service instance resumes from the persisted cursor with no gaps and no duplicates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-restart-"));
    const cursorPath = join(dir, "device-cursor.json");
    const total = 10;
    const backlog = Array.from({ length: total }, (_, n) => punch(n));

    // ---- Process #1: drains part of the backlog, then "dies" mid-way. ----
    {
      const queue1 = new EncryptedQueue(join(dir, "q"), "test-key");
      await queue1.init();
      const adapter1 = new BacklogAdapter(backlog, 3);
      const svc1 = new GatewayService(queue1, fakeHr, adapter1, { cursorPath });
      await svc1.init();
      await svc1.pollOnce(); // punches 0-2 spooled, cursor → "3"
      await svc1.pollOnce(); // punches 3-5 spooled, cursor → "6"
      // Process killed here: svc1, queue1 and adapter1 are abandoned. Nothing
      // in memory survives — only the cursor file and the encrypted spool.
    }

    // ---- Process #2: brand-new instances against the same on-disk state. ----
    const queue2 = new EncryptedQueue(join(dir, "q"), "test-key");
    await queue2.init();
    const adapter2 = new BacklogAdapter(backlog, 3);
    const svc2 = new GatewayService(queue2, fakeHr, adapter2, { cursorPath });
    await svc2.init();

    // Drain the rest of the backlog.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { queued } = await svc2.pollOnce();
      if (queued === 0) break;
    }

    // The restarted service resumed exactly where the dead process left off —
    // never from scratch, never skipping ahead.
    expect(adapter2.pollCalls[0]).toBe("6");

    // End-to-end guarantee: the queue holds every punch exactly once.
    const uids = await queueUids(queue2);
    expect(uids).toHaveLength(total);
    expect(new Set(uids).size).toBe(total); // no duplicates
    expect([...uids].sort()).toEqual(backlog.map((p) => p.deviceEventUid!).sort()); // no gaps
  });

  it("a crash between spool and cursor-commit replays the batch rather than losing it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-restart-"));
    const cursorPath = join(dir, "device-cursor.json");
    const total = 6;
    const backlog = Array.from({ length: total }, (_, n) => punch(n));

    // ---- Process #1: killed at the worst possible instant — the batch is
    // durably spooled but the cursor rename never lands on disk. ----
    {
      const queue1 = new EncryptedQueue(join(dir, "q"), "test-key");
      await queue1.init();
      const adapter1 = new BacklogAdapter(backlog, 2);
      const svc1 = new GatewayService(queue1, fakeHr, adapter1, { cursorPath });
      await svc1.init();
      await svc1.pollOnce(); // punches 0-1, cursor committed → "2"

      // Kill the process during the SECOND pollOnce's cursor commit: fail
      // renames targeting the cursor file only (the queue's own atomic rename
      // must keep working — the spool write happens first and succeeds).
      const realRename = fsp.rename.bind(fsp);
      vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
        if (String(to) === cursorPath) throw new Error("process killed");
        return realRename(from, to);
      });
      await expect(svc1.pollOnce()).rejects.toThrow("process killed"); // punches 2-3 spooled, cursor NOT advanced
      vi.mocked(fsp.rename).mockImplementation(realRename);

      // Punches 2-3 are already in the encrypted spool from the dead process.
      expect(await queueUids(queue1)).toEqual(["u-0", "u-1", "u-2", "u-3"]);
    }

    // ---- Process #2: restart against the same cursor file + spool. ----
    const queue2 = new EncryptedQueue(join(dir, "q"), "test-key");
    await queue2.init();
    const adapter2 = new BacklogAdapter(backlog, 2);
    const svc2 = new GatewayService(queue2, fakeHr, adapter2, { cursorPath });
    await svc2.init();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { queued } = await svc2.pollOnce();
      if (queued === 0) break;
    }

    // The un-committed page was REPLAYED (cursor file still said "2") …
    expect(adapter2.pollCalls[0]).toBe("2");

    const uids = await queueUids(queue2);
    // … so the spool contains a duplicate of exactly that page (u-2, u-3) and
    // nothing is missing. Duplicates are safe by design: server-side
    // deviceEventUid dedupe absorbs them; a gap could never be recovered.
    const uniques = new Set(uids);
    expect([...uniques].sort()).toEqual(backlog.map((p) => p.deviceEventUid!).sort()); // no gaps
    const dupes = uids.filter((u, i) => uids.indexOf(u) !== i);
    expect(dupes.sort()).toEqual(["u-2", "u-3"]); // only the interrupted page repeats
  });
});
