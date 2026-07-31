/**
 * Attendance Gateway E2E — covers the signed machine API and the full
 * offline-first pipeline against the real app + seeded DB:
 *   - admin registration (secret returned once, only hash stored)
 *   - unauthorized requests (missing/invalid signature, revoked reg, stale ts)
 *   - signed punch ingestion with dedupe (duplicate events, batch replay)
 *   - device→employee mapping resolution and unmapped handling
 *   - attendance materialization (punches appear in attendance_records)
 *   - clock-drift detection
 *   - offline operation + reconnect synchronization (queue → flush)
 *   - failed device (vendor SDK stub) surfaces clearly
 *   - reconciliation (missing batch / count mismatch)
 *   - payroll handoff (ingested punches drive no-show/overtime inputs)
 *
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash, createHmac, randomUUID } from "crypto";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  gatewayRegistrationsTable,
  punchImportBatchesTable,
  punchEventsTable,
  attendanceRecordsTable,
  deviceEmployeeMappingsTable,
  employeesTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";
import os from "os";
import path from "path";

// Gateway-side pieces run in-process against the supertest app via a fetch shim.
import { EncryptedQueue } from "../../../../lib/attendance-gateway/src/queue.js";
import { HrClient } from "../../../../lib/attendance-gateway/src/hrClient.js";
import { GatewayService } from "../../../../lib/attendance-gateway/src/service.js";
import { deriveSigningKey } from "../../../../lib/attendance-gateway/src/signing.js";
import { SimulatorAdapter } from "../../../../lib/attendance-gateway/src/adapters/simulator.js";
import { ZktecoAdapter } from "../../../../lib/attendance-gateway/src/adapters/vendorStubs.js";
import { GenericRestAdapter } from "../../../../lib/attendance-gateway/src/adapters/genericRest.js";
import { buildLocalApi } from "../../../../lib/attendance-gateway/src/localApi.js";
import { parseCsvPunches } from "../../../../lib/attendance-gateway/src/adapters/csv.js";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

let registrationId: number;
let secret: string; // plaintext, as the admin screen would show once
let signingKey: string;
let employeeId: number;
let mappingId: number;
const DEVICE_USER_ID = `GW-TEST-${Date.now() % 100000}`;
const createdBatchIds: number[] = [];

function signedHeaders(body: string, opts?: { ts?: number; sig?: string; regId?: number }) {
  const ts = opts?.ts ?? Date.now();
  const sig = opts?.sig ?? createHmac("sha256", signingKey).update(`${ts}.${sha256(body)}`).digest("hex");
  return {
    "content-type": "application/json",
    "x-gateway-id": String(opts?.regId ?? registrationId),
    "x-gateway-timestamp": String(ts),
    "x-gateway-signature": sig,
  };
}

async function postSigned(url: string, payload: unknown, opts?: { ts?: number; sig?: string; regId?: number }) {
  const body = JSON.stringify(payload);
  return request(app).post(url).set(signedHeaders(body, opts)).send(body);
}

/** fetch shim routing the gateway's HrClient into the supertest app. */
function supertestFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://local");
    let req = request(app).post(url.pathname);
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) req = req.set(k, v);
    const res = await req.send(init?.body as string);
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      json: async () => res.body,
    } as Response;
  }) as typeof fetch;
}

const admin = request.agent(app);

