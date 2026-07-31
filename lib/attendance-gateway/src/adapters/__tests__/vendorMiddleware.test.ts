import { describe, it, expect } from "vitest";
import { ZktecoAdapter, SupremaAdapter } from "../vendorStubs.js";

/** Minimal mock fetch: route → handler(url, init). */
function mockFetch(routes: Array<{ match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Response }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url, init));
    if (!route) return new Response("not found", { status: 404 });
    return route.respond(url, init);
  }) as typeof fetch;
}

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const uids = (punches: Array<{ deviceEventUid?: string }>): string[] => punches.map((p) => p.deviceEventUid!);

// ─── ZKTeco ──────────────────────────────────────────────────────────────────

describe("ZKTeco adapter (unconfigured — vendor SDK/middleware unavailable)", () => {
  it("reports the dependency clearly instead of pretending to work", async () => {
    const adapter = new ZktecoAdapter();
    const test = await adapter.testConnection();
    expect(test.ok).toBe(false);
    expect(test.requiresVendorSdk).toBe(true);
    await expect(adapter.poll(null)).rejects.toThrow(/vendor SDK/i);
  });
});

describe("ZKTeco adapter (ZKBioTime middleware configured)", () => {
  const cfg = { baseUrl: "http://biotime.local:8000", username: "gw", password: "pw" };

  /**
   * ZKBioTime mock with token auth, start_time filtering, and `next`-link
   * pagination over a mutable row store.
   */
  function zkServer(rows: Array<Record<string, unknown>>, pageSize = 200) {
    let authed = false;
    return mockFetch([
      {
        match: (u) => u.includes("/api-token-auth/"),
        respond: () => { authed = true; return json({ token: "tok-1" }); },
      },
      {
        match: (u) => u.includes("/iclock/api/transactions/"),
        respond: (u, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          if (!authed || headers?.authorization !== "Token tok-1") return new Response("unauthorized", { status: 401 });
          const url = new URL(u);
          const start = url.searchParams.get("start_time");
          const page = parseInt(url.searchParams.get("page") ?? "1", 10);
          const filtered = rows.filter((r) => !start || String(r.punch_time) >= start); // inclusive, like ZKBioTime
          const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
          const hasMore = filtered.length > page * pageSize;
          const nextUrl = new URL(u);
          nextUrl.searchParams.set("page", String(page + 1));
          return json({ data: slice, next: hasMore ? nextUrl.toString() : null });
        },
      },
    ]);
  }

  const baseRows = [
    { id: 101, emp_code: "E-9", punch_time: "2030-06-12 05:00:00", punch_state: "0", verify_type: 1, fingerprint_data: "RAW_TEMPLATE_BYTES" },
    { id: 102, emp_code: "E-9", punch_time: "2030-06-12 14:00:00", punch_state: "1", template: "MORE_RAW" },
    { id: 103, emp_code: "E-9", punch_time: "2030-06-12 15:00:00", punch_state: "99" }, // unknown state → skipped
  ];

  it("authenticates, polls transactions, maps punch states, strips biometric fields", async () => {
    const adapter = new ZktecoAdapter(cfg, zkServer([...baseRows]));
    expect((await adapter.testConnection()).ok).toBe(true);

    const { punches } = await adapter.poll(null);
    expect(punches).toHaveLength(2); // unknown punch_state dropped
    expect(punches[0]).toMatchObject({ deviceUserId: "E-9", eventType: "CLOCK_IN", deviceEventUid: "zk-101" });
    expect(punches[1].eventType).toBe("CLOCK_OUT");
    const serialized = JSON.stringify(punches);
    expect(serialized).not.toContain("RAW_TEMPLATE_BYTES");
    expect(serialized).not.toContain("fingerprint_data");
    expect(serialized).not.toContain("template");
  });

  it("does not lose a same-timestamp punch that appears after the cursor was advanced", async () => {
    const rows = [...baseRows];
    const server = zkServer(rows);
    const adapter = new ZktecoAdapter(cfg, server);
    const first = await adapter.poll(null);
    expect(uids(first.punches)).toEqual(["zk-101", "zk-102"]);

    // A second employee's punch lands at EXACTLY the watermark timestamp,
    // then a later punch arrives too.
    rows.push({ id: 104, emp_code: "E-7", punch_time: "2030-06-12 14:00:00", punch_state: "1" });
    rows.push({ id: 105, emp_code: "E-7", punch_time: "2030-06-12 16:00:00", punch_state: "0" });

    const second = await adapter.poll(first.nextCursor);
    expect(uids(second.punches)).toEqual(["zk-104", "zk-105"]); // 101/102 not re-emitted, 104 NOT lost

    const third = await adapter.poll(second.nextCursor);
    expect(third.punches).toHaveLength(0);
  });

  it("drains a backlog larger than the per-poll page budget without losing events", async () => {
    // 20 pages × 5 rows/page budget in this mock: use pageSize 5 and 150 rows → needs 2 polls
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 150; i += 1) {
      const mm = String(Math.floor(i / 60)).padStart(2, "0");
      const ss = String(i % 60).padStart(2, "0");
      rows.push({ id: 1000 + i, emp_code: "E-1", punch_time: `2030-06-12 06:${mm}:${ss}`, punch_state: "0" });
    }
    const adapter = new ZktecoAdapter(cfg, zkServer(rows, 5));
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let poll = 0; poll < 5; poll += 1) {
      const res = await adapter.poll(cursor);
      for (const p of res.punches) {
        expect(seen.has(p.deviceEventUid!)).toBe(false); // no duplicates within the run
        seen.add(p.deviceEventUid!);
      }
      cursor = res.nextCursor;
      if (res.punches.length === 0) break;
    }
    expect(seen.size).toBe(150); // every event delivered exactly once
  });

  it("emits every row even when the middleware returns pages in descending/unsorted order", async () => {
    // Same data as baseRows plus more, but the server returns rows NEWEST-first.
    const rows = [
      { id: 205, emp_code: "E-2", punch_time: "2030-06-12 16:00:00", punch_state: "1" },
      { id: 204, emp_code: "E-2", punch_time: "2030-06-12 15:30:00", punch_state: "0" },
      { id: 203, emp_code: "E-1", punch_time: "2030-06-12 15:30:00", punch_state: "0" },
      { id: 202, emp_code: "E-1", punch_time: "2030-06-12 14:00:00", punch_state: "1" },
      { id: 201, emp_code: "E-1", punch_time: "2030-06-12 05:00:00", punch_state: "0" },
    ];
    const fetchImpl = mockFetch([
      { match: (u) => u.includes("/api-token-auth/"), respond: () => json({ token: "tok-1" }) },
      {
        match: (u) => u.includes("/iclock/api/transactions/"),
        respond: () => json({ data: rows, next: null }), // descending order
      },
    ]);
    const adapter = new ZktecoAdapter(cfg, fetchImpl);
    const first = await adapter.poll(null);
    // ALL five rows are emitted despite descending order (none discarded mid-poll)
    expect(uids(first.punches).sort()).toEqual(["zk-201", "zk-202", "zk-203", "zk-204", "zk-205"]);

    // replaying the same (unsorted) data against the resulting cursor only
    // re-emits rows not yet at/behind the boundary — here, nothing
    const second = await adapter.poll(first.nextCursor);
    expect(second.punches).toHaveLength(0);
  });

  it("re-authenticates once when the token expires", async () => {
    let tokenGen = 0;
    let validToken = "";
    const fetchImpl = mockFetch([
      {
        match: (u) => u.includes("/api-token-auth/"),
        respond: () => { tokenGen += 1; validToken = `tok-${tokenGen}`; return json({ token: validToken }); },
      },
      {
        match: (u) => u.includes("/iclock/api/transactions/"),
        respond: (_u, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          if (headers?.authorization === "Token tok-1") return new Response("expired", { status: 401 });
          if (headers?.authorization !== `Token ${validToken}`) return new Response("unauthorized", { status: 401 });
          return json({ data: [], next: null });
        },
      },
    ]);
    const adapter = new ZktecoAdapter(cfg, fetchImpl);
    const res = await adapter.poll(null);
    expect(res.punches).toHaveLength(0);
    expect(tokenGen).toBe(2);
  });
});

