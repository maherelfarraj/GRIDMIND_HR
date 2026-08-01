/**
 * Restart-outcome notifications — the operator who requested a device
 * restart must learn the outcome even after leaving the device page:
 *   - ACKNOWLEDGED ack → success notification with the device name
 *   - FAILED ack → error notification carrying the gateway's message
 *   - server-side expiry sweep (expireStaleDeviceCommandsOnce) expires stale
 *     commands with no page read involved and notifies the requester
 *   - commands with no requester produce no notification
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash, createHmac } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  attendanceDevicesTable,
  gatewayRegistrationsTable,
  deviceCommandsTable,
  notificationsTable,
  systemUsersTable,
} from "@workspace/db";
import app from "../app";
import {
  DEVICE_COMMAND_OUTCOME_TYPE,
  expireStaleDeviceCommandsOnce,
  flushDeferredCommandNotifications,
  backfillMissedCommandOutcomeNotifications,
  notifyCommandOutcomes,
} from "../lib/deviceCommandNotifications";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const admin = request.agent(app);

let adminUserId: number;
let deviceId: number;
let deviceName: string;
let regId: number;
let signingKey: string;

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

async function postSigned(url: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return request(app).post(url).set(signedHeaders(body, signingKey, regId)).send(body);
}

async function myNotifications() {
  return db
    .select()
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.notificationType, DEVICE_COMMAND_OUTCOME_TYPE),
      eq(notificationsTable.recipientUserId, adminUserId),
    ));
}

async function requestRestartAndDeliver(): Promise<number> {
  const restart = await admin.post(`/api/devices/${deviceId}/restart`);
  expect(restart.status).toBe(201);
  expect(restart.body.requestedByUserId).toBe(adminUserId);
  const hb = await postSigned("/api/gateway/heartbeat", { deviceTimeMs: Date.now() });
  expect(hb.status).toBe(200);
  const delivered = hb.body.commands.find((c: { id: number }) => c.id === restart.body.id);
  expect(delivered).toBeTruthy();
  return restart.body.id as number;
}

beforeAll(async () => {
  const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
  expect(login.status).toBe(200);
  const [adminUser] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.username, "admin"));
  adminUserId = adminUser.id;

  const suffix = Date.now() % 1000000;
  deviceName = `Notify Test Device ${suffix}`;
  const d = await admin.post("/api/devices").send({
    name: deviceName,
    serialNumber: `NOTIF-${suffix}`,
    model: "T-1000",
    vendor: "TestVendor",
    type: "fingerprint",
    location: "Test Lab",
    locationAr: "مختبر",
    status: "online",
    integrationProtocol: "TCP/IP",
  });
  expect(d.status).toBe(201);
  deviceId = d.body.id;

  const r = await admin.post("/api/gateway/registrations").send({ name: `Notify GW ${suffix}`, adapterType: "SIMULATOR", deviceId });
  expect(r.status).toBe(201);
  regId = r.body.id;
  signingKey = sha256(r.body.secret);
});

afterAll(async () => {
  await db.delete(notificationsTable).where(eq(notificationsTable.notificationType, DEVICE_COMMAND_OUTCOME_TYPE));
  if (regId) await db.delete(deviceCommandsTable).where(eq(deviceCommandsTable.registrationId, regId));
  if (regId) await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, regId));
  if (deviceId) await db.delete(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, deviceId));
});

describe("restart outcome notifications", () => {
  it("notifies the requester when the gateway acknowledges the restart", async () => {
    const commandId = await requestRestartAndDeliver();
    const ack = await postSigned("/api/gateway/commands/ack", { acks: [{ commandId, ok: true, message: "rebooted in 4s" }] });
    expect(ack.status).toBe(200);
    // Notification writes are deferred off the ack request path.
    await flushDeferredCommandNotifications();

    const notes = await myNotifications();
    const note = notes.find((n) => n.entityId === commandId);
    expect(note).toBeTruthy();
    expect(note!.severity).toBe("success");
    expect(note!.titleEn).toContain(deviceName);
    expect(note!.bodyEn).toContain("rebooted in 4s");
    expect(note!.entityType).toBe("device_command");
  });

  it("notifies the requester with the gateway's message when the restart fails", async () => {
    const commandId = await requestRestartAndDeliver();
    const ack = await postSigned("/api/gateway/commands/ack", { acks: [{ commandId, ok: false, message: "device did not respond to reboot" }] });
    expect(ack.status).toBe(200);
    await flushDeferredCommandNotifications();

    const note = (await myNotifications()).find((n) => n.entityId === commandId);
    expect(note).toBeTruthy();
    expect(note!.severity).toBe("error");
    expect(note!.titleEn).toContain(deviceName);
    expect(note!.bodyEn).toContain("device did not respond to reboot");
  });

  it("expires stale commands server-side (no page read) and notifies the requester", async () => {
    const [stale] = await db
      .insert(deviceCommandsTable)
      .values({
        deviceId,
        registrationId: regId,
        command: "RESTART",
        requestedByUserId: adminUserId,
        createdAt: new Date(Date.now() - 16 * 60 * 1000), // beyond the 15-min TTL
      })
      .returning();

    const expired = await expireStaleDeviceCommandsOnce();
    expect(expired).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, stale.id));
    expect(row.status).toBe("EXPIRED");

    const note = (await myNotifications()).find((n) => n.entityId === stale.id);
    expect(note).toBeTruthy();
    expect(note!.severity).toBe("warning");
    expect(note!.titleEn).toContain(deviceName);
    expect(note!.bodyEn).toContain("NOT restarted");
  });

  it("does not notify anyone for a command with no requester", async () => {
    const [orphan] = await db
      .insert(deviceCommandsTable)
      .values({
        deviceId,
        registrationId: regId,
        command: "RESTART",
        requestedByUserId: null,
        createdAt: new Date(Date.now() - 16 * 60 * 1000),
      })
      .returning();

    await expireStaleDeviceCommandsOnce();

    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, orphan.id));
    expect(row.status).toBe("EXPIRED");
    const notes = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.notificationType, DEVICE_COMMAND_OUTCOME_TYPE),
        eq(notificationsTable.entityId, orphan.id),
      ));
    expect(notes).toHaveLength(0);
  });

  it("backfills a terminal command whose deferred notification was lost to a restart", async () => {
    // Simulate the crash window: the ack transitioned the command to a
    // terminal state, but the process died before the deferred insert ran —
    // so the row is terminal with no notification and no claim.
    const [lost] = await db
      .insert(deviceCommandsTable)
      .values({
        deviceId,
        registrationId: regId,
        command: "RESTART",
        status: "ACKNOWLEDGED",
        requestedByUserId: adminUserId,
        resultMessage: "rebooted before the crash",
        acknowledgedAt: new Date(),
      })
      .returning();

    const backfilled = await backfillMissedCommandOutcomeNotifications();
    expect(backfilled).toBeGreaterThanOrEqual(1);

    const note = (await myNotifications()).find((n) => n.entityId === lost.id);
    expect(note).toBeTruthy();
    expect(note!.severity).toBe("success");
    expect(note!.bodyEn).toContain("rebooted before the crash");

    // The claim is recorded, so subsequent sweeps skip this command.
    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, lost.id));
    expect(row.outcomeNotifiedAt).not.toBeNull();
  });

  it("never duplicates a notification when the sweep races the deferred write", async () => {
    const commandId = await requestRestartAndDeliver();
    const ack = await postSigned("/api/gateway/commands/ack", { acks: [{ commandId, ok: true, message: "ok" }] });
    expect(ack.status).toBe(200);
    // Run the backfill sweep concurrently with the still-pending deferred
    // write, then again after everything settled, plus a direct re-notify.
    await Promise.all([backfillMissedCommandOutcomeNotifications(), flushDeferredCommandNotifications()]);
    await backfillMissedCommandOutcomeNotifications();
    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, commandId));
    await notifyCommandOutcomes([row]);

    const notes = (await myNotifications()).filter((n) => n.entityId === commandId);
    expect(notes).toHaveLength(1);
  });

  it("backfill skips terminal commands with no requester", async () => {
    const [orphan] = await db
      .insert(deviceCommandsTable)
      .values({
        deviceId,
        registrationId: regId,
        command: "RESTART",
        status: "FAILED",
        requestedByUserId: null,
      })
      .returning();

    await backfillMissedCommandOutcomeNotifications();
    const notes = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.notificationType, DEVICE_COMMAND_OUTCOME_TYPE),
        eq(notificationsTable.entityId, orphan.id),
      ));
    expect(notes).toHaveLength(0);
  });
});