beforeAll(async () => {
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable).limit(1);
  employeeId = emp.id;

  // Gateway administration requires a real session even in demo mode.
  const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
  expect(login.status).toBe(200);

  // Unauthenticated admin access must be rejected outright.
  const anon = await request(app).post("/api/gateway/registrations").send({ name: "X", adapterType: "SIMULATOR" });
  expect(anon.status).toBe(401);
  const anonList = await request(app).get("/api/gateway/registrations");
  expect(anonList.status).toBe(401);

  // Admin creates a registration through the session-authed API.
  const create = await admin
    .post("/api/gateway/registrations")
    .send({ name: "Test Gateway", nameAr: "بوابة اختبار", adapterType: "SIMULATOR" });
  expect(create.status).toBe(201);
  registrationId = create.body.id;
  secret = create.body.secret;
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  expect(create.body.secretHash).toBeUndefined();
  signingKey = deriveSigningKey(secret);

  // Server must never store forgery-capable material in the clear: the stored
  // value is an encrypted envelope, not the secret nor the bare signing key.
  const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
  expect(reg.secretHash).not.toBe(secret);
  expect(reg.secretHash).not.toBe(sha256(secret));
  expect(reg.secretHash.startsWith("v2:")).toBe(true);

  // Map the device-user id to the employee.
  const [mapping] = await db
    .insert(deviceEmployeeMappingsTable)
    .values({
      deviceId: 999999, // no reg.deviceId set, so deviceId filter is skipped
      employeeId,
      enrolledAt: new Date().toISOString().slice(0, 10),
      enrolledByUserId: 1,
      deviceUserId: DEVICE_USER_ID,
    })
    .returning({ id: deviceEmployeeMappingsTable.id });
  mappingId = mapping.id;
});

afterAll(async () => {
  await db.delete(punchEventsTable).where(inArray(punchEventsTable.importBatchId, createdBatchIds.length ? createdBatchIds : [-1]));
  const batches = await db
    .select({ id: punchImportBatchesTable.id })
    .from(punchImportBatchesTable)
    .where(eq(punchImportBatchesTable.registrationId, registrationId));
  await db.delete(punchEventsTable).where(inArray(punchEventsTable.importBatchId, batches.map((b) => b.id).concat(-1)));
  await db.delete(punchImportBatchesTable).where(eq(punchImportBatchesTable.registrationId, registrationId));
  await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, "2030-06-10"));
  await db.delete(deviceEmployeeMappingsTable).where(eq(deviceEmployeeMappingsTable.id, mappingId));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.entityType, "gateway_registration"));
  await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
});

describe("unauthorized requests", () => {
  it("rejects missing auth headers with 401", async () => {
    const res = await request(app).post("/api/gateway/punches").send({ batchUuid: randomUUID(), events: [] });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid signature with 401", async () => {
    const res = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, { sig: "ab".repeat(32) });
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp (replay window) with 401", async () => {
    const res = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, { ts: Date.now() - 10 * 60 * 1000 });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown registration with 401", async () => {
    const res = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, { regId: 99999999 });
    expect(res.status).toBe(401);
  });
});

