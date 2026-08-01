/**
 * HR-admin-triggered gateway reconcile — POST /gateway/registrations/:id/reconcile
 * queues a RECONCILE command for the gateway; the signed heartbeat delivers it
 * (PENDING → DELIVERED, deviceSerial null) and the signed ack endpoint records
 * the outcome. Covers:
 *   - session required (401 anonymous)
 *   - queue on an active registration → 201 PENDING (deviceId null)
 *   - duplicate while in flight → 409
 *   - revoked / unknown registration → 409 / 404
 *   - heartbeat delivers the command exactly once
 *   - ack transitions to ACKNOWLEDGED and the registrations list + commands
 *     feed expose the feedback the admin UI shows
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash, createHmac } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, gatewayRegistrationsTable, deviceCommandsTable, auditLogsTable } from "@workspace/db";
import app from "../app";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const admin = request.agent(app);

let regId: number;
let signingKey: string;
let revokedRegId: number;

function signedHeaders(body: string, key: string, reg: number) {
  const ts = Date.now();
  const sig = createHmac("sha256", key).update(`${ts}.${sha256(body)}`).digest("hex");
  return {
    "content-type": "application/json",
    "x-gateway-id": String(reg),
    "x-gateway-timestamp": String(ts),
    "x-gateway-signature": sig,
  };
}

async function postSigned(url: string, payload: unknown, key: string, reg: number) {
  const body = JSON.stringify(payload);
  return request(app).post(url).set(signedHeaders(body, key, reg)).send(body);
}

beforeAll(async () => {
  const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
  expect(login.status).toBe(200);

  const suffix = Date.now() % 1000000;
  const r1 = await admin.post("/api/gateway/registrations").send({ name: `Reconcile GW ${suffix}`, adapterType: "SIMULATOR" });
  expect(r1.status).toBe(201);
  regId = r1.body.id;
  signingKey = sha256(r1.body.secret);

  const r2 = await admin.post("/api/gateway/registrations").send({ name: `Revoked GW ${suffix}`, adapterType: "SIMULATOR" });
  revokedRegId = r2.body.id;
  await admin.post(`/api/gateway/registrations/${revokedRegId}/revoke`);
});

afterAll(async () => {
  const ids = [regId, revokedRegId].filter(Boolean);
  await db.delete(deviceCommandsTable).where(inArray(deviceCommandsTable.registrationId, ids));
  await db.delete(auditLogsTable).where(
    inArray(auditLogsTable.action, ["gateway_reconcile_requested"]),
  );
  await db.delete(gatewayRegistrationsTable).where(inArray(gatewayRegistrationsTable.id, ids));
});

describe("admin-triggered gateway reconcile command flow", () => {
  it("requires a session even in demo mode", async () => {
    const res = await request(app).post(`/api/gateway/registrations/${regId}/reconcile`);
    expect(res.status).toBe(401);
  });

  it("404s for an unknown registration and 409s for a revoked one", async () => {
    expect((await admin.post(`/api/gateway/registrations/99999999/reconcile`)).status).toBe(404);
    const revoked = await admin.post(`/api/gateway/registrations/${revokedRegId}/reconcile`);
    expect(revoked.status).toBe(409);
    expect(revoked.body.error).toMatch(/not active/i);
  });

  let commandId: number;

  it("queues a PENDING RECONCILE command with no target device and audits the request", async () => {
    const res = await admin.post(`/api/gateway/registrations/${regId}/reconcile`);
    expect(res.status).toBe(201);
    expect(res.body.command).toBe("RECONCILE");
    expect(res.body.status).toBe("PENDING");
    expect(res.body.deviceId).toBeNull();
    expect(res.body.registrationId).toBe(regId);
    commandId = res.body.id;

    const [audit] = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "gateway_reconcile_requested"));
    expect(audit).toBeDefined();
    expect(audit.entityId).toBe(regId);
  });

  it("rejects a duplicate reconcile while one is in flight", async () => {
    const res = await admin.post(`/api/gateway/registrations/${regId}/reconcile`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already pending/i);
  });

  it("exposes the pending command on the registrations list and commands feed", async () => {
    const list = await admin.get("/api/gateway/registrations");
    const reg = list.body.find((r: { id: number }) => r.id === regId);
    expect(reg.reconcileCommand).toMatchObject({ id: commandId, status: "PENDING" });

    const feed = await admin.get(`/api/gateway/registrations/${regId}/commands`);
    expect(feed.status).toBe(200);
    expect(feed.body[0]).toMatchObject({ id: commandId, command: "RECONCILE", status: "PENDING" });
  });

  it("delivers the command via signed heartbeat exactly once, with a null serial", async () => {
    const hb = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, signingKey, regId);
    expect(hb.status).toBe(200);
    expect(hb.body.commands).toEqual([{ id: commandId, deviceId: null, command: "RECONCILE", deviceSerial: null }]);

    const hb2 = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, signingKey, regId);
    expect(hb2.body.commands).toEqual([]);
  });

  it("records the gateway's reconcile ack and allows a new request afterwards", async () => {
    const ack = await postSigned(
      "/api/gateway/commands/ack",
      { acks: [{ commandId, ok: true, message: "Reconciled 2 batches: 0 missing, 0 count mismatch" }] },
      signingKey,
      regId,
    );
    expect(ack.status).toBe(200);
    expect(ack.body.results[0].status).toBe("ACKNOWLEDGED");

    const list = await admin.get("/api/gateway/registrations");
    const reg = list.body.find((r: { id: number }) => r.id === regId);
    expect(reg.reconcileCommand).toMatchObject({
      id: commandId,
      status: "ACKNOWLEDGED",
      resultMessage: "Reconciled 2 batches: 0 missing, 0 count mismatch",
    });

    const again = await admin.post(`/api/gateway/registrations/${regId}/reconcile`);
    expect(again.status).toBe(201);
  });
});
