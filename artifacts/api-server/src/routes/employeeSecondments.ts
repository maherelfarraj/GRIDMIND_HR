import { Router } from "express";
import { db, employeeSecondmentsTable, employeesTable, orgUnitsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichSecondment(s: typeof employeeSecondmentsTable.$inferSelect) {
  let employeeNameEn: string | null = null;
  if (s.employeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, s.employeeId));
    if (emp) employeeNameEn = emp.firstNameEn + " " + emp.lastNameEn;
  }

  let hostUnitNameEn: string | null = null;
  if (s.hostOrgUnitId) {
    const [unit] = await db.select().from(orgUnitsTable).where(eq(orgUnitsTable.id, s.hostOrgUnitId));
    if (unit) hostUnitNameEn = unit.nameEn;
  }

  return { ...s, employeeNameEn, hostUnitNameEn };
}

// GET /employee-secondments
router.get("/employee-secondments", async (req, res): Promise<void> => {
  const { employeeId, status } = req.query as Record<string, string>;

  const conditions = [];
  if (employeeId) conditions.push(eq(employeeSecondmentsTable.employeeId, parseInt(employeeId, 10)));
  if (status) conditions.push(eq(employeeSecondmentsTable.status, status));

  const rows = conditions.length
    ? await db.select().from(employeeSecondmentsTable).where(and(...conditions))
    : await db.select().from(employeeSecondmentsTable);

  const enriched = await Promise.all(rows.map(enrichSecondment));
  res.json(enriched);
});

// POST /employee-secondments
router.post("/employee-secondments", async (req, res): Promise<void> => {
  const { employeeId, hostOrgUnitId, startDate, allowancePct, ...rest } = req.body;

  if (!employeeId || !hostOrgUnitId || !startDate) {
    res.status(400).json({ error: "employeeId, hostOrgUnitId, startDate are required" });
    return;
  }

  const [row] = await db
    .insert(employeeSecondmentsTable)
    .values({
      employeeId: parseInt(employeeId, 10),
      hostOrgUnitId: parseInt(hostOrgUnitId, 10),
      startDate,
      allowancePct: String(allowancePct ?? 0),
      ...rest,
    })
    .returning();

  res.status(201).json(await enrichSecondment(row));
});

// PATCH /employee-secondments/:id
router.patch("/employee-secondments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(employeeSecondmentsTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(employeeSecondmentsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Employee secondment not found" });
    return;
  }
  res.json(await enrichSecondment(row));
});

export default router;
