import { Router } from "express";
import { db, deviceEmployeeMappingsTable, attendanceDevicesTable, employeesTable, systemUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichMapping(m: typeof deviceEmployeeMappingsTable.$inferSelect) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, m.employeeId));
  const [dev] = await db.select().from(attendanceDevicesTable).where(eq(attendanceDevicesTable.id, m.deviceId));
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, m.enrolledByUserId));
  return {
    ...m,
    employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
    employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
    employeeNumber: emp?.employeeNumber ?? "",
    jobTitleEn: emp?.jobTitleEn ?? "",
    deviceName: dev?.name ?? "Unknown",
    deviceLocation: dev?.location ?? "",
    enrolledByName: user?.fullNameEn ?? "System",
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

// GET all mappings (optionally filtered by deviceId or employeeId)
router.get("/device-mappings", async (req, res): Promise<void> => {
  const deviceId = req.query.deviceId ? parseInt(req.query.deviceId as string) : undefined;
  const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;

  let query = db.select().from(deviceEmployeeMappingsTable).$dynamic();
  const conditions = [];
  if (deviceId) conditions.push(eq(deviceEmployeeMappingsTable.deviceId, deviceId));
  if (employeeId) conditions.push(eq(deviceEmployeeMappingsTable.employeeId, employeeId));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const mappings = await query;
  const enriched = await Promise.all(mappings.map(enrichMapping));
  res.json(enriched);
});

// GET mappings for a specific device
router.get("/devices/:id/mappings", async (req, res): Promise<void> => {
  const deviceId = parseInt(req.params.id);
  const mappings = await db.select().from(deviceEmployeeMappingsTable)
    .where(eq(deviceEmployeeMappingsTable.deviceId, deviceId));
  const enriched = await Promise.all(mappings.map(enrichMapping));
  res.json(enriched);
});

// POST create mapping
router.post("/devices/:id/mappings", async (req, res): Promise<void> => {
  const deviceId = parseInt(req.params.id);
  const { employeeId, accessLevel, biometricType, enrolledAt, enrolledByUserId, notes } = req.body;
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }
  const [mapping] = await db.insert(deviceEmployeeMappingsTable).values({
    deviceId,
    employeeId,
    accessLevel: accessLevel ?? "standard",
    biometricType: biometricType ?? "fingerprint",
    enrolledAt: enrolledAt ?? new Date().toISOString().slice(0, 10),
    enrolledByUserId: enrolledByUserId ?? 1,
    notes,
  }).returning();
  res.status(201).json(await enrichMapping(mapping));
});

// DELETE remove mapping
router.delete("/devices/:id/mappings/:employeeId", async (req, res): Promise<void> => {
  const deviceId = parseInt(req.params.id);
  const employeeId = parseInt(req.params.employeeId);
  await db.delete(deviceEmployeeMappingsTable).where(
    and(
      eq(deviceEmployeeMappingsTable.deviceId, deviceId),
      eq(deviceEmployeeMappingsTable.employeeId, employeeId)
    )
  );
  res.status(204).end();
});

export default router;