describe("heartbeat + clock drift", () => {
  it("accepts a signed heartbeat and measures drift", async () => {
    const res = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() + 5 * 60 * 1000 - 1000 });
    expect(res.status).toBe(200);
    expect(res.body.driftAlert).toBe(true); // ~5min ahead > 2min tolerance
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.driftAlert).toBe(true);
    expect(Math.abs((reg.clockDriftMs ?? 0) - 5 * 60 * 1000)).toBeLessThan(10_000);
  });

  it("persists a structured adapter connection-test result", async () => {
    const res = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      adapterStatus: "ZKBioTime authentication failed: 401",
      connectionTest: { ok: false, status: "AUTH_FAILED", message: "ZKBioTime authentication failed: 401" },
    });
    expect(res.status).toBe(200);
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.adapterConnStatus).toBe("AUTH_FAILED");
    expect(reg.adapterConnMessage).toContain("authentication failed");
    expect(reg.adapterConnTestedAt).toBeTruthy();
  });

  it("falls back to ok flag when the status value is unknown, and ignores garbage statuses", async () => {
    const res = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "WEIRD_VALUE", message: "middleware reachable" },
    });
    expect(res.status).toBe(200);
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.adapterConnStatus).toBe("REACHABLE");
    expect(reg.adapterConnMessage).toBe("middleware reachable");
  });

  it("persists device clock skew from the heartbeat and flags skew above 60s", async () => {
    const res = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "device reachable", clockSkewMs: 125_000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.deviceClockSkewMs).toBe(125_000);
    expect(res.body.deviceClockSkewAlert).toBe(true);
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.deviceClockSkewMs).toBe(125_000);
    expect(reg.deviceClockSkewAlert).toBe(true);

    // Healthy skew clears the alert
    const ok = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "device reachable", clockSkewMs: 3_000 },
    });
    expect(ok.status).toBe(200);
    const [reg2] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg2.deviceClockSkewMs).toBe(3_000);
    expect(reg2.deviceClockSkewAlert).toBe(false);
  });

  it("ignores invalid clockSkewMs values and keeps the stored skew when unmeasured", async () => {
    for (const bad of [-5, Number.NaN, "huge", null]) {
      const res = await postSigned("/api/gateway/heartbeat", {
        deviceTimeMs: Date.now(),
        connectionTest: { ok: true, status: "REACHABLE", message: "ok", clockSkewMs: bad },
      });
      expect(res.status).toBe(200);
      expect(res.body.deviceClockSkewMs).toBeNull();
    }
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    // last valid measurement (3s from the previous test) is retained, not clobbered
    expect(reg.deviceClockSkewMs).toBe(3_000);
    expect(reg.deviceClockSkewAlert).toBe(false);
  });

  it("exposes device clock skew through the admin registrations listing", async () => {
    const res = await admin.get("/api/gateway/registrations");
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(mine).toBeTruthy();
    expect(mine!.deviceClockSkewMs).toBe(3_000);
    expect(mine!.deviceClockSkewAlert).toBe(false);
  });

  it("exposes connection health through the admin registrations listing", async () => {
    const res = await admin.get("/api/gateway/registrations");
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(mine).toBeTruthy();
    expect(mine!.adapterConnStatus).toBe("REACHABLE");
    expect(mine!.adapterConnTestedAt).toBeTruthy();
    expect(mine!.secretHash).toBeUndefined();
  });
});

