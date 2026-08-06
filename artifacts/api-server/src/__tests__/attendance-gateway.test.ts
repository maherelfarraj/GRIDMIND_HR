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
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createHash, createHmac, randomUUID } from "crypto";
import { inArray, eq, and } from "drizzle-orm";
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
import { runScheduler } from "../../../../lib/attendance-gateway/src/scheduler.js";
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

describe("admin: on-demand connection test", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).post(`/api/gateway/registrations/${registrationId}/test`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown registration id", async () => {
    const res = await admin.post("/api/gateway/registrations/99999999/test");
    expect(res.status).toBe(404);
  });

  it("sets connTestRequestedAt on an ACTIVE registration and writes an audit row", async () => {
    const before = Date.now();
    const res = await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.secretHash).toBeUndefined();
    expect(res.body.connTestRequestedAt).toBeTruthy();
    const requestedAt = new Date(res.body.connTestRequestedAt).getTime();
    expect(requestedAt).toBeGreaterThanOrEqual(before);

    // DB reflects the flag.
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.connTestRequestedAt).toBeTruthy();

    // Audit row was written.
    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.action, "gateway_conn_test_requested"), eq(auditLogsTable.entityId, registrationId)));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — calling again while pending is fine (just refreshes the timestamp)", async () => {
    const res = await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.connTestRequestedAt).toBeTruthy();
  });

  it("a signed heartbeat WITHOUT a connection-test result does not clear connTestRequestedAt and signals pending", async () => {
    // Ensure the flag is set first.
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const [before] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(before.connTestRequestedAt).toBeTruthy();

    // Heartbeat with no connectionTest or adapterStatus — cannot answer a test.
    const hb = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() });
    expect(hb.status).toBe(200);
    // testRequested: true — admin test is still pending, gateway should nudge.
    expect(hb.body.testRequested).toBe(true);

    const [after] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(after.connTestRequestedAt).toBeTruthy(); // still set
  });

  it("a heartbeat with a FRESH result (connectionTestRunAt >= connTestRequestedAt) clears the flag", async () => {
    // Make sure the flag is set.
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const [before] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(before.connTestRequestedAt).toBeTruthy();
    const requestedAt = before.connTestRequestedAt!.getTime();

    // Heartbeat with connectionTestRunAt AFTER the request → answers the test.
    const hb = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "on-demand test answer" },
      connectionTestRunAt: requestedAt + 100,   // 100 ms after request → fresh
    });
    expect(hb.status).toBe(200);
    // testRequested: false — test was just answered, normal cadence resumes.
    expect(hb.body.testRequested).toBe(false);

    // Flag is cleared.
    const [after] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(after.connTestRequestedAt).toBeNull();
    expect(after.adapterConnStatus).toBe("REACHABLE");
  });

  it("a heartbeat with a STALE result (connectionTestRunAt < connTestRequestedAt) leaves flag set and signals pending", async () => {
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const [before] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    const requestedAt = before.connTestRequestedAt!.getTime();

    // Heartbeat with connectionTestRunAt BEFORE the request → stale result.
    const hb = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "stale result" },
      connectionTestRunAt: requestedAt - 5000, // 5 s before request → stale
    });
    expect(hb.status).toBe(200);
    // testRequested: true — still pending; nudge needed.
    expect(hb.body.testRequested).toBe(true);

    // Flag is NOT cleared, but status IS refreshed (stale result still useful
    // for display).
    const [after] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(after.connTestRequestedAt).toBeTruthy();
    expect(after.adapterConnStatus).toBe("REACHABLE"); // display updated

    // Clean up: send a fresh heartbeat to clear the flag.
    await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "cleanup" },
      connectionTestRunAt: requestedAt + 1000,
    });
  });

  it("a heartbeat without connectionTestRunAt (older gateway) is treated as fresh and clears the flag", async () => {
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const [before] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(before.connTestRequestedAt).toBeTruthy();

    // No connectionTestRunAt → backward-compat path: treat as fresh.
    const hb = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "legacy gateway answer" },
    });
    expect(hb.status).toBe(200);
    expect(hb.body.testRequested).toBe(false); // answered → normal cadence
    const [after] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(after.connTestRequestedAt).toBeNull(); // cleared
  });

  it("returns 409 when trying to test a REVOKED registration", async () => {
    // Create and immediately revoke a fresh registration for this test.
    const cr = await admin
      .post("/api/gateway/registrations")
      .send({ name: "Temp-for-409-test", adapterType: "SIMULATOR" });
    expect(cr.status).toBe(201);
    const tmpId = cr.body.id;
    try {
      await admin.post(`/api/gateway/registrations/${tmpId}/revoke`);
      const res = await admin.post(`/api/gateway/registrations/${tmpId}/test`);
      expect(res.status).toBe(409);
    } finally {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, tmpId));
      await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, tmpId));
    }
  });

  it("GET /gateway/registrations includes connTestRequestedAt in the response", async () => {
    // Set the flag on the main reg.
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const list = await admin.get("/api/gateway/registrations");
    expect(list.status).toBe(200);
    const mine = (list.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(mine).toBeTruthy();
    expect("connTestRequestedAt" in mine!).toBe(true);
    expect(mine!.connTestRequestedAt).toBeTruthy();
    // Clear it so subsequent tests start clean.
    await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "cleanup" },
    });
  });

  it("connTestTimedOut is false when a test request is recently pending", async () => {
    // Set the flag now (fresh timestamp).
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const list = await admin.get("/api/gateway/registrations");
    expect(list.status).toBe(200);
    const mine = (list.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(mine).toBeTruthy();
    expect(mine!.connTestTimedOut).toBe(false);
    // Cleanup.
    await admin.post(`/api/gateway/registrations/${registrationId}/test/cancel`);
  });

  it("connTestTimedOut is true when connTestRequestedAt is backdated past the timeout window", async () => {
    // Set the flag, then manually backdate it well past max(2×threshold, 5 min).
    // Also clear adapterConnTestedAt so it cannot be interpreted as "already answered".
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    const staleTs = new Date(Date.now() - 30 * 60_000); // 30 minutes ago
    await db
      .update(gatewayRegistrationsTable)
      .set({ connTestRequestedAt: staleTs, adapterConnTestedAt: null })
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    const list = await admin.get("/api/gateway/registrations");
    expect(list.status).toBe(200);
    const mine = (list.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(mine).toBeTruthy();
    expect(mine!.connTestTimedOut).toBe(true);
    // Cleanup.
    await admin.post(`/api/gateway/registrations/${registrationId}/test/cancel`);
  });
});

