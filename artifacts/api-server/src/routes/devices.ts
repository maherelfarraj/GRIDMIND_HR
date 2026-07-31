import { Router } from "express";
import {
  db,
  attendanceDevicesTable,
  departmentsTable,
  punchEventsTable,
  punchImportBatchesTable,
  gatewayRegistrationsTable,
} from "@workspace/db";
import { and, eq, gte, sql, desc, inArray } from "drizzle-orm";
import { CreateDeviceBody, UpdateDeviceBody } from "@workspace/api-zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { GATEWAY_SILENCE_THRESHOLD_MS } from "../lib/gatewayDeviceAlerts.js";

const router = Router();

// Device inventory and health data must never be readable without a session.
// The global auth gate only covers mutating methods, so guard GETs here too.
router.use("/devices", requireAuth);

// Window (days) used for the activity-based uptime proxy and error log scan.
const UPTIME_WINDOW_DAYS = 7;

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildDeviceResponse(d: typeof attendanceDevicesTable.$inferSelect) {
  let departmentNameEn: string | null = null;
  if (d.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, d.departmentId));
    if (dept) departmentNameEn = dept.nameEn;
  }
  return {
    ...d,
    departmentNameEn,
    lastSyncAt: d.lastSyncAt ? d.lastSyncAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/devices", async (req, res): Promise<void> => {
  const devices = await db.select().from(attendanceDevicesTable);
  const depts = await db.select().from(departmentsTable);
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));

  const result = devices.map((d) => ({
    ...d,
    departmentNameEn: d.departmentId ? (deptMap[d.departmentId]?.nameEn ?? null) : null,
    lastSyncAt: d.lastSyncAt ? d.lastSyncAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  }));
  res.json(result);
});

router.post("/devices", async (req, res): Promise<void> => {
  const parsed = CreateDeviceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [device] = await db.insert(attendanceDevicesTable).values(parsed.data).returning();
  res.status(201).json(await buildDeviceResponse(device));
});

router.get("/devices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [device] = await db.select().from(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, id));
  if (!device) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildDeviceResponse(device));
});

router.patch("/devices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateDeviceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [device] = await db.update(attendanceDevicesTable).set(parsed.data).where(eq(attendanceDevicesTable.id, id)).returning();
  if (!device) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildDeviceResponse(device));
});

router.delete("/devices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, id));
  res.status(204).end();
});

router.get("/devices/:id/health", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [device] = await db.select().from(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, id));
  if (!device) { res.status(404).json({ error: "Not found" }); return; }

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const windowStart = new Date(now - UPTIME_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Gateway registrations bound to this device carry the real heartbeat /
  // connectivity data. Prefer the ACTIVE registration with the most recent
  // heartbeat.
  const registrations = await db
    .select()
    .from(gatewayRegistrationsTable)
    .where(eq(gatewayRegistrationsTable.deviceId, device.id));
  const reg =
    registrations
      .filter((r) => r.status === "ACTIVE")
      .sort(
        (a, b) =>
          (b.lastHeartbeatAt?.getTime() ?? b.lastSeenAt?.getTime() ?? 0) -
          (a.lastHeartbeatAt?.getTime() ?? a.lastSeenAt?.getTime() ?? 0),
      )[0] ?? null;

  // Real punch activity: today's count + distinct active days over the window.
  const [todayRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(punchEventsTable)
    .where(and(eq(punchEventsTable.deviceId, device.id), gte(punchEventsTable.eventTime, startOfToday)));
  const recordsToday = todayRow?.count ?? 0;

  const [activeDaysRow] = await db
    .select({ days: sql<number>`count(distinct date(${punchEventsTable.eventTime}))::int` })
    .from(punchEventsTable)
    .where(and(eq(punchEventsTable.deviceId, device.id), gte(punchEventsTable.eventTime, windowStart)));
  const activeDays = activeDaysRow?.days ?? 0;

  // Last real contact: gateway heartbeat/reconcile beats device.lastSyncAt.
  const contactTimes = [reg?.lastHeartbeatAt, reg?.lastSeenAt, device.lastSyncAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  const lastContactMs = contactTimes.length ? Math.max(...contactTimes) : null;
  const isOnline = lastContactMs !== null && now - lastContactMs <= GATEWAY_SILENCE_THRESHOLD_MS;
  const isStale = lastContactMs !== null && !isOnline;

  // Uptime proxy: share of days in the window with recorded punch activity.
  // null (not a fake number) when there is no activity history at all.
  const uptimePercent =
    activeDays > 0 ? Math.round((activeDays / UPTIME_WINDOW_DAYS) * 1000) / 10 : null;

  // "Signal" from the last adapter connection test reported via heartbeat.
  const signalStrength =
    reg?.adapterConnStatus === "REACHABLE"
      ? "strong"
      : reg?.adapterConnStatus === "AUTH_FAILED" || reg?.adapterConnStatus === "UNREACHABLE"
        ? "none"
        : null;

  // Real error log: recent failed/partial import batches + current alerts.
  const errorLog: string[] = [];
  if (reg) {
    const badBatches = await db
      .select()
      .from(punchImportBatchesTable)
      .where(
        and(
          eq(punchImportBatchesTable.registrationId, reg.id),
          gte(punchImportBatchesTable.receivedAt, windowStart),
          inArray(punchImportBatchesTable.status, ["FAILED", "PARTIAL"]),
        ),
      )
      .orderBy(desc(punchImportBatchesTable.receivedAt))
      .limit(5);
    for (const b of badBatches) {
      errorLog.push(
        `Batch ${b.batchUuid} ${b.status} at ${b.receivedAt.toISOString()}: ${b.errorSummary ?? `${b.errorCount} error(s)`}`,
      );
    }
    if (reg.driftAlert && reg.clockDriftMs !== null) {
      errorLog.push(`Gateway clock drift ${reg.clockDriftMs}ms exceeds tolerance`);
    }
    if (reg.deviceClockSkewAlert && reg.deviceClockSkewMs !== null) {
      errorLog.push(`Device clock skew ${reg.deviceClockSkewMs}ms exceeds tolerance`);
    }
    if (reg.adapterConnStatus && reg.adapterConnStatus !== "REACHABLE") {
      errorLog.push(
        `Adapter connection ${reg.adapterConnStatus}${reg.adapterConnMessage ? `: ${reg.adapterConnMessage}` : ""}` +
          (reg.adapterConnTestedAt ? ` (tested ${reg.adapterConnTestedAt.toISOString()})` : ""),
      );
    }
  }
  if (isStale) {
    errorLog.push(`No gateway contact since ${new Date(lastContactMs).toISOString()} (silence threshold ${Math.round(GATEWAY_SILENCE_THRESHOLD_MS / 60000)} min)`);
  } else if (lastContactMs === null) {
    errorLog.push("No sync or heartbeat has ever been recorded for this device");
  }

  res.json({
    deviceId: device.id,
    deviceName: device.name,
    status: device.status,
    isOnline,
    lastPingAt: lastContactMs !== null ? new Date(lastContactMs).toISOString() : null,
    lastSyncAt: device.lastSyncAt ? device.lastSyncAt.toISOString() : null,
    recordsToday,
    uptimePercent,
    signalStrength,
    errorLog,
    integrationNote: reg
      ? `Health derived from gateway "${reg.name}" (${reg.adapterType}): heartbeats, punch batches and connection tests over the last ${UPTIME_WINDOW_DAYS} days.`
      : `No gateway registration is bound to this device — health is derived only from stored sync timestamps and punch records. Protocol: ${device.integrationProtocol}.`,
  });
});

export default router;
