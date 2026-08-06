import { Router } from "express";
import { db, rostersTable, shiftsTable, employeesTable, departmentsTable, publicHolidaysTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, or, isNull } from "drizzle-orm";
import { resolveOrgId } from "../lib/orgContext.js";
import { buildHolidaySet, HolidayRuleRow } from "../lib/holidays.js";

const router = Router();

/** Return all employee IDs belonging to the given org. */
async function orgEmployeeIds(orgId: number): Promise<number[]> {
  const rows = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.orgId, orgId));
  return rows.map((r) => r.id);
}

/**
 * Fetch all public holiday rows that apply to a given org (org-specific + global).
 */
async function fetchOrgHolidays(orgId: number): Promise<HolidayRuleRow[]> {
  return db
    .select({
      date: publicHolidaysTable.date,
      isRecurring: publicHolidaysTable.isRecurring,
      applicableTo: publicHolidaysTable.applicableTo,
    })
    .from(publicHolidaysTable)
    .where(
      or(isNull(publicHolidaysTable.orgId), eq(publicHolidaysTable.orgId, orgId))
    );
}

/**
 * Derive the isPublicHoliday flag for a single date + employee sector, using
 * the provided holiday rows. Year is extracted from the date string.
 */
function deriveIsPublicHoliday(
  date: string,
  sector: string,
  holidays: HolidayRuleRow[],
): boolean {
  const year = parseInt(date.slice(0, 4), 10);
  if (isNaN(year)) return false;
  const set = buildHolidaySet(holidays, year, year, sector);
  return set.has(date);
}

// Weekly roster: GET /rosters?weekStart=YYYY-MM-DD&weekEnd=YYYY-MM-DD&departmentId=X
router.get("/rosters", async (req, res): Promise<void> => {
  const { weekStart, weekEnd, departmentId, employeeId } = req.query as {
    weekStart?: string; weekEnd?: string; departmentId?: string; employeeId?: string;
  };

  const orgId = await resolveOrgId(req);

  const conditions: any[] = [eq(employeesTable.orgId, orgId)];
  if (weekStart) conditions.push(gte(rostersTable.date, weekStart));
  if (weekEnd) conditions.push(lte(rostersTable.date, weekEnd));
  if (employeeId) conditions.push(eq(rostersTable.employeeId, parseInt(employeeId, 10)));

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
    .where(and(...conditions))
    .orderBy(rostersTable.date, employeesTable.lastNameEn);

  // If departmentId filter apply after join
  const filtered = departmentId
    ? rows.filter((r) => r.departmentId === parseInt(departmentId, 10))
    : rows;

  res.json(filtered);
});

// POST /rosters — create or upsert a roster entry
router.post("/rosters", async (req, res): Promise<void> => {
  const { employeeId, shiftId, date, isOffDay, status, notes, createdByUserId } = req.body;
  if (!employeeId || !date) {
    res.status(400).json({ error: "employeeId and date are required" });
    return;
  }

  // Fetch the employee to get their org + sector, then derive holiday flag.
  const [employee] = await db
    .select({ orgId: employeesTable.orgId, organizationType: employeesTable.organizationType })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  const holidays = await fetchOrgHolidays(employee.orgId);
  const isPublicHoliday = deriveIsPublicHoliday(date, employee.organizationType, holidays);

  // Delete existing for same employee + date (upsert behavior)
  await db.delete(rostersTable)
    .where(and(eq(rostersTable.employeeId, employeeId), eq(rostersTable.date, date)));

  const [entry] = await db.insert(rostersTable).values({
    employeeId, shiftId: shiftId ?? null, date,
    isOffDay: isOffDay ?? false, isPublicHoliday,
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

  // Collect the unique employee IDs in this batch, fetch their org + sector,
  // and load holidays once per org so we don't hit the DB per row.
  const uniqueEmpIds: number[] = [...new Set<number>(entries.map((e) => e.employeeId).filter(Boolean))];
  const empRows = uniqueEmpIds.length > 0
    ? await db
        .select({ id: employeesTable.id, orgId: employeesTable.orgId, organizationType: employeesTable.organizationType })
        .from(employeesTable)
        .where(inArray(employeesTable.id, uniqueEmpIds))
    : [];

  const empMap = new Map(empRows.map((e) => [e.id, e]));

  // Load holidays per unique org (usually just one).
  const uniqueOrgIds = [...new Set(empRows.map((e) => e.orgId))];
  const holidaysByOrg = new Map<number, HolidayRuleRow[]>();
  await Promise.all(
    uniqueOrgIds.map(async (orgId) => {
      holidaysByOrg.set(orgId, await fetchOrgHolidays(orgId));
    })
  );

  const results = [];
  for (const e of entries) {
    const emp = empMap.get(e.employeeId);
    const holidays = emp ? (holidaysByOrg.get(emp.orgId) ?? []) : [];
    const sector = emp?.organizationType ?? "commercial";
    const isPublicHoliday = emp ? deriveIsPublicHoliday(e.date, sector, holidays) : false;

    await db.delete(rostersTable)
      .where(and(eq(rostersTable.employeeId, e.employeeId), eq(rostersTable.date, e.date)));
    const [row] = await db.insert(rostersTable).values({
      employeeId: e.employeeId, shiftId: e.shiftId ?? null, date: e.date,
      isOffDay: e.isOffDay ?? false, isPublicHoliday,
      status: e.status ?? "scheduled", notes: e.notes ?? null,
    }).returning();
    results.push(row);
  }
  res.status(201).json(results);
});

// Summary: how many employees per shift per week
router.get("/rosters/summary", async (req, res): Promise<void> => {
  const { weekStart, weekEnd } = req.query as { weekStart?: string; weekEnd?: string };

  const orgId = await resolveOrgId(req);
  const empIds = await orgEmployeeIds(orgId);

  const shifts = await db.select().from(shiftsTable).where(eq(shiftsTable.isActive, true));
  const conditions: any[] = [];
  if (weekStart) conditions.push(gte(rostersTable.date, weekStart));
  if (weekEnd) conditions.push(lte(rostersTable.date, weekEnd));
  if (empIds.length > 0) conditions.push(inArray(rostersTable.employeeId, empIds));

  const rows = empIds.length === 0
    ? []
    : await db.select().from(rostersTable)
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