describe("signed punch ingestion", () => {
  const batchUuid = randomUUID();
  const events = [
    { deviceUserId: DEVICE_USER_ID, eventTime: "2030-06-10T05:00:00.000Z", eventType: "CLOCK_IN", deviceEventUid: "e2e-in-1" },
    { deviceUserId: DEVICE_USER_ID, eventTime: "2030-06-10T14:00:00.000Z", eventType: "CLOCK_OUT", deviceEventUid: "e2e-out-1" },
    // exact duplicate of the first event inside the same batch
    { deviceUserId: DEVICE_USER_ID, eventTime: "2030-06-10T05:00:00.000Z", eventType: "CLOCK_IN", deviceEventUid: "e2e-in-1" },
    // unmapped device user
    { deviceUserId: "UNKNOWN-USER-XYZ", eventTime: "2030-06-10T05:10:00.000Z", eventType: "CLOCK_IN", deviceEventUid: "e2e-unmapped" },
  ];

  it("ingests a batch, deduplicates, and records the raw payload hash", async () => {
    const res = await postSigned("/api/gateway/punches", { batchUuid, deviceTimeMs: Date.now(), events });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(2);
    expect(res.body.duplicates).toBe(1);
    expect(res.body.unmapped).toBe(1);
    createdBatchIds.push(res.body.batchId);

    const [batch] = await db.select().from(punchImportBatchesTable).where(eq(punchImportBatchesTable.batchUuid, batchUuid));
    expect(batch.rawPayloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.insertedCount).toBe(2);
  });

  it("replaying the same batch UUID is idempotent", async () => {
    const res = await postSigned("/api/gateway/punches", { batchUuid, deviceTimeMs: Date.now(), events });
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.inserted).toBe(2);
  });

  it("re-sending the same events under a NEW batch UUID inserts nothing (dedupe keys)", async () => {
    const res = await postSigned("/api/gateway/punches", { batchUuid: randomUUID(), deviceTimeMs: Date.now(), events });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(0);
    expect(res.body.duplicates).toBe(3);
    createdBatchIds.push(res.body.batchId);
  });

  it("materializes punches into the attendance record", async () => {
    const [rec] = await db
      .select()
      .from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.date, "2030-06-10"));
    expect(rec).toBeDefined();
    expect(rec.employeeId).toBe(employeeId);
    expect(rec.checkInTime).toBe("05:00");
    expect(rec.checkOutTime).toBe("14:00");
    expect(rec.status).toBe("present");
    expect(rec.workingHours).toBe(9);
  });

  it("refuses payloads containing biometric template fields", async () => {
    const res = await postSigned("/api/gateway/punches", {
      batchUuid: randomUUID(),
      events: [{ deviceUserId: DEVICE_USER_ID, eventTime: "2030-06-10T06:00:00.000Z", eventType: "CLOCK_IN", raw: { template: "AAAA" } }],
    });
    expect(res.status).toBe(422);
  });

  it("writes an audit log entry for the import", async () => {
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.action, "gateway_punch_import"));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("concurrent materialization", () => {
  it("parallel batches for the same employee/day produce exactly one attendance row", async () => {
    const day = "2030-06-13";
    const mk = (type: string, time: string, uid: string) =>
      postSigned("/api/gateway/punches", {
        batchUuid: randomUUID(),
        events: [{ deviceUserId: DEVICE_USER_ID, eventTime: `${day}T${time}:00.000Z`, eventType: type, deviceEventUid: uid }],
      });
    const results = await Promise.all([
      mk("CLOCK_IN", "05:30", "cc-in-a"),
      mk("CLOCK_IN", "05:00", "cc-in-b"),
      mk("CLOCK_OUT", "13:00", "cc-out-a"),
      mk("CLOCK_OUT", "14:00", "cc-out-b"),
    ]);
    for (const r of results) {
      expect(r.status).toBe(201);
      createdBatchIds.push(r.body.batchId);
    }
    const rows = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, day));
    expect(rows).toHaveLength(1);
    expect(rows[0].checkInTime).toBe("05:00"); // earliest IN wins
    expect(rows[0].checkOutTime).toBe("14:00"); // latest OUT wins
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.importBatchId, results.map((r) => r.body.batchId)));
    await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, day));
  });
});

