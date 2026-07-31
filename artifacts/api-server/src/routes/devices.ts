import { Router } from "express";
import { db, attendanceDevicesTable, departmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateDeviceBody, UpdateDeviceBody } from "@workspace/api-zod";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// Device inventory and health data must never be readable without a session.
// The global auth gate only covers mutating methods, so guard GETs here too.
router.use("/devices", requireAuth);

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

  const isOnline = device.status === "online";
  const uptimePercent = isOnline ? 98.7 + Math.random() * 1.2 : Math.random() * 40;

  res.json({
    deviceId: device.id,
    deviceName: device.name,
    status: device.status,
    isOnline,
    lastPingAt: isOnline ? new Date().toISOString() : (device.lastSyncAt ? device.lastSyncAt.toISOString() : null),
    lastSyncAt: device.lastSyncAt ? device.lastSyncAt.toISOString() : null,
    recordsToday: isOnline ? Math.floor(Math.random() * 200) : 0,
    uptimePercent: Math.round(uptimePercent * 10) / 10,
    signalStrength: isOnline ? (Math.random() > 0.3 ? "strong" : "moderate") : "none",
    errorLog: isOnline ? [] : [`Last error: Connection timeout at ${device.lastSyncAt?.toISOString() ?? "N/A"}`],
    integrationNote: `Vendor SDK integration placeholder — protocol: ${device.integrationProtocol}. Connect to vendor API (ZKAccess / OSDP / Wiegand / REST) in a customer-controlled environment. No external cloud dependencies required.`,
  });
});

export default router;