describe("admin: cancel connection test request", () => {
  it("rejects anonymous cancel with 401", async () => {
    const res = await request(app).post(`/api/gateway/registrations/${registrationId}/test/cancel`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown registration id", async () => {
    const res = await admin.post("/api/gateway/registrations/99999999/test/cancel");
    expect(res.status).toBe(404);
  });

  it("cancels a pending test request, returns cancelled:true, and writes audit row", async () => {
    // Set the flag first.
    const setRes = await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    expect(setRes.status).toBe(200);
    expect(setRes.body.connTestRequestedAt).toBeTruthy();

    // Cancel it.
    const cancelRes = await admin.post(`/api/gateway/registrations/${registrationId}/test/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.cancelled).toBe(true);
    expect(cancelRes.body.secretHash).toBeUndefined();

    // DB flag is cleared.
    const [reg] = await db
      .select({ connTestRequestedAt: gatewayRegistrationsTable.connTestRequestedAt })
      .from(gatewayRegistrationsTable)
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.connTestRequestedAt).toBeNull();

    // Audit row was written.
    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.action, "gateway_conn_test_cancelled"), eq(auditLogsTable.entityId, registrationId)));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("is graceful when connTestRequestedAt is already null — returns cancelled:false, no error", async () => {
    // Ensure the flag is clear (previous test already cleared it).
    const [reg] = await db
      .select({ connTestRequestedAt: gatewayRegistrationsTable.connTestRequestedAt })
      .from(gatewayRegistrationsTable)
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.connTestRequestedAt).toBeNull();

    const res = await admin.post(`/api/gateway/registrations/${registrationId}/test/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(false);
    expect(res.body.secretHash).toBeUndefined();
  });

  it("re-requesting after cancel starts a fresh pending cycle (connTestTimedOut becomes false)", async () => {
    // Cancel to clear any stale flag first.
    await admin.post(`/api/gateway/registrations/${registrationId}/test/cancel`);

    // Backdate a stale test request to simulate a timed-out state.
    // Also clear adapterConnTestedAt so the row is "unanswered" from the server's perspective.
    await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    await db
      .update(gatewayRegistrationsTable)
      .set({ connTestRequestedAt: new Date(Date.now() - 30 * 60_000), adapterConnTestedAt: null })
      .where(eq(gatewayRegistrationsTable.id, registrationId));

    // Confirm it shows as timed out.
    const timedOut = await admin.get("/api/gateway/registrations");
    const timedOutRow = (timedOut.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(timedOutRow!.connTestTimedOut).toBe(true);

    // Re-request via POST /test (refreshes the timestamp).
    const reRes = await admin.post(`/api/gateway/registrations/${registrationId}/test`);
    expect(reRes.status).toBe(200);

    // Now should be pending (fresh timestamp), not timed out.
    const freshList = await admin.get("/api/gateway/registrations");
    const freshRow = (freshList.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(freshRow!.connTestTimedOut).toBe(false);
    expect(freshRow!.connTestRequestedAt).toBeTruthy();

    // Cleanup.
    await admin.post(`/api/gateway/registrations/${registrationId}/test/cancel`);
  });
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

  it("persists SDK presence/version and device clock skew from the heartbeat", async () => {
    const res = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      connectionTest: { ok: true, status: "REACHABLE", message: "ok" },
      sdkPresent: false,
      sdkVersion: null,
      deviceClockSkewMs: 95_000, // device clock ~95s ahead of the gateway
    });
    expect(res.status).toBe(200);
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.sdkPresent).toBe(false);
    expect(reg.sdkVersion).toBeNull();
    expect(reg.deviceClockSkewMs).toBe(95_000);
  });

  it("updates SDK fields on later heartbeats and ignores non-finite skew values", async () => {
    const res = await postSigned("/api/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      sdkPresent: true,
      sdkVersion: "2.9.1",
      deviceClockSkewMs: "not-a-number",
    });
    expect(res.status).toBe(200);
    const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(reg.sdkPresent).toBe(true);
    expect(reg.sdkVersion).toBe("2.9.1");
    expect(reg.deviceClockSkewMs).toBe(95_000); // garbage skew value left the last good one intact
  });

  it("exposes connection health through the admin registrations listing", async () => {
    const res = await admin.get("/api/gateway/registrations");
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId);
    expect(mine).toBeTruthy();
    expect(mine!.adapterConnStatus).toBe("REACHABLE");
    expect(mine!.adapterConnTestedAt).toBeTruthy();
    expect(mine!.secretHash).toBeUndefined();
    // SDK + device clock skew fields flow through to the HR admin screen.
    expect(mine!.sdkPresent).toBe(true);
    expect(mine!.sdkVersion).toBe("2.9.1");
    expect(mine!.deviceClockSkewMs).toBe(95_000);
  });

  it("exposes a server-computed online/offline (silent) verdict in the registrations listing", async () => {
    // Fresh heartbeat → not silent.
    const beat = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() });
    expect(beat.status).toBe(200);
    let res = await admin.get("/api/gateway/registrations");
    expect(res.status).toBe(200);
    let mine = (res.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId)!;
    expect(mine.silent).toBe(false);
    expect(typeof mine.silenceThresholdMs).toBe("number");

    // Backdate the last contact beyond the threshold → silent.
    const threshold = mine.silenceThresholdMs as number;
    const stale = new Date(Date.now() - threshold - 60_000);
    await db
      .update(gatewayRegistrationsTable)
      .set({ lastHeartbeatAt: stale, lastSeenAt: stale })
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    res = await admin.get("/api/gateway/registrations");
    mine = (res.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId)!;
    expect(mine.silent).toBe(true);

    // A resumed heartbeat clears the verdict again.
    const resume = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() });
    expect(resume.status).toBe(200);
    res = await admin.get("/api/gateway/registrations");
    mine = (res.body as Array<Record<string, unknown>>).find((r) => r.id === registrationId)!;
    expect(mine.silent).toBe(false);
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

  it("rate-limits audit rows: an identical reconcile outcome is not re-audited", async () => {
    const probeUuid = `${randomUUID()}-recon-dedupe`;
    const payload = { batches: [{ batchUuid: probeUuid, eventCount: 4 }] };

    const first = await postSigned("/api/gateway/reconcile", payload);
    expect(first.status).toBe(200);
    expect(first.body.audited).toBe(true);

    // Same outcome again, immediately: no new audit row.
    const second = await postSigned("/api/gateway/reconcile", payload);
    expect(second.status).toBe(200);
    expect(second.body.audited).toBe(false);

    const countRows = async () => {
      const rows = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "gateway_reconcile"));
      return rows.filter((r) => r.entityId === registrationId && (r.changesJson ?? "").includes(probeUuid)).length;
    };
    expect(await countRows()).toBe(1);

    // A CHANGED outcome is audited immediately, even inside the window.
    const changed = await postSigned("/api/gateway/reconcile", {
      batches: [{ batchUuid: probeUuid, eventCount: 4 }, { batchUuid: `${probeUuid}-2`, eventCount: 1 }],
    });
    expect(changed.status).toBe(200);
    expect(changed.body.audited).toBe(true);
    expect(await countRows()).toBe(2);
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