describe("reconciliation", () => {
  it("reports OK / MISSING_ON_SERVER / COUNT_MISMATCH", async () => {
    const [known] = await db
      .select()
      .from(punchImportBatchesTable)
      .where(eq(punchImportBatchesTable.registrationId, registrationId))
      .limit(1);
    const res = await postSigned("/api/gateway/reconcile", {
      batches: [
        { batchUuid: known.batchUuid, eventCount: known.eventCount },
        { batchUuid: known.batchUuid + "-mismatch-probe", eventCount: 5 },
        { batchUuid: known.batchUuid, eventCount: known.eventCount + 3 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("OK");
    expect(res.body.results[1].status).toBe("MISSING_ON_SERVER");
    expect(res.body.results[2].status).toBe("COUNT_MISMATCH");

    // The reconcile outcome is persisted and exposed to the admin UI so it
    // can warn about batches missing on the server.
    const status = await admin.get("/api/gateway/reconcile-status");
    expect(status.status).toBe(200);
    const mine = status.body.find((s: { registrationId: number }) => s.registrationId === registrationId);
    expect(mine).toBeDefined();
    expect(mine.checked).toBe(3);
    expect(mine.missing).toEqual([known.batchUuid + "-mismatch-probe"]);
    expect(mine.mismatched).toEqual([known.batchUuid]);

    // Admin endpoint is session-gated like the rest of gateway administration.
    const anon = await request(app).get("/api/gateway/reconcile-status");
    expect(anon.status).toBe(401);
  });
});

describe("terminal batch recovery", () => {
  it("surfaces exhausted batches in status/terminal listing and requeue makes them deliverable again", async () => {
    const dir = path.join(os.tmpdir(), `gw-term-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();

    let online = false;
    const flakyFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!online) throw new Error("network unreachable (simulated outage)");
      return supertestFetch()(input, init);
    }) as typeof fetch;

    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: flakyFetch });
    const service = new GatewayService(queue, hr, new SimulatorAdapter([DEVICE_USER_ID], () => new Date("2030-06-13T14:00:00Z")), {
      maxAttempts: 2,
      baseBackoffMs: 0, // every attempt is immediately due
    });

    const polled = await service.pollOnce();
    expect(polled.queued).toBe(2);

    // Exhaust maxAttempts while offline → batch goes terminal.
    await service.flush();
    const secondFlush = await service.flush();
    expect(secondFlush.failed).toBe(1);
    const stored = await queue.read(polled.batchUuid!);
    expect(stored!.terminal).toBe(true);
    expect(stored!.attempts).toBe(2);

    // Status no longer counts it as pending; the terminal listing surfaces it.
    const status = await service.status();
    expect(status.pendingBatches).toBe(0);
    expect(status.terminalBatches).toBe(1);
    const terminal = await service.listTerminalBatches();
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ batchUuid: polled.batchUuid, attempts: 2, punchCount: 2 });

    // Flush never auto-retries a terminal batch, even when the network is back.
    online = true;
    const skippedFlush = await service.flush();
    expect(skippedFlush.sent).toBe(0);

    // Unknown uuid → null; requeue resets attempts/terminal and delivery succeeds.
    expect(await service.requeueBatch(randomUUID())).toBeNull();
    const requeued = await service.requeueBatch(polled.batchUuid!);
    expect(requeued).toMatchObject({ batchUuid: polled.batchUuid, punchCount: 2 });
    const reset = await queue.read(polled.batchUuid!);
    expect(reset!.terminal).toBeUndefined();
    expect(reset!.attempts).toBe(0);

    const deliveredFlush = await service.flush();
    expect(deliveredFlush.sent).toBe(1);
    expect((await queue.pending()).length).toBe(0);
    expect((await service.status()).terminalBatches).toBe(0);

    // cleanup rows created by this pipeline
    const [b] = await db
      .select()
      .from(punchImportBatchesTable)
      .where(eq(punchImportBatchesTable.batchUuid, polled.batchUuid!));
    createdBatchIds.push(b.id);
    await db.delete(punchEventsTable).where(eq(punchEventsTable.importBatchId, b.id));
    await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, "2030-06-13"));
  });
});

describe("local operator API security", () => {
  it("mutating endpoints require the operator token; reads stay loopback-open", async () => {
    const dir = path.join(os.tmpdir(), `gw-local-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();
    const adapter = new SimulatorAdapter([DEVICE_USER_ID]);
    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const service = new GatewayService(queue, hr, adapter);
    const token = "test-operator-token";
    const local = buildLocalApi({ service, adapter, adminToken: token });

    // An empty token is refused outright — no accidental unauthenticated deploys.
    expect(() => buildLocalApi({ service, adapter, adminToken: "" })).toThrow(/adminToken/);

    // Read-only endpoints work without a token (loopback-only surface).
    expect((await request(local).get("/status")).status).toBe(200);
    expect((await request(local).get("/terminal-batches")).status).toBe(200);

    // Mutating endpoints reject missing or wrong tokens.
    for (const [method, url, body] of [
      ["post", "/flush", {}],
      ["post", "/requeue", { batchUuid: randomUUID() }],
      ["post", "/import-csv", { content: "x" }],
    ] as const) {
      const missing = await request(local)[method](url).send(body);
      expect(missing.status).toBe(401);
      const wrong = await request(local)[method](url).set("x-gateway-admin-token", "nope").send(body);
      expect(wrong.status).toBe(401);
    }

    // With the token, the endpoints behave normally.
    const flush = await request(local).post("/flush").set("x-gateway-admin-token", token).send({});
    expect(flush.status).toBe(200);
    const requeue = await request(local).post("/requeue").set("x-gateway-admin-token", token).send({ batchUuid: randomUUID() });
    expect(requeue.status).toBe(404); // authenticated, but unknown batch
  });
});

describe("offline operation and reconnect synchronization (gateway pipeline)", () => {
  it("queues while offline, then delivers everything after reconnect", async () => {
    const dir = path.join(os.tmpdir(), `gw-queue-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();

    let online = false;
    const flakyFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!online) throw new Error("network unreachable (simulated outage)");
      return supertestFetch()(input, init);
    }) as typeof fetch;

    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: flakyFetch });
    const service = new GatewayService(queue, hr, new SimulatorAdapter([DEVICE_USER_ID], () => new Date("2030-06-11T14:00:00Z")), {
      baseBackoffMs: 60_000, // real backoff: the offline attempt must schedule a delay
    });

    // Poll while "offline": punches spool into the encrypted queue.
    const polled = await service.pollOnce();
    expect(polled.queued).toBe(2);
    const offlineFlush = await service.flush();
    expect(offlineFlush.sent).toBe(0);
    expect(offlineFlush.retriedLater).toBe(1);
    expect((await queue.pending()).length).toBe(1);

    // Queue content is encrypted at rest: a queue with the wrong key cannot read it.
    const wrongKey = new EncryptedQueue(dir, "wrong-key");
    await expect(wrongKey.read((await queue.pending())[0])).rejects.toThrow();

    // Even after reconnect, the batch is not retried before its backoff window
    // elapses — the failed attempt scheduled nextAttemptAtMs ~60s out.
    online = true;
    const backoffFlush = await service.flush();
    expect(backoffFlush.sent).toBe(0);
    expect(backoffFlush.details[0].status).toBe("BACKOFF");

    // Force the batch due (as if the backoff window elapsed), then flush drains it.
    const [pendingUuid] = await queue.pending();
    const pendingBatch = await queue.read(pendingUuid);
    pendingBatch!.nextAttemptAtMs = Date.now() - 1;
    await queue.enqueue(pendingBatch!);
    const onlineFlush = await service.flush();
    expect(onlineFlush.sent).toBe(1);
    expect((await queue.pending()).length).toBe(0);

    // Server actually holds the batch (reconcile confirms).
    const recon = await service.reconcile([{ batchUuid: onlineFlush.details[0].batchUuid, eventCount: 2 }]);
    expect(recon.body.results[0].status).toBe("OK");

    // cleanup rows created by this pipeline
    const [b] = await db
      .select()
      .from(punchImportBatchesTable)
      .where(eq(punchImportBatchesTable.batchUuid, onlineFlush.details[0].batchUuid));
    createdBatchIds.push(b.id);
    await db.delete(punchEventsTable).where(eq(punchEventsTable.importBatchId, b.id));
    await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, "2030-06-11"));
  });
});

describe("gateway loop reports connection health even when polling fails", () => {
  async function tickWith(adapter: import("../../../../lib/attendance-gateway/src/types.js").DeviceAdapter) {
    const dir = path.join(os.tmpdir(), `gw-tick-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const queue = new EncryptedQueue(dir, "tick-test-key");
    await queue.init();
    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const service = new GatewayService(queue, hr, adapter);
    const outcome = await service.tick();
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    return { outcome, reg };
  }

  it("unconfigured ZKTeco adapter: poll throws, heartbeat still persists NOT_CONFIGURED", async () => {
    const { outcome, reg } = await tickWith(new ZktecoAdapter());
    expect(outcome.pollError).toMatch(/vendor SDK/i);
    expect(outcome.heartbeatError).toBeNull();
    expect(reg.adapterConnStatus).toBe("NOT_CONFIGURED");
    expect(reg.adapterConnTestedAt).toBeTruthy();
  });

  it("middleware rejecting credentials: heartbeat persists AUTH_FAILED", async () => {
    const deny401: typeof fetch = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    const { outcome, reg } = await tickWith(new GenericRestAdapter("http://device.local", "bad-key", deny401));
    expect(outcome.pollError).toBeTruthy(); // poll fails against the 401 device
    expect(outcome.heartbeatError).toBeNull();
    expect(reg.adapterConnStatus).toBe("AUTH_FAILED");
  });

  it("dead middleware: heartbeat persists UNREACHABLE", async () => {
    const dead: typeof fetch = (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;
    const { outcome, reg } = await tickWith(new GenericRestAdapter("http://device.local", undefined, dead));
    expect(outcome.pollError).toBeTruthy();
    expect(outcome.heartbeatError).toBeNull();
    expect(reg.adapterConnStatus).toBe("UNREACHABLE");
    expect(reg.adapterConnMessage).toContain("ECONNREFUSED");
  });

  it("healthy adapter: heartbeat persists REACHABLE again", async () => {
    const { outcome, reg } = await tickWith(new SimulatorAdapter([])); // no punches queued
    expect(outcome.pollError).toBeNull();
    expect(outcome.heartbeatError).toBeNull();
    expect(reg.adapterConnStatus).toBe("REACHABLE");
  });
});

describe("failed device (vendor SDK stub)", () => {
  it("ZKTeco adapter clearly reports the vendor SDK dependency instead of pretending to work", async () => {
    const adapter = new ZktecoAdapter();
    const test = await adapter.testConnection();
    expect(test.ok).toBe(false);
    expect(test.requiresVendorSdk).toBe(true);
    await expect(adapter.poll(null)).rejects.toThrow(/vendor SDK/i);
  });
});

describe("CSV import parsing", () => {
  it("parses valid rows, derives stable uids, and reports bad rows", () => {
    const { punches, errors } = parseCsvPunches(
      [
        "device_user_id,event_time,event_type",
        `${DEVICE_USER_ID},2030-06-12T05:00:00Z,IN`,
        `${DEVICE_USER_ID},2030-06-12T14:00:00Z,OUT`,
        `${DEVICE_USER_ID},not-a-date,IN`,
      ].join("\n"),
    );
    expect(punches).toHaveLength(2);
    expect(errors).toHaveLength(1);
    // deterministic uid: same row → same uid (re-import safe)
    const again = parseCsvPunches(`device_user_id,event_time,event_type\n${DEVICE_USER_ID},2030-06-12T05:00:00Z,IN`);
    expect(again.punches[0].deviceEventUid).toBe(punches[0].deviceEventUid);
  });
});

describe("revocation", () => {
  it("a revoked registration can no longer authenticate", async () => {
    const revoke = await admin.post(`/api/gateway/registrations/${registrationId}/revoke`).send({});
    expect(revoke.status).toBe(200);
    const res = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() });
    expect(res.status).toBe(401);
    // restore for afterAll cleanliness (no functional effect)
    await db.update(gatewayRegistrationsTable).set({ status: "ACTIVE" }).where(eq(gatewayRegistrationsTable.id, registrationId));
  });
});

describe("payroll handoff", () => {
  it("gateway-ingested punches are visible to payroll punch queries (same table/format)", async () => {
    // Payroll reads punch_events by employee + event_time window; verify the
    // gateway rows satisfy exactly that access pattern.
    const rows = await db
      .select()
      .from(punchEventsTable)
      .where(eq(punchEventsTable.employeeId, employeeId));
    const gwRows = rows.filter((r) => r.source === "GATEWAY" && r.eventTime.toISOString().startsWith("2030-06-10"));
    expect(gwRows.length).toBe(2);
    const types = gwRows.map((r) => r.eventType).sort();
    expect(types).toEqual(["CLOCK_IN", "CLOCK_OUT"]);
    // linked to the materialized attendance record → daily summary + payroll
    // no-show logic both see the same day.
    expect(gwRows.every((r) => r.attendanceRecordId !== null)).toBe(true);
  });
});

describe("key vault hardening (DB leak cannot forge punches)", () => {
  it("stored envelope cannot be used directly as an HMAC signing key", async () => {
    // Simulate an attacker who exfiltrated gateway_registrations: signing with
    // the stored value (as the legacy scheme allowed) must be rejected.
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    const body = JSON.stringify({ deviceTimeMs: Date.now() });
    const ts = Date.now();
    const forged = createHmac("sha256", reg.secretHash).update(`${ts}.${sha256(body)}`).digest("hex");
    const res = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, { ts, sig: forged });
    expect(res.status).toBe(401);
  });

  it("legacy plaintext-key rows still verify and get rotated in place", async () => {
    const { rotateLegacyGatewayKeys } = await import("../routes/attendanceGateway");
    // Manufacture a legacy row: bare sha256(secret) stored as the key.
    const legacySecret = "aa".repeat(32);
    const legacyKey = sha256(legacySecret);
    const [legacyReg] = await db
      .insert(gatewayRegistrationsTable)
      .values({ name: "Legacy GW", adapterType: "SIMULATOR", secretHash: legacyKey, registeredByUserId: 1 })
      .returning();
    try {
      // Signed request with the legacy-derived key must still work...
      const body = JSON.stringify({ deviceTimeMs: Date.now() });
      const ts = Date.now();
      const sig = createHmac("sha256", legacyKey).update(`${ts}.${sha256(body)}`).digest("hex");
      const res = await request(app)
        .post("/api/gateway/heartbeat")
        .set({
          "content-type": "application/json",
          "x-gateway-id": String(legacyReg.id),
          "x-gateway-timestamp": String(ts),
          "x-gateway-signature": sig,
        })
        .send(body);
      expect(res.status).toBe(200);
      // ...and the row must have been rotated to an envelope by that request.
      let [after] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, legacyReg.id));
      expect(after.secretHash.startsWith("v2:")).toBe(true);
      expect(after.secretHash).not.toBe(legacyKey);

      // Eager rotation is idempotent (nothing legacy left for this row).
      await db.update(gatewayRegistrationsTable).set({ secretHash: legacyKey }).where(eq(gatewayRegistrationsTable.id, legacyReg.id));
      const rotated = await rotateLegacyGatewayKeys();
      expect(rotated).toBeGreaterThanOrEqual(1);
      [after] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, legacyReg.id));
      expect(after.secretHash.startsWith("v2:")).toBe(true);
      expect(await rotateLegacyGatewayKeys()).toBe(0);

      // Rotated row still verifies with the gateway-side key (protocol unchanged).
      const body2 = JSON.stringify({ deviceTimeMs: Date.now() });
      const ts2 = Date.now();
      const sig2 = createHmac("sha256", legacyKey).update(`${ts2}.${sha256(body2)}`).digest("hex");
      const res2 = await request(app)
        .post("/api/gateway/heartbeat")
        .set({
          "content-type": "application/json",
          "x-gateway-id": String(legacyReg.id),
          "x-gateway-timestamp": String(ts2),
          "x-gateway-signature": sig2,
        })
        .send(body2);
      expect(res2.status).toBe(200);
    } finally {
      await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, legacyReg.id));
    }
  });

  it("a tampered envelope is rejected, not silently trusted", async () => {
    const [tamperedReg] = await db
      .insert(gatewayRegistrationsTable)
      .values({ name: "Tampered GW", adapterType: "SIMULATOR", secretHash: "v2:00:00:00", registeredByUserId: 1 })
      .returning();
    try {
      const body = JSON.stringify({ deviceTimeMs: Date.now() });
      const ts = Date.now();
      const sig = createHmac("sha256", "anything").update(`${ts}.${sha256(body)}`).digest("hex");
      const res = await request(app)
        .post("/api/gateway/heartbeat")
        .set({
          "content-type": "application/json",
          "x-gateway-id": String(tamperedReg.id),
          "x-gateway-timestamp": String(ts),
          "x-gateway-signature": sig,
        })
        .send(body);
      expect(res.status).toBe(401);
    } finally {
      await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, tamperedReg.id));
    }
  });
});
