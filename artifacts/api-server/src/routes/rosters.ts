import { Router } from "express";
import { db, rostersTable, shiftsTable, employeesTable, departmentsTable } from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";

const router = Router();

// Weekly roster: GET /rosters?weekStart=YYYY-MM-DD&weekEnd=YYYY-MM-DD&departmentId=X
router.get("/rosters", async (req, res): Promise<void> => {
  const { weekStart, weekEnd, departmentId, employeeId } = req.query as {
    weekStart?: string; weekEnd?: string; departmentId?: string; employeeId?: string;
  };

  const conditions: any[] = [];
  if (weekStart) conditions.push(gte(rostersTable.date, weekStart));
  if (weekEnd) conditions.push(lte(rostersTable.date, weekEnd));
  if (employeeId) conditions.push(eq(rostersTable.employeeId, parseInt(employeeId, 10)));

  let empConditions: any[] = [];
  if (departmentId) empConditions.push(eq(employeesTable.departmentId, parseInt(departmentId, 10)));

  const rows = await db
    .select({
      id: rostersTable.id,
      employeeId: rostersTable.employeeId,
      shiftId: rostersTable.shiftId,
      date: rostersTable.date,
      isOffDay: rostersTable.isOffDay,
      isPublicHoliday: rostersTable.isPublicHoliday,
      status: rostersTable.status,
      notes: rostersTable.notes,
      firstNameEn: employeesTable.firstNameEn,
      lastNameEn: employeesTable.lastNameEn,
      firstNameAr: employeesTable.firstNameAr,
      lastNameAr: employeesTable.lastNameAr,
      employeeNumber: employeesTable.employeeNumber,
      jobTitleEn: employeesTable.jobTitleEn,
      jobTitleAr: employeesTable.jobTitleAr,
      departmentId: employeesTable.departmentId,
      shiftCode: shiftsTable.shiftCode,
      shiftNameEn: shiftsTable.nameEn,
      shiftNameAr: shiftsTable.nameAr,
      shiftStartTime: shiftsTable.startTime,
      shiftEndTime: shiftsTable.endTime,
      shiftColor: shiftsTable.color,
    })
    .from(rostersTable)
    .leftJoin(employeesTable, eq(rostersTable.employeeId, employeesTable.id))
    .leftJoin(shiftsTable, eq(rostersTable.shiftId, shiftsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(rostersTable.date, employeesTable.lastNameEn);

  // If departmentId filter apply after join
  const filtered = departmentId
    ? rows.filter((r) => r.departmentId === parseInt(departmentId, 10))
    : rows;

  res.json(filtered);
});

// POST /rosters — create or upsert a roster entry
router.post("/rosters", async (req, res): Promise<void> => {
  const { employeeId, shiftId, date, isOffDay, isPublicHoliday, status, notes, createdByUserId } = req.body;
  if (!employeeId || !date) {
    res.status(400).json({ error: "employeeId and date are required" });
    return;
  }

  // Delete existing for same employee + date (upsert behavior)
  await db.delete(rostersTable)
    .where(and(eq(rostersTable.employeeId, employeeId), eq(rostersTable.date, date)));

  const [entry] = await db.insert(rostersTable).values({
    employeeId, shiftId: shiftId ?? null, date,
    isOffDay: isOffDay ?? false, isPublicHoliday: isPublicHoliday ?? false,
    status: status ?? "scheduled", notes: notes ?? null,
    createdByUserId: createdByUserId ?? null,
  }).returning();
  res.status(201).json(entry);
});

// Bulk create/update roster week
router.post("/rosters/bulk", async (req, res): Promise<void> => {
  const { entries } = req.body as { entries: any[] };
  if (!entries || !Array.isArray(entries)) {
    res.status(400).json({ error: "entries array required" });
    return;
  }

  const results = [];
  for (const e of entries) {
    await db.delete(rostersTable)
      .where(and(eq(rostersTable.employeeId, e.employeeId), eq(rostersTable.date, e.date)));
    const [row] = await db.insert(rostersTable).values({
      employeeId: e.employeeId, shiftId: e.shiftId ?? null, date: e.date,
      isOffDay: e.isOffDay ?? false, isPublicHoliday: e.isPublicHoliday ?? false,
      status: e.status ?? "scheduled", notes: e.notes ?? null,
    }).returning();
    results.push(row);
  }
  res.status(201).json(results);
});

// Summary: how many employees per shift per week
router.get("/rosters/summary", async (req, res): Promise<void> => {
  const { weekStart, weekEnd } = req.query as { weekStart?: string; weekEnd?: string };
  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.isActive, true));
  const conditions: any[] = [];
  if (weekStart) conditions.push(gte(rostersTable.date, weekStart));
  if (weekEnd) conditions.push(lte(rostersTable.date, weekEnd));

  const rows = await db.select().from(rostersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const summary = shifts.map((s) => ({
    shiftId: s.id, shiftNameEn: s.nameEn, shiftNameAr: s.nameAr,
    shiftCode: s.shiftCode, color: s.color,
    totalAssignments: rows.filter((r) => r.shiftId === s.id).length,
    offDays: rows.filter((r) => r.shiftId === s.id && r.isOffDay).length,
  }));
  res.json({ summary, totalRosterEntries: rows.length });
});

router.delete("/rosters/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(rostersTable).where(eq(rostersTable.id, id));
  res.status(204).end();
});

export default router;
