/**
 * Graceful-shutdown flush of deferred command-outcome notifications:
 *   - a deferred write still pending at shutdown completes when flushed via
 *     flushDeferredCommandNotificationsWithTimeout (the notification row
 *     exists before the flush resolves)
 *   - the flush resolves immediately when nothing is pending
 *   - the flush gives up (returns false) when the timeout elapses first
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
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
  notifyCommandOutcomesDeferred,
  flushDeferredCommandNotificationsWithTimeout,
  pendingDeferredCommandNotificationCount,
  type CommandOutcomeRow,
} from "../lib/deviceCommandNotifications";

const admin = request.agent(app);

let adminUserId: number;
let deviceId: number;
let regId: number;
const commandIds: number[] = [];

beforeAll(async () => {
  const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
  expect(login.status).toBe(200);
  const [adminUser] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.username, "admin"));
  adminUserId = adminUser.id;

  const suffix = Date.now() % 1000000;
  const d = await admin.post("/api/devices").send({
    name: `Shutdown Flush Device ${suffix}`,
    serialNumber: `SHDN-${suffix}`,
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

  const r = await admin.post("/api/gateway/registrations").send({ name: `Shutdown GW ${suffix}`, adapterType: "SIMULATOR", deviceId });
  expect(r.status).toBe(201);
  regId = r.body.id;
});

afterAll(async () => {
  if (commandIds.length) {
    for (const id of commandIds) {
      await db.delete(notificationsTable).where(and(
        eq(notificationsTable.notificationType, DEVICE_COMMAND_OUTCOME_TYPE),
        eq(notificationsTable.entityId, id),
      ));
    }
    await db.delete(deviceCommandsTable).where(eq(deviceCommandsTable.registrationId, regId));
  }
  if (regId) await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, regId));
  if (deviceId) await db.delete(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, deviceId));
});

async function insertTerminalCommand(): Promise<CommandOutcomeRow> {
  const [row] = await db
    .insert(deviceCommandsTable)
    .values({
      deviceId,
      registrationId: regId,
      command: "RESTART",
      status: "ACKNOWLEDGED",
      requestedByUserId: adminUserId,
      resultMessage: "rebooted just before shutdown",
      acknowledgedAt: new Date(),
    })
    .returning({
      id: deviceCommandsTable.id,
      deviceId: deviceCommandsTable.deviceId,
      command: deviceCommandsTable.command,
      status: deviceCommandsTable.status,
      requestedByUserId: deviceCommandsTable.requestedByUserId,
      resultMessage: deviceCommandsTable.resultMessage,
    });
  commandIds.push(row.id);
  return row;
}

describe("deferred notification flush at graceful shutdown", () => {
  it("completes a pending deferred write when flushed at shutdown", async () => {
    const cmd = await insertTerminalCommand();

    // Simulate the shutdown window: the deferred write has been scheduled
    // (as the ack path does) but has not run yet when the signal arrives.
    notifyCommandOutcomesDeferred([cmd]);
    expect(pendingDeferredCommandNotificationCount()).toBeGreaterThanOrEqual(1);

    const flushed = await flushDeferredCommandNotificationsWithTimeout(5_000);
    expect(flushed).toBe(true);
    expect(pendingDeferredCommandNotificationCount()).toBe(0);

    // The notification row exists by the time the flush resolves — the
    // requester would see it immediately after the restart, not a sweep later.
    const notes = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.notificationType, DEVICE_COMMAND_OUTCOME_TYPE),
        eq(notificationsTable.entityId, cmd.id),
      ));
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientUserId).toBe(adminUserId);
    expect(notes[0].severity).toBe("success");
    expect(notes[0].bodyEn).toContain("rebooted just before shutdown");

    // The claim is recorded, so the next boot's backfill sweep skips it.
    const [row] = await db.select().from(deviceCommandsTable).where(eq(deviceCommandsTable.id, cmd.id));
    expect(row.outcomeNotifiedAt).not.toBeNull();
  });

  it("resolves immediately (true) when no deferred writes are pending", async () => {
    expect(pendingDeferredCommandNotificationCount()).toBe(0);
    await expect(flushDeferredCommandNotificationsWithTimeout(1)).resolves.toBe(true);
  });

  it("returns false when the timeout elapses before the flush completes", async () => {
    const cmd = await insertTerminalCommand();
    notifyCommandOutcomesDeferred([cmd]);
    // A 0ms budget cannot cover even one event-loop turn — the bounded flush
    // must give up rather than hold the process open.
    const flushed = await flushDeferredCommandNotificationsWithTimeout(0);
    expect(flushed).toBe(false);
    // Let the write settle so it doesn't leak into other tests.
    await flushDeferredCommandNotificationsWithTimeout(5_000);
  });
});
