import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Server } from "http";
import type express from "express";
import { buildLocalApi } from "../localApi.js";
import { GatewayService } from "../service.js";
import { EncryptedQueue } from "../queue.js";
import type { DeviceAdapter, GatewayPunch } from "../types.js";
import type { HrClient } from "../hrClient.js";

const ADMIN_TOKEN = "test-operator-token";

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

function fakeHr(respond: (batches: Array<{ batchUuid: string; eventCount: number }>) => Array<{ batchUuid: string; status: string }>) {
  const calls: Array<Array<{ batchUuid: string; eventCount: number }>> = [];
  return {
    calls,
    client: {
      uploadBatch: async () => ({ status: 201, body: { ok: true, inserted: 1, duplicates: 0, unmapped: 0, errors: 0 } }),
      heartbeat: async () => ({ status: 200, body: { ok: true, clockDriftMs: 0, driftAlert: false } }),
      ackCommands: async () => ({ status: 200, body: { ok: true, results: [] } }),
      reconcile: async (batches: Array<{ batchUuid: string; eventCount: number }>) => {
        calls.push(batches);
        return { status: 200, body: { ok: true, results: respond(batches) } };
      },
    } as unknown as HrClient,
  };
}

// Minimal supertest-free HTTP helper: bind the app to an ephemeral loopback
// port and issue real requests with fetch.
const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

function listen(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

async function makeApp(hr: HrClient, adapter: DeviceAdapter, reconcileIntervalMs?: number) {
  const dir = mkdtempSync(join(tmpdir(), "gw-localapi-recon-"));
  const queue = new EncryptedQueue(join(dir, "q"), "test-key");
  await queue.init();
  const svc = new GatewayService(queue, hr, adapter, {
    cursorPath: join(dir, "cursor.json"),
    sentLogPath: join(dir, "sent-log.json"),
    reconcileIntervalMs,
  });
  await svc.init();
  const base = await listen(buildLocalApi({ service: svc, adapter, adminToken: ADMIN_TOKEN }));
  const req = async (method: "GET" | "POST", path: string, headers?: Record<string, string>) => {
    const res = await fetch(`${base}${path}`, { method, headers });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { svc, req };
}

describe("local operator API — delivery confirmation visibility", () => {
  it("GET /status prominently surfaces unconfirmed count and last reconcile outcome", async () => {
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "MISSING_ON_SERVER" })));
    const { svc, req } = await makeApp(hr.client, new OnceAdapter([punch(0), punch(1)]));
    await svc.tick(); // deliver + auto-reconcile (batch reported missing)

    const res = await req("GET", "/status");
    expect(res.status).toBe(200);
    const dc = res.body.delivery_confirmation;
    expect(dc.unconfirmedSentBatches).toBe(1);
    expect(dc.missingBatchUuids).toEqual([hr.calls[0][0].batchUuid]);
    expect(dc.mismatchedBatchUuids).toEqual([]);
    expect(dc.lastReconcileAt).toBeTruthy();
    expect(dc.summary).toContain("1 delivered batch not yet confirmed by the server");
    expect(dc.summary).toContain("1 missing");
    expect(dc.summary).toContain(hr.calls[0][0].batchUuid);
    // Raw fields remain available too.
    expect(res.body.unconfirmedSentBatches).toBe(1);
    expect(res.body.lastReconcile.missing).toEqual([hr.calls[0][0].batchUuid]);
  });

  it("GET /status reports 'no reconcile has run yet' before any reconcile", async () => {
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "OK" })));
    const { req } = await makeApp(hr.client, new OnceAdapter([]));
    const res = await req("GET", "/status");
    expect(res.status).toBe(200);
    expect(res.body.delivery_confirmation.summary).toContain("0 delivered batches not yet confirmed");
    expect(res.body.delivery_confirmation.summary).toContain("no reconcile has run yet");
  });

  it("POST /reconcile requires the operator token", async () => {
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "OK" })));
    const { req } = await makeApp(hr.client, new OnceAdapter([]));
    expect((await req("POST", "/reconcile")).status).toBe(401);
    expect((await req("POST", "/reconcile", { "x-gateway-admin-token": "wrong" })).status).toBe(401);
  });

  it("POST /reconcile triggers an immediate reconcile even inside the rate-limit window", async () => {
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "MISSING_ON_SERVER" })));
    // Long interval: the automatic path would refuse to reconcile again.
    const { svc, req } = await makeApp(hr.client, new OnceAdapter([punch(0)]), 60 * 60_000);
    await svc.tick(); // delivers + first (automatic) reconcile
    expect(hr.calls).toHaveLength(1);
    expect(await svc.maybeReconcile()).toBeNull(); // rate-limited

    const res = await req("POST", "/reconcile", { "x-gateway-admin-token": ADMIN_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checked).toBe(1);
    expect(res.body.missing).toEqual([hr.calls[0][0].batchUuid]);
    expect(hr.calls).toHaveLength(2);
  });

  it("POST /reconcile responds cleanly when there is nothing to reconcile", async () => {
    const hr = fakeHr((batches) => batches.map((b) => ({ batchUuid: b.batchUuid, status: "OK" })));
    const { req } = await makeApp(hr.client, new OnceAdapter([]));
    const res = await req("POST", "/reconcile", { "x-gateway-admin-token": ADMIN_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, checked: 0, missing: [], mismatched: [] });
  });

  it("POST /reconcile surfaces server failures instead of pretending success", async () => {
    const hr = {
      client: {
        uploadBatch: async () => ({ status: 201, body: { ok: true, inserted: 1, duplicates: 0, unmapped: 0, errors: 0 } }),
        heartbeat: async () => ({ status: 200, body: { ok: true, clockDriftMs: 0, driftAlert: false } }),
        ackCommands: async () => ({ status: 200, body: { ok: true, results: [] } }),
        reconcile: async () => ({ status: 503, body: { ok: false } }),
      } as unknown as HrClient,
    };
    const { svc, req } = await makeApp(hr.client, new OnceAdapter([punch(0)]));
    await svc.tick(); // delivery succeeds; automatic reconcile fails (non-fatal)
    const res = await req("POST", "/reconcile", { "x-gateway-admin-token": ADMIN_TOKEN });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/503/);
  });
});