describe("terminal batch export (last-resort CSV recovery)", () => {
  it("exports a stuck batch as CSV (metadata only) that the CSV import path re-ingests", async () => {
    const dir = path.join(os.tmpdir(), `gw-export-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();
    const deadFetch: typeof fetch = (async () => { throw new Error("network unreachable"); }) as typeof fetch;
    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: deadFetch });
    const adapter = new SimulatorAdapter([DEVICE_USER_ID], () => new Date("2030-06-14T14:00:00Z"));
    const service = new GatewayService(queue, hr, adapter, { maxAttempts: 1, baseBackoffMs: 0 });
    const token = "export-operator-token";
    const local = buildLocalApi({ service, adapter, adminToken: token });

    // Spool a batch. While it is still pending (not terminal), export is
    // refused even with the operator token — export is strictly a last
    // resort for batches that exhausted automatic delivery.
    const polled = await service.pollOnce();
    expect(polled.queued).toBe(2);
    expect(
      (await request(local).get(`/terminal-batches/${polled.batchUuid}/export`).set("x-gateway-admin-token", token)).status,
    ).toBe(404);

    // Let it go terminal (persistent delivery failure).
    await service.flush();
    const stored = await queue.read(polled.batchUuid!);
    expect(stored!.terminal).toBe(true);
    // The spooled punches carry raw vendor metadata that must NOT be exported.
    expect(stored!.punches.some((p) => p.raw && Object.keys(p.raw).length > 0)).toBe(true);

    // Export requires the operator token — this is decrypted punch data.
    expect((await request(local).get(`/terminal-batches/${polled.batchUuid}/export`)).status).toBe(401);
    // Unknown batch → 404 even with the token.
    expect(
      (await request(local).get(`/terminal-batches/${randomUUID()}/export`).set("x-gateway-admin-token", token)).status,
    ).toBe(404);

    const res = await request(local)
      .get(`/terminal-batches/${polled.batchUuid}/export`)
      .set("x-gateway-admin-token", token);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`punch-batch-${polled.batchUuid}.csv`);
    const csv = res.text;

    // Nothing beyond punch metadata leaves the spool: no raw payload keys,
    // no biometric-adjacent fields.
    expect(csv.split(/\r?\n/)[0]).toBe("device_user_id,employee_id,event_time,event_type,event_uid");
    for (const forbidden of ["raw", "template", "biometric", "csvRow"]) {
      expect(csv.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    // The export parses cleanly through the existing CSV import parser and
    // preserves the original punches (uids included → server dedupe holds).
    const { punches, errors } = parseCsvPunches(csv);
    expect(errors).toEqual([]);
    expect(punches).toHaveLength(2);
    for (let i = 0; i < punches.length; i++) {
      expect(punches[i].deviceUserId).toBe(stored!.punches[i].deviceUserId);
      expect(punches[i].eventTime).toBe(stored!.punches[i].eventTime);
      expect(punches[i].eventType).toBe(stored!.punches[i].eventType);
      expect(punches[i].deviceEventUid).toBe(stored!.punches[i].deviceEventUid);
    }

    // Full round trip: a CSV-adapter gateway imports the exported file and
    // delivers the punches to the HR core.
    const csvDir = path.join(os.tmpdir(), `gw-export-csv-${Date.now()}`);
    const csvQueue = new EncryptedQueue(csvDir, "test-queue-key");
    await csvQueue.init();
    const { CsvAdapter } = await import("../../../../lib/attendance-gateway/src/adapters/csv.js");
    const csvAdapter = new CsvAdapter();
    const csvHr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const csvService = new GatewayService(csvQueue, csvHr, csvAdapter);
    const csvLocal = buildLocalApi({ service: csvService, adapter: csvAdapter, adminToken: token });
    const imported = await request(csvLocal)
      .post("/import-csv")
      .set("x-gateway-admin-token", token)
      .send({ content: csv });
    expect(imported.status).toBe(200);
    expect(imported.body.queued).toBe(2);
    expect(imported.body.flush.sent).toBe(1);

    // cleanup rows created by the re-import
    const [b] = await db
      .select()
      .from(punchImportBatchesTable)
      .where(eq(punchImportBatchesTable.batchUuid, imported.body.batchUuid));
    createdBatchIds.push(b.id);
    await db.delete(punchEventsTable).where(eq(punchEventsTable.importBatchId, b.id));
    await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, "2030-06-14"));
  });
});

describe("terminal batch discard (operator retirement after confirmed recovery)", () => {
  it("full flow: export → import → confirm (reconcile OK) → discard removes the batch from spool", async () => {
    // Build an isolated gateway that cannot reach the HR core directly.
    const dir = path.join(os.tmpdir(), `gw-discard-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();
    const deadFetch: typeof fetch = (async () => { throw new Error("network unreachable"); }) as typeof fetch;
    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: deadFetch });
    const adapter = new SimulatorAdapter([DEVICE_USER_ID], () => new Date("2030-06-15T08:00:00Z"));
    const service = new GatewayService(queue, hr, adapter, { maxAttempts: 1, baseBackoffMs: 0 });
    const token = "discard-operator-token";
    const local = buildLocalApi({ service, adapter, adminToken: token });

    // Spool a batch and let it go terminal.
    const polled = await service.pollOnce();
    expect(polled.queued).toBe(2);
    await service.flush(); // exhausts maxAttempts → terminal
    const stored = await queue.read(polled.batchUuid!);
    expect(stored!.terminal).toBe(true);

    // Export the stuck batch as CSV.
    const exportRes = await request(local)
      .get(`/terminal-batches/${polled.batchUuid}/export`)
      .set("x-gateway-admin-token", token);
    expect(exportRes.status).toBe(200);
    const csv = exportRes.text;

    // Re-import via a CSV-adapter gateway that CAN reach the HR core.
    const csvDir = path.join(os.tmpdir(), `gw-discard-csv-${Date.now()}`);
    const csvQueue = new EncryptedQueue(csvDir, "test-queue-key");
    await csvQueue.init();
    const { CsvAdapter } = await import("../../../../lib/attendance-gateway/src/adapters/csv.js");
    const csvAdapter = new CsvAdapter();
    const liveHr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const csvService = new GatewayService(csvQueue, liveHr, csvAdapter);
    const csvLocal = buildLocalApi({ service: csvService, adapter: csvAdapter, adminToken: token });
    const imported = await request(csvLocal)
      .post("/import-csv")
      .set("x-gateway-admin-token", token)
      .send({ content: csv });
    expect(imported.status).toBe(200);
    expect(imported.body.queued).toBe(2);
    expect(imported.body.flush.sent).toBe(1);

    // Build a live service (same queue, live HR client) for the refusal and
    // force-discard checks. The original batch UUID was never delivered to the
    // server (the gateway used deadFetch), so reconcile returns MISSING_ON_SERVER.
    const liveService = new GatewayService(queue, liveHr, adapter, { maxAttempts: 1, baseBackoffMs: 0 });
    const liveLocal = buildLocalApi({ service: liveService, adapter, adminToken: token });

    // Safety gate: server returns MISSING_ON_SERVER → discard is refused (409).
    const refusedRes = await request(liveLocal)
      .delete(`/terminal-batches/${polled.batchUuid}`)
      .set("x-gateway-admin-token", token);
    expect(refusedRes.status).toBe(409);
    expect(refusedRes.body.serverStatus).toMatch(/MISSING_ON_SERVER/i);

    // The batch is still in the spool after the refusal.
    expect(await queue.read(polled.batchUuid!)).not.toBeNull();

    // Force-discard overrides the safety gate and removes the batch.
    const forceRes = await request(liveLocal)
      .delete(`/terminal-batches/${polled.batchUuid}?force=true`)
      .set("x-gateway-admin-token", token);
    expect(forceRes.status).toBe(200);
    expect(forceRes.body.ok).toBe(true);
    expect(forceRes.body.punchCount).toBe(2);

    // Batch is gone from the spool.
    expect(await queue.read(polled.batchUuid!)).toBeNull();
    expect((await service.listTerminalBatches()).find((b) => b.batchUuid === polled.batchUuid)).toBeUndefined();

    // cleanup: rows delivered by the CSV re-import
    const [b] = await db
      .select()
      .from(punchImportBatchesTable)
      .where(eq(punchImportBatchesTable.batchUuid, imported.body.batchUuid));
    createdBatchIds.push(b.id);
    await db.delete(punchEventsTable).where(eq(punchEventsTable.importBatchId, b.id));
    await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.date, "2030-06-15"));
  });

  it("discard requires the operator token — anonymous delete is 401", async () => {
    const dir = path.join(os.tmpdir(), `gw-discard-auth-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();
    const adapter = new SimulatorAdapter([DEVICE_USER_ID]);
    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const service = new GatewayService(queue, hr, adapter);
    const local = buildLocalApi({ service, adapter, adminToken: "auth-test-token" });
    const fakeUuid = randomUUID();
    // No token → 401
    expect((await request(local).delete(`/terminal-batches/${fakeUuid}`)).status).toBe(401);
    // Wrong token → 401
    expect((await request(local).delete(`/terminal-batches/${fakeUuid}`).set("x-gateway-admin-token", "wrong")).status).toBe(401);
  });

  it("discard of an unknown or non-terminal batch returns 404", async () => {
    const dir = path.join(os.tmpdir(), `gw-discard-404-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();
    const adapter = new SimulatorAdapter([DEVICE_USER_ID]);
    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const service = new GatewayService(queue, hr, adapter);
    const token = "404-test-token";
    const local = buildLocalApi({ service, adapter, adminToken: token });

    // Completely unknown uuid
    const unknownRes = await request(local)
      .delete(`/terminal-batches/${randomUUID()}`)
      .set("x-gateway-admin-token", token);
    expect(unknownRes.status).toBe(404);

    // Pending (not yet terminal) batch — export and discard are both refused.
    const polled = await service.pollOnce();
    if (polled.batchUuid) {
      const pendingRes = await request(local)
        .delete(`/terminal-batches/${polled.batchUuid}`)
        .set("x-gateway-admin-token", token);
      expect(pendingRes.status).toBe(404);
      // clean up the pending batch
      await queue.remove(polled.batchUuid);
    }
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

  it("end to end: tick() forwards SDK info and a skewed device clock to the HR core", async () => {
    const skewedAdapter: import("../../../../lib/attendance-gateway/src/types.js").DeviceAdapter = {
      type: "ZKTECO_NATIVE",
      sdkInfo: () => ({ present: true, version: "3.1.0" }),
      testConnection: async () => ({
        ok: true,
        status: "REACHABLE",
        message: "device reachable",
        deviceTimeMs: Date.now() + 120_000, // device clock 2 minutes ahead
      }),
      poll: async () => ({ punches: [], nextCursor: null }),
    };
    const { outcome, reg } = await tickWith(skewedAdapter);
    expect(outcome.heartbeatError).toBeNull();
    expect(reg.sdkPresent).toBe(true);
    expect(reg.sdkVersion).toBe("3.1.0");
    expect(reg.deviceClockSkewMs).not.toBeNull();
    expect(Math.abs((reg.deviceClockSkewMs ?? 0) - 120_000)).toBeLessThan(10_000);
  });

  it("end to end: tick() reports a missing vendor SDK inferred from the connection test", async () => {
    const noSdkAdapter: import("../../../../lib/attendance-gateway/src/types.js").DeviceAdapter = {
      type: "SUPREMA_NATIVE",
      testConnection: async () => ({
        ok: false,
        status: "NOT_CONFIGURED",
        message: "vendor SDK not installed",
        requiresVendorSdk: true,
      }),
      poll: async () => { throw new Error("vendor SDK not installed"); },
    };
    const { outcome, reg } = await tickWith(noSdkAdapter);
    expect(outcome.heartbeatError).toBeNull();
    expect(reg.sdkPresent).toBe(false);
    expect(reg.deviceClockSkewMs).toBeNull(); // no deviceTimeMs → skew unknown, not fabricated
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

describe("end-to-end timing: nudge delivers a fresh connection-test result within nudgeIntervalMs", () => {
  /**
   * End-to-end proof of the two-phase resolution protocol:
   *
   *  Phase 1 — stale tick: the gateway ran testConnection() BEFORE the admin
   *    clicked. connectionTestRunAt < connTestRequestedAt so the server returns
   *    testRequested: true and does NOT clear the flag. The scheduler would fire
   *    a nudge at ≤ nudgeIntervalMs (covered by nudgeScheduling.test.ts).
   *
   *  Phase 2 — fresh tick (the nudge): connectionTestRunAt >= connTestRequestedAt
   *    so the server clears the flag and returns testRequested: false.
   *
   * The test calls service.tick() directly twice so async HTTP calls complete
   * naturally without fighting the scheduler's MIN_NUDGE_INTERVAL_MS floor (5 s).
   * The scheduler's timing contract ("nudge fires within nudgeIntervalMs") is
   * already proved by the fake-timer tests in nudgeScheduling.test.ts.
   */
  it("stale tick: flag stays + testRequested:true; fresh tick: flag cleared + testRequested:false", async () => {
    const dir = path.join(os.tmpdir(), `gw-e2e-nudge-${Date.now()}`);
    const queue = new EncryptedQueue(dir, "test-queue-key");
    await queue.init();

    const hr = new HrClient({ hrApiUrl: "/api", gatewayId: registrationId, signingKey, fetchImpl: supertestFetch() });
    const service = new GatewayService(queue, hr, new SimulatorAdapter([]));

    // Set connTestRequestedAt 100 ms into the future.
    // connectionTestRunAt is captured at the VERY START of service.tick()
    // (before any async work), so even a slow first tick sees:
    //   connectionTestRunAt ≈ now < connTestRequestedAt = now + 100 ms → stale.
    const STALE_OFFSET_MS = 100;
    const testRequestedAt = new Date(Date.now() + STALE_OFFSET_MS);
    await db
      .update(gatewayRegistrationsTable)
      .set({ connTestRequestedAt: testRequestedAt })
      .where(eq(gatewayRegistrationsTable.id, registrationId));

    // — Tick 1 (stale) ——————————————————————————————————————————————————————
    const tick1 = await service.tick();

    expect(tick1.testRequested).toBe(true); // pending: result pre-dates request ✓
    const [afterTick1] = await db
      .select({ connTestRequestedAt: gatewayRegistrationsTable.connTestRequestedAt })
      .from(gatewayRegistrationsTable)
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(afterTick1.connTestRequestedAt).not.toBeNull(); // flag NOT cleared ✓

    // — Wait for connTestRequestedAt to pass ——————————————————————————————
    // In production the scheduler fires a nudge after nudgeIntervalMs (default
    // 10 s, floored at 5 s). Here we just wait until the stale window expires
    // so the next tick's connectionTestRunAt >= connTestRequestedAt.
    const msUntilFresh = Math.max(0, testRequestedAt.getTime() - Date.now()) + 20;
    await new Promise<void>(resolve => setTimeout(resolve, msUntilFresh));

    // — Tick 2 (fresh / nudge) ——————————————————————————————————————————————
    const tick2 = await service.tick();

    expect(tick2.testRequested).toBe(false); // answered: result post-dates request ✓
    const [afterTick2] = await db
      .select({ connTestRequestedAt: gatewayRegistrationsTable.connTestRequestedAt })
      .from(gatewayRegistrationsTable)
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    expect(afterTick2.connTestRequestedAt).toBeNull(); // flag cleared ✓
  }, 5_000);
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
