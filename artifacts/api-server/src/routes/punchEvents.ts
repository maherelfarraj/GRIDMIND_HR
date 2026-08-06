import { Router } from "express";
import { db, punchEventsTable, employeesTable, attendanceDevicesTable, attendanceRecordsTable } from "@workspace/db";
import { eq, and, desc, gte, lte, isNull } from "drizzle-orm";
import { resolveOrgId } from "../lib/orgContext.js";

const router = Router();

// GET /punch-events?employeeId=&date=&eventType=&source=&page=&limit=
router.get("/punch-events", async (req, res): Promise<void> => {
  const { employeeId, dateFrom, dateTo, eventType, source, isMissing, page = "1", limit = "50" } = req.query as {
    employeeId?: string; dateFrom?: string; dateTo?: string;
    eventType?: string; source?: string; isMissing?: string;
    page?: string; limit?: string;
  };

  const orgId = await resolveOrgId(req);

  // Scope to the org via the employee join; additional filters applied in SQL where possible
  const conditions: any[] = [eq(employeesTable.orgId, orgId)];
  if (dateFrom) conditions.push(gte(punchEventsTable.eventTime, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(punchEventsTable.eventTime, new Date(dateTo + "T23:59:59Z")));
  if (employeeId) conditions.push(eq(punchEventsTable.employeeId, parseInt(employeeId, 10)));
  if (eventType) conditions.push(eq(punchEventsTable.eventType, eventType));
  if (source) conditions.push(eq(punchEventsTable.source, source));
  if (isMissing !== undefined) conditions.push(eq(punchEventsTable.isMissing, isMissing === "true"));

  const rows = await db
    .select({
      id: punchEventsTable.id,
      employeeId: punchEventsTable.employeeId,
      deviceId: punchEventsTable.deviceId,
      attendanceRecordId: punchEventsTable.attendanceRecordId,
      eventTime: punchEventsTable.eventTime,
      eventType: punchEventsTable.eventType,
      source: punchEventsTable.source,
      isVerified: punchEventsTable.isVerified,
      isMissing: punchEventsTable.isMissing,
      notes: punchEventsTable.notes,
      createdAt: punchEventsTable.createdAt,
      firstNameEn: employeesTable.firstNameEn,
      lastNameEn: employeesTable.lastNameEn,
      firstNameAr: employeesTable.firstNameAr,
      lastNameAr: employeesTable.lastNameAr,
      employeeNumber: employeesTable.employeeNumber,
      deviceName: attendanceDevicesTable.name,
      deviceLocation: attendanceDevicesTable.location,
    })
    .from(punchEventsTable)
    .leftJoin(employeesTable, eq(punchEventsTable.employeeId, employeesTable.id))
    .leftJoin(attendanceDevicesTable, eq(punchEventsTable.deviceId, attendanceDevicesTable.id))
    .where(and(...conditions))
    .orderBy(desc(punchEventsTable.eventTime))
    .limit(parseInt(limit, 10))
    .offset((parseInt(page, 10) - 1) * parseInt(limit, 10));

  res.json({
    data: rows.map((r) => ({
      ...r,
      eventTime: r.eventTime.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
});

// GET /punch-events/missing — events flagged as missing
router.get("/punch-events/missing", async (req, res): Promise<void> => {
  const orgId = await resolveOrgId(req);

  const rows = await db
    .select({
      id: punchEventsTable.id,
      employeeId: punchEventsTable.employeeId,
      eventTime: punchEventsTable.eventTime,
      eventType: punchEventsTable.eventType,
      notes: punchEventsTable.notes,
      createdAt: punchEventsTable.createdAt,
      firstNameEn: employeesTable.firstNameEn,
      lastNameEn: employeesTable.lastNameEn,
      firstNameAr: employeesTable.firstNameAr,
      lastNameAr: employeesTable.lastNameAr,
      employeeNumber: employeesTable.employeeNumber,
    })
    .from(punchEventsTable)
    .leftJoin(employeesTable, eq(punchEventsTable.employeeId, employeesTable.id))
    .where(and(eq(punchEventsTable.isMissing, true), eq(employeesTable.orgId, orgId)))
    .orderBy(desc(punchEventsTable.eventTime));

  res.json(rows.map((r) => ({
    ...r,
    eventTime: r.eventTime.toISOString(),
    createdAt: r.createdAt.toISOString(),
  })));
});

// POST /punch-events — manual punch entry
router.post("/punch-events", async (req, res): Promise<void> => {
  const { employeeId, deviceId, attendanceRecordId, eventTime, eventType, source, notes } = req.body;
  if (!employeeId || !eventTime || !eventType) {
    res.status(400).json({ error: "employeeId, eventTime, eventType required" });
    return;
  }
  const [event] = await db.insert(punchEventsTable).values({
    employeeId, deviceId: deviceId ?? null,
    attendanceRecordId: attendanceRecordId ?? null,
    eventTime: new Date(eventTime), eventType,
    source: source ?? "MANUAL", isVerified: false, isMissing: false,
    notes: notes ?? null,
  }).returning();
  res.status(201).json({
    ...event,
    eventTime: event.eventTime.toISOString(),
    createdAt: event.createdAt.toISOString(),
  });
});

// GET /punch-events/:id — single event with full audit detail
router.get("/punch-events/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [event] = await db.select().from(punchEventsTable).where(eq(punchEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...event, eventTime: event.eventTime.toISOString(), createdAt: event.createdAt.toISOString() });
});

// PATCH /punch-events/:id — verify / annotate
router.patch("/punch-events/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { isVerified, isMissing, notes } = req.body;
  const [event] = await db.update(punchEventsTable)
    .set({ isVerified, isMissing, notes })
    .where(eq(punchEventsTable.id, id)).returning();
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...event, eventTime: event.eventTime.toISOString(), createdAt: event.createdAt.toISOString() });
});

export default router;
