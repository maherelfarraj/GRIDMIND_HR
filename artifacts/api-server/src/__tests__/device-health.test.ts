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
  await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, regId));
  await db.delete(attendanceDevicesTable).where(inArray(attendanceDevicesTable.id, [deviceId, staleDeviceId]));
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