// ─── Suprema ─────────────────────────────────────────────────────────────────

describe("Suprema adapter (unconfigured — vendor SDK/middleware unavailable)", () => {
  it("reports the dependency clearly instead of pretending to work", async () => {
    const adapter = new SupremaAdapter();
    const test = await adapter.testConnection();
    expect(test.ok).toBe(false);
    expect(test.requiresVendorSdk).toBe(true);
    await expect(adapter.poll(null)).rejects.toThrow(/vendor SDK/i);
  });
});

describe("Suprema adapter (BioStar 2 server configured)", () => {
  const cfg = { baseUrl: "https://biostar.local", loginId: "gw", password: "pw" };

  /** BioStar 2 mock: session login + events/search with conditions/offset/limit. */
  function bsServer(rows: Array<Record<string, unknown>>) {
    return mockFetch([
      {
        match: (u) => u.endsWith("/api/login"),
        respond: () => new Response("{}", { status: 200, headers: { "bs-session-id": "sess-1" } }),
      },
      {
        match: (u) => u.endsWith("/api/events/search"),
        respond: (_u, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          if (headers?.["bs-session-id"] !== "sess-1") return new Response("unauthorized", { status: 401 });
          const body = JSON.parse(String(init?.body)) as { Query: { limit: number; offset: number; conditions: Array<{ values: string[] }> } };
          const since = body.Query.conditions[0]?.values[0];
          const sorted = [...rows].sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
          const filtered = since ? sorted.filter((r) => new Date(String(r.datetime)).getTime() > new Date(since).getTime()) : sorted;
          return json({ EventCollection: { rows: filtered.slice(body.Query.offset, body.Query.offset + body.Query.limit) } });
        },
      },
    ]);
  }

  const baseRows = [
    { id: "7001", datetime: "2030-06-12T05:00:00Z", tna_key: "1", user_id: { user_id: "42", photo: "FACE_IMAGE_B64" }, faceTemplate: "RAW" },
    { id: "7002", datetime: "2030-06-12T14:00:00Z", tna_key: "2", user_id: { user_id: "42" } },
    { id: "7003", datetime: "2030-06-12T14:30:00Z", user_id: { user_id: "42" } }, // no tna_key → not a T&A punch
  ];

  it("logs in, searches T&A events, maps tna_key, and never forwards biometric data", async () => {
    const adapter = new SupremaAdapter(cfg, bsServer([...baseRows]));
    expect((await adapter.testConnection()).ok).toBe(true);

    const { punches, nextCursor } = await adapter.poll(null);
    expect(punches).toHaveLength(2); // non-T&A event dropped
    expect(punches[0]).toMatchObject({ deviceUserId: "42", eventType: "CLOCK_IN", deviceEventUid: "bs-7001" });
    expect(punches[1].eventType).toBe("CLOCK_OUT");
    const serialized = JSON.stringify(punches);
    expect(serialized).not.toContain("FACE_IMAGE_B64");
    expect(serialized).not.toContain("faceTemplate");

    const second = await adapter.poll(nextCursor);
    expect(second.punches).toHaveLength(0);
  });

  it("does not lose a same-timestamp punch arriving after the cursor was advanced", async () => {
    const rows = [...baseRows];
    const adapter = new SupremaAdapter(cfg, bsServer(rows));
    const first = await adapter.poll(null);
    expect(uids(first.punches)).toEqual(["bs-7001", "bs-7002"]);

    // second employee punches at the exact boundary timestamp of the last poll
    rows.push({ id: "7004", datetime: "2030-06-12T14:30:00Z", tna_key: "2", user_id: { user_id: "77" } });
    const second = await adapter.poll(first.nextCursor);
    expect(uids(second.punches)).toEqual(["bs-7004"]);

    const third = await adapter.poll(second.nextCursor);
    expect(third.punches).toHaveLength(0);
  });

  it("drains a backlog beyond the per-poll page cap (>10,000 rows) via the persisted continuation", async () => {
    // 12,000 events (> 20 pages × 500 per poll), 4 per second → thousands of
    // same-timestamp groups crossing page and poll boundaries.
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 12_000; i += 1) {
      const sec = Math.floor(i / 4);
      const hh = String(7 + Math.floor(sec / 3600)).padStart(2, "0");
      const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      rows.push({ id: String(90_000 + i), datetime: `2030-06-12T${hh}:${mm}:${ss}Z`, tna_key: "1", user_id: { user_id: String(i % 5) } });
    }
    const adapter = new SupremaAdapter(cfg, bsServer(rows));
    const seen = new Set<string>();
    let cursor: string | null = null;
    let polls = 0;
    for (; polls < 6; polls += 1) {
      const res = await adapter.poll(cursor);
      for (const p of res.punches) {
        expect(seen.has(p.deviceEventUid!)).toBe(false);
        seen.add(p.deviceEventUid!);
      }
      cursor = res.nextCursor;
      if (res.punches.length === 0) break;
    }
    expect(seen.size).toBe(12_000); // nothing lost, nothing duplicated
    expect(polls).toBeGreaterThan(1); // required multiple polls (page cap really hit)
  });
});
