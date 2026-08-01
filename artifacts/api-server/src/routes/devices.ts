import { Router, type Request, type Response, type NextFunction } from "express";
import {
  db,
  attendanceDevicesTable,
  departmentsTable,
  punchEventsTable,
  punchImportBatchesTable,
  deviceCommandsTable,
  gatewayRegistrationsTable,
  auditLogsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { CreateDeviceBody, UpdateDeviceBody } from "@workspace/api-zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { GATEWAY_SILENCE_THRESHOLD_MS } from "../lib/gatewayDeviceAlerts.js";
import { notifyCommandOutcomes, DEVICE_COMMAND_TTL_MS } from "../lib/deviceCommandNotifications.js";
export { DEVICE_COMMAND_TTL_MS };

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

function serializeCommand(c: typeof deviceCommandsTable.$inferSelect) {
  return {
    ...c,
    deliveredAt: c.deliveredAt ? c.deliveredAt.toISOString() : null,
    acknowledgedAt: c.acknowledgedAt ? c.acknowledgedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Expire stale PENDING/DELIVERED commands for a device so the queue can't wedge. */
async function expireStaleCommands(deviceId: number): Promise<void> {
  const expired = await db
    .update(deviceCommandsTable)
    .set({ status: "EXPIRED", resultMessage: "Not acknowledged within the delivery window", updatedAt: new Date() })
    .where(and(
      eq(deviceCommandsTable.deviceId, deviceId),
      inArray(deviceCommandsTable.status, ["PENDING", "DELIVERED"]),
      lt(deviceCommandsTable.createdAt, new Date(Date.now() - DEVICE_COMMAND_TTL_MS)),
    ))
    .returning({
      id: deviceCommandsTable.id,
      deviceId: deviceCommandsTable.deviceId,
      command: deviceCommandsTable.command,
      status: deviceCommandsTable.status,
      requestedByUserId: deviceCommandsTable.requestedByUserId,
      resultMessage: deviceCommandsTable.resultMessage,
    });
  // The requester should hear about the expiry even if this read-path expiry
  // happened to be triggered by someone else viewing the device.
  await notifyCommandOutcomes(expired);
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

// Remote restart is a real operational command on physical hardware, so it
// requires an authenticated session UNCONDITIONALLY — even in demo mode
// (PILOT_AUTH off) where ordinary business routes stay open. Same posture as
// gateway-registration administration.
function requireDeviceCommandSession(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as { userId?: number } | undefined;
  if (!session?.userId) {
    res.status(401).json({
      error: "Authentication required for device commands",
      errorAr: "المصادقة مطلوبة لأوامر الأجهزة",
    });
    return;
  }
  next();
}
router.use("/devices/:id/restart", requireDeviceCommandSession);
router.use("/devices/:id/commands", requireDeviceCommandSession);

// POST /devices/:id/restart — queue a RESTART command for the device's gateway.
// The gateway picks it up in its next heartbeat and acks the outcome.
router.post("/devices/:id/restart", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [device] = await db.select().from(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, id));
  if (!device) { res.status(404).json({ error: "Not found" }); return; }

  // A restart can only be delivered through an ACTIVE gateway bound to this device.
  const [reg] = await db
    .select()
    .from(gatewayRegistrationsTable)
    .where(and(eq(gatewayRegistrationsTable.deviceId, id), eq(gatewayRegistrationsTable.status, "ACTIVE")))
    .orderBy(desc(gatewayRegistrationsTable.createdAt))
    .limit(1);
  if (!reg) {
    res.status(409).json({
      error: "No active attendance gateway is registered for this device — remote restart is not possible",
      errorAr: "لا توجد بوابة حضور نشطة مسجلة لهذا الجهاز — إعادة التشغيل عن بُعد غير ممكنة",
    });
    return;
  }

  await expireStaleCommands(id);
  const [inFlight] = await db
    .select({ id: deviceCommandsTable.id })
    .from(deviceCommandsTable)
    .where(and(
      eq(deviceCommandsTable.deviceId, id),
      eq(deviceCommandsTable.command, "RESTART"),
      inArray(deviceCommandsTable.status, ["PENDING", "DELIVERED"]),
    ))
    .limit(1);
  if (inFlight) {
    res.status(409).json({
      error: "A restart is already pending for this device",
      errorAr: "توجد إعادة تشغيل معلقة بالفعل لهذا الجهاز",
    });
    return;
  }

  const session = req.session as { userId?: number } | undefined;
  const [command] = await db
    .insert(deviceCommandsTable)
    .values({ deviceId: id, registrationId: reg.id, command: "RESTART", requestedByUserId: session?.userId ?? null })
    .returning();
  await db.insert(auditLogsTable).values({
    action: "device_restart_requested",
    entityType: "attendance_device",
    entityId: id,
    entityLabel: device.name,
    actorUserId: session?.userId ?? null,
    changesJson: JSON.stringify({ commandId: command.id, registrationId: reg.id }),
  });
  res.status(201).json(serializeCommand(command));
});

// GET /devices/:id/commands — recent commands (restart feedback for the UI)
router.get("/devices/:id/commands", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [device] = await db.select({ id: attendanceDevicesTable.id }).from(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, id));
  if (!device) { res.status(404).json({ error: "Not found" }); return; }
  await expireStaleCommands(id);
  const rows = await db
    .select()
    .from(deviceCommandsTable)
    .where(eq(deviceCommandsTable.deviceId, id))
    .orderBy(desc(deviceCommandsTable.createdAt))
    .limit(10);
  res.json(rows.map(serializeCommand));
});

export default router;
