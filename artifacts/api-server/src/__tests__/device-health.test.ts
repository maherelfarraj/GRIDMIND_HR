/**
 * GET /devices/:id/health — health figures must derive from real stored data
 * (punch events, gateway heartbeats, import batches), never Math.random().
 *
 * Self-cleaning fixtures: a dedicated device + gateway registration + punches.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  attendanceDevicesTable,
  gatewayRegistrationsTable,
  punchEventsTable,
  punchImportBatchesTable,
  employeesTable,
} from "@workspace/db";
import app from "../app";

let deviceId: number;
let staleDeviceId: number;
let customThresholdDeviceId: number;
let customRegId: number;
let regId: number;
let employeeId: number;
const punchIds: number[] = [];
let batchId: number;

beforeAll(async () => {
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable).limit(1);
  employeeId = emp.id;

  const suffix = Date.now() % 1000000;
  const [device] = await db.insert(attendanceDevicesTable).values({
    name: `TEST Health Device ${suffix}`,
    serialNumber: `T-HLTH-${suffix}`,
    model: "T100",
    vendor: "TestVendor",
    type: "biometric",
    location: "Test Lab",
    locationAr: "مختبر",
    status: "online",
    integrationProtocol: "REST",
    lastSyncAt: new Date(),
  }).returning();
  deviceId = device.id;

  const [stale] = await db.insert(attendanceDevicesTable).values({
    name: `TEST Stale Device ${suffix}`,
    serialNumber: `T-STAL-${suffix}`,
    model: "T100",
    vendor: "TestVendor",
    type: "biometric",
    location: "Test Lab",
    locationAr: "مختبر",
    status: "online", // stored status lies; health must use real timestamps
    integrationProtocol: "REST",
    lastSyncAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  }).returning();
  staleDeviceId = stale.id;

  // Device whose ACTIVE gateway has a generous per-registration silence
  // threshold override: last contact 30 min ago would be stale under the
  // global default (10 min) but must count as online under the override.
  const [custom] = await db.insert(attendanceDevicesTable).values({
    name: `TEST Custom Threshold Device ${suffix}`,
    serialNumber: `T-CUST-${suffix}`,
    model: "T100",
    vendor: "TestVendor",
    type: "biometric",
    location: "Test Lab",
    locationAr: "مختبر",
    status: "offline", // stored status lies the other way
    integrationProtocol: "REST",
    lastSyncAt: null,
  }).returning();
  customThresholdDeviceId = custom.id;
  const [customReg] = await db.insert(gatewayRegistrationsTable).values({
    name: `TEST Custom GW ${suffix}`,
    deviceId: customThresholdDeviceId,
    adapterType: "SIMULATOR",
    secretHash: "test-not-a-real-key",
    status: "ACTIVE",
    registeredByUserId: 1,
    lastHeartbeatAt: new Date(Date.now() - 30 * 60 * 1000),
    silenceThresholdMinutes: 120,
  }).returning();
  customRegId = customReg.id;

  const [reg] = await db.insert(gatewayRegistrationsTable).values({
    name: `TEST Health GW ${suffix}`,
    deviceId,
    adapterType: "SIMULATOR",
    secretHash: "test-not-a-real-key",
    status: "ACTIVE",
    registeredByUserId: 1,
    lastHeartbeatAt: new Date(),
    adapterConnStatus: "REACHABLE",
  }).returning();
  regId = reg.id;

  // 3 punches today + 1 two days ago = 2 active days in the window.
  const times = [
    new Date(),
    new Date(Date.now() - 60 * 60 * 1000),
    new Date(Date.now() - 2 * 60 * 60 * 1000),
    new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  ];
  for (const [i, t] of times.entries()) {
    const [p] = await db.insert(punchEventsTable).values({
      employeeId,
      deviceId,
      eventTime: t,
      eventType: i % 2 === 0 ? "CLOCK_IN" : "CLOCK_OUT",
      source: "GATEWAY",
      dedupeKey: `test-health-${suffix}-${i}`,
    }).returning();
    punchIds.push(p.id);
  }

  const [batch] = await db.insert(punchImportBatchesTable).values({
    batchUuid: `test-health-batch-${suffix}`,
    registrationId: regId,
    eventCount: 5,
    errorCount: 2,
    status: "PARTIAL",
    errorSummary: "invalid event (x)",
  }).returning();
  batchId = batch.id;
});

afterAll(async () => {
  if (punchIds.length) await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, punchIds));
  await db.delete(punchImportBatchesTable).where(eq(punchImportBatchesTable.id, batchId));
  await db.delete(gatewayRegistrationsTable).where(inArray(gatewayRegistrationsTable.id, [regId, customRegId]));
  await db.delete(attendanceDevicesTable).where(inArray(attendanceDevicesTable.id, [deviceId, staleDeviceId, customThresholdDeviceId]));
});

describe("GET /devices/:id/health", () => {
  it("returns deterministic values computed from stored data", async () => {
    const r1 = await request(app).get(`/api/devices/${deviceId}/health`);
    const r2 = await request(app).get(`/api/devices/${deviceId}/health`);
    expect(r1.status).toBe(200);
    // Repeated calls must agree — random data would not.
    expect(r2.body.recordsToday).toBe(r1.body.recordsToday);
    expect(r2.body.uptimePercent).toBe(r1.body.uptimePercent);
    expect(r2.body.signalStrength).toBe(r1.body.signalStrength);

    expect(r1.body.recordsToday).toBe(3);
    // 2 active days out of the 7-day window.
    expect(r1.body.uptimePercent).toBeCloseTo((2 / 7) * 100, 0);
    expect(r1.body.isOnline).toBe(true);
    expect(r1.body.signalStrength).toBe("strong");
    // Real error log surfaces the PARTIAL batch.
    expect(r1.body.errorLog.some((e: string) => e.includes("PARTIAL"))).toBe(true);
    expect(r1.body.lastPingAt).toBeTruthy();
  });

  it("flags a stale device from real timestamps even when stored status says online", async () => {
    const res = await request(app).get(`/api/devices/${staleDeviceId}/health`);
    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(false);
    expect(res.body.recordsToday).toBe(0);
    expect(res.body.uptimePercent).toBeNull();
    expect(res.body.signalStrength).toBeNull();
    expect(res.body.errorLog.some((e: string) => e.includes("No gateway contact since"))).toBe(true);
    expect(res.body.lastPingAt).toBe(res.body.lastSyncAt);
  });

  it("404s for a missing device", async () => {
    const res = await request(app).get(`/api/devices/999999/health`);
    expect(res.status).toBe(404);
  });
});

describe("GET /devices — computed connectivity in the list", () => {
  it("surfaces the same real-timestamp verdict as the health endpoint", async () => {
    const res = await request(app).get("/api/devices");
    expect(res.status).toBe(200);

    const fresh = res.body.find((d: { id: number }) => d.id === deviceId);
    const stale = res.body.find((d: { id: number }) => d.id === staleDeviceId);

    // Fresh device: active gateway heartbeat just now → online, not stale.
    expect(fresh.isOnline).toBe(true);
    expect(fresh.isStale).toBe(false);
    expect(fresh.lastContactAt).toBeTruthy();

    // Stale device: stored status says "online" but last real contact is
    // 3 days old → flagged stale, not online.
    expect(stale.status).toBe("online");
    expect(stale.isOnline).toBe(false);
    expect(stale.isStale).toBe(true);
    expect(stale.lastContactAt).toBe(stale.lastSyncAt);
  });

  it("honors a per-registration silence threshold override, agreeing with the health endpoint", async () => {
    const list = await request(app).get("/api/devices");
    const health = await request(app).get(`/api/devices/${customThresholdDeviceId}/health`);
    expect(list.status).toBe(200);
    expect(health.status).toBe(200);

    const item = list.body.find((d: { id: number }) => d.id === customThresholdDeviceId);
    // 30 min silence, 120 min override → online everywhere despite the
    // global 10 min default and a stored status of "offline".
    expect(item.isOnline).toBe(true);
    expect(item.isStale).toBe(false);
    expect(health.body.isOnline).toBe(true);
    // List and health must always agree.
    expect(item.isOnline).toBe(health.body.isOnline);
    expect(item.lastContactAt).toBe(health.body.lastPingAt);
  });
});
