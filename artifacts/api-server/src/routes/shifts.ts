import { Router } from "express";
import { db, shiftsTable, rostersTable, employeesTable } from "@workspace/db";
import { eq, count, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

router.get("/shifts", async (req, res): Promise<void> => {
  const shifts = await db.select().from(shiftsTable).orderBy(shiftsTable.shiftCode);

  const enriched = await Promise.all(
    shifts.map(async (s) => {
      const [{ cnt }] = await db
        .select({ cnt: count() })
        .from(rostersTable)
        .where(and(eq(rostersTable.shiftId, s.id)));
      return { ...s, assignedEmployeeCount: cnt };
    })
  );
  res.json(enriched);
});

router.post("/shifts", async (req, res): Promise<void> => {
  const { nameEn, nameAr, shiftCode, shiftType, startTime, endTime,
          breakMinutes, gracePeriodMinutes, maxOvertimeMinutes, color,
          departmentId, isActive, notes } = req.body;
  if (!nameEn || !nameAr || !shiftCode || !startTime || !endTime) {
    res.status(400).json({ error: "nameEn, nameAr, shiftCode, startTime, endTime are required" });
    return;
  }
  const [shift] = await db.insert(shiftsTable).values({
    nameEn, nameAr, shiftCode, shiftType: shiftType ?? "day", startTime, endTime,
    breakMinutes: breakMinutes ?? 60, gracePeriodMinutes: gracePeriodMinutes ?? 15,
    maxOvertimeMinutes: maxOvertimeMinutes ?? 120, color: color ?? "#3B82F6",
    departmentId: departmentId ?? null, isActive: isActive ?? true, notes: notes ?? null,
  }).returning();
  res.status(201).json(shift);
});

router.get("/shifts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, id));
  if (!shift) { res.status(404).json({ error: "Not found" }); return; }
  res.json(shift);
});

router.patch("/shifts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { nameEn, nameAr, shiftType, startTime, endTime, breakMinutes,
          gracePeriodMinutes, maxOvertimeMinutes, color, isActive, notes } = req.body;
  const [shift] = await db.update(shiftsTable)
    .set({ nameEn, nameAr, shiftType, startTime, endTime, breakMinutes,
           gracePeriodMinutes, maxOvertimeMinutes, color, isActive, notes })
    .where(eq(shiftsTable.id, id)).returning();
  if (!shift) { res.status(404).json({ error: "Not found" }); return; }
  res.json(shift);
});

router.delete("/shifts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(shiftsTable).where(eq(shiftsTable.id, id));
  res.status(204).end();
});

// Roster: weekly view per shift
router.get("/shifts/:id/roster", async (req, res): Promise<void> => {
  const shiftId = parseInt(req.params.id, 10);
  const { weekStart, weekEnd } = req.query as { weekStart?: string; weekEnd?: string };

  const conditions = [eq(rostersTable.shiftId, shiftId)];
  if (weekStart) conditions.push(gte(rostersTable.date, weekStart));
  if (weekEnd) conditions.push(lte(rostersTable.date, weekEnd));

  const rows = await db
    .select({
      rosterId: rostersTable.id,
      employeeId: rostersTable.employeeId,
      firstNameEn: employeesTable.firstNameEn,
      lastNameEn: employeesTable.lastNameEn,
      firstNameAr: employeesTable.firstNameAr,
      lastNameAr: employeesTable.lastNameAr,
      employeeNumber: employeesTable.employeeNumber,
      date: rostersTable.date,
      isOffDay: rostersTable.isOffDay,
      isPublicHoliday: rostersTable.isPublicHoliday,
      status: rostersTable.status,
    })
    .from(rostersTable)
    .leftJoin(employeesTable, eq(rostersTable.employeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(rostersTable.date, employeesTable.lastNameEn);

  res.json(rows);
});

export default router;
