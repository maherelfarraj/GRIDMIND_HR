/**
 * Remote device restart — POST /devices/:id/restart queues a RESTART command
 * for the device's ACTIVE gateway; the signed heartbeat delivers it
 * (PENDING → DELIVERED) and the signed ack endpoint records the outcome
 * (→ ACKNOWLEDGED | FAILED). Covers:
 *   - restart without an active gateway → 409
 *   - restart queues a PENDING command (201)
 *   - duplicate restart while one is in flight → 409
 *   - heartbeat delivers pending commands exactly once
 *   - ack from the owning gateway transitions to ACKNOWLEDGED / FAILED
 *   - ack from a different gateway is rejected (NOT_FOUND)
 *   - GET /devices/:id/commands returns the feedback the UI shows
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash, createHmac } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  attendanceDevicesTable,
  gatewayRegistrationsTable,
  deviceCommandsTable,
} from "@workspace/db";
import app from "../app";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const deriveSigningKey = (secret: string) => sha256(secret);

const admin = request.agent(app);

let deviceId: number;
let orphanDeviceId: number; // device with no gateway
let regId: number;
let signingKey: string;
let otherRegId: number;
let otherSigningKey: string;

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
  const mkDevice = (n: string) => admin.post("/api/devices").send({
    name: `Restart Test ${n} ${suffix}`,
    serialNumber: `RST-${n}-${suffix}`,
    model: "T-1000",
    vendor: "TestVendor",
    type: "fingerprint",
    location: "Test Lab",
    locationAr: "مختبر",
    status: "online",
    integrationProtocol: "TCP/IP",
  });
  const d1 = await mkDevice("A");
  expect(d1.status).toBe(201);
  deviceId = d1.body.id;
  const d2 = await mkDevice("B");
  orphanDeviceId = d2.body.id;

  const r1 = await admin.post("/api/gateway/registrations").send({ name: `Restart GW ${suffix}`, adapterType: "SIMULATOR", deviceId });
  expect(r1.status).toBe(201);
  regId = r1.body.id;
  signingKey = deriveSigningKey(r1.body.secret);

  const r2 = await admin.post("/api/gateway/registrations").send({ name: `Other GW ${suffix}`, adapterType: "SIMULATOR" });
  otherRegId = r2.body.id;
  otherSigningKey = deriveSigningKey(r2.body.secret);
});

afterAll(async () => {
  await db.delete(deviceCommandsTable).where(inArray(deviceCommandsTable.registrationId, [regId, otherRegId].filter(Boolean)));
  await db.delete(gatewayRegistrationsTable).where(inArray(gatewayRegistrationsTable.id, [regId, otherRegId].filter(Boolean)));
  await db.delete(attendanceDevicesTable).where(inArray(attendanceDevicesTable.id, [deviceId, orphanDeviceId].filter(Boolean)));
});

describe("device restart command flow", () => {
  it("requires a real session for restart and command feedback, even in demo mode", async () => {
    const anonRestart = await request(app).post(`/api/devices/${deviceId}/restart`);
    expect(anonRestart.status).toBe(401);
    const anonFeed = await request(app).get(`/api/devices/${deviceId}/commands`);
    expect(anonFeed.status).toBe(401);
    const [none] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.deviceId, deviceId));
    expect(none).toBeUndefined();
  });

  it("expires a stale pending command instead of delivering it via heartbeat", async () => {
    const [stale] = await db
      .insert(deviceCommandsTable)
      .values({
        deviceId,
        registrationId: regId,
        command: "RESTART",
        createdAt: new Date(Date.now() - 16 * 60 * 1000), // beyond the 15-min TTL
      })
      .returning();
    const hb = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, signingKey, regId);
    expect(hb.status).toBe(200);
    expect(hb.body.commands).toEqual([]);
    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, stale.id));
    expect(row.status).toBe("EXPIRED");
    await db.delete(deviceCommandsTable).where(eq(deviceCommandsTable.id, stale.id));
  });

  it("rejects restart when no active gateway serves the device", async () => {
    const res = await admin.post(`/api/devices/${orphanDeviceId}/restart`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/gateway/i);
  });

  it("404s for a nonexistent device", async () => {
    const res = await admin.post(`/api/devices/99999999/restart`);
    expect(res.status).toBe(404);
  });

  let commandId: number;

  it("queues a PENDING restart command", async () => {
    const res = await admin.post(`/api/devices/${deviceId}/restart`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.command).toBe("RESTART");
    expect(res.body.registrationId).toBe(regId);
    commandId = res.body.id;
  });

  it("rejects a duplicate restart while one is in flight", async () => {
    const res = await admin.post(`/api/devices/${deviceId}/restart`);
    expect(res.status).toBe(409);
  });

  it("shows the pending command in the device command feed", async () => {
    const res = await admin.get(`/api/devices/${deviceId}/commands`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(commandId);
    expect(res.body[0].status).toBe("PENDING");
  });

  it("delivers the command via signed heartbeat exactly once", async () => {
    const hb = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, signingKey, regId);
    expect(hb.status).toBe(200);
    expect(hb.body.commands).toEqual([{ id: commandId, deviceId, command: "RESTART" }]);

    // Second heartbeat: nothing pending anymore.
    const hb2 = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, signingKey, regId);
    expect(hb2.body.commands).toEqual([]);

    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, commandId));
    expect(row.status).toBe("DELIVERED");
    expect(row.deliveredAt).not.toBeNull();
  });

  it("rejects an ack from a gateway the command was not delivered to", async () => {
    const res = await postSigned("/api/gateway/commands/ack", { acks: [{ commandId, ok: true }] }, otherSigningKey, otherRegId);
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("NOT_FOUND");
    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, commandId));
    expect(row.status).toBe("DELIVERED");
  });

  it("records the gateway's acknowledgement", async () => {
    const res = await postSigned(
      "/api/gateway/commands/ack",
      { acks: [{ commandId, ok: true, message: "Device rebooted" }] },
      signingKey,
      regId,
    );
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("ACKNOWLEDGED");

    const feed = await admin.get(`/api/devices/${deviceId}/commands`);
    expect(feed.body[0].status).toBe("ACKNOWLEDGED");
    expect(feed.body[0].resultMessage).toBe("Device rebooted");
    expect(feed.body[0].acknowledgedAt).not.toBeNull();
  });

  it("allows a new restart after the previous one completed, and records failure acks", async () => {
    const res = await admin.post(`/api/devices/${deviceId}/restart`);
    expect(res.status).toBe(201);
    const secondId = res.body.id;

    const hb = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() }, signingKey, regId);
    expect(hb.body.commands.map((c: { id: number }) => c.id)).toContain(secondId);

    const ack = await postSigned(
      "/api/gateway/commands/ack",
      { acks: [{ commandId: secondId, ok: false, message: "Adapter does not support remote restart" }] },
      signingKey,
      regId,
    );
    expect(ack.body.results[0].status).toBe("FAILED");

    const feed = await admin.get(`/api/devices/${deviceId}/commands`);
    expect(feed.body[0].status).toBe("FAILED");
    expect(feed.body[0].resultMessage).toMatch(/does not support/);
  });

  it("requires a valid signature on the ack endpoint", async () => {
    const res = await request(app)
      .post("/api/gateway/commands/ack")
      .set("content-type", "application/json")
      .send(JSON.stringify({ acks: [{ commandId, ok: true }] }));
    expect(res.status).toBe(401);
  });
});
