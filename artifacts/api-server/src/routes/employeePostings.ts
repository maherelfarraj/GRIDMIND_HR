import { Router } from "express";
import { db, employeePostingsTable, employeesTable, orgUnitsTable, dutyStationsTable, militaryRanksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichPosting(p: typeof employeePostingsTable.$inferSelect) {
  let employeeNameEn: string | null = null;
  if (p.employeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, p.employeeId));
    if (emp) employeeNameEn = emp.firstNameEn + " " + emp.lastNameEn;
  }

  let orgUnitNameEn: string | null = null;
  if (p.orgUnitId) {
    const [unit] = await db.select().from(orgUnitsTable).where(eq(orgUnitsTable.id, p.orgUnitId));
    if (unit) orgUnitNameEn = unit.nameEn;
  }

  let dutyStationNameEn: string | null = null;
  if (p.dutyStationId) {
    const [station] = await db.select().from(dutyStationsTable).where(eq(dutyStationsTable.id, p.dutyStationId));
    if (station) dutyStationNameEn = station.nameEn;
  }

  let rankNameEn: string | null = null;
  if (p.rankId) {
    const [rank] = await db.select().from(militaryRanksTable).where(eq(militaryRanksTable.id, p.rankId));
    if (rank) rankNameEn = rank.nameEn;
  }

  return { ...p, employeeNameEn, orgUnitNameEn, dutyStationNameEn, rankNameEn };
}

// GET /employee-postings
router.get("/employee-postings", async (req, res): Promise<void> => {
  const { employeeId, orgUnitId, isCurrent } = req.query as Record<string, string>;

  const conditions = [];
  if (employeeId) conditions.push(eq(employeePostingsTable.employeeId, parseInt(employeeId, 10)));
  if (orgUnitId) conditions.push(eq(employeePostingsTable.orgUnitId, parseInt(orgUnitId, 10)));
  if (isCurrent === "true") conditions.push(eq(employeePostingsTable.isCurrent, true));
  if (isCurrent === "false") conditions.push(eq(employeePostingsTable.isCurrent, false));

  const rows = conditions.length
    ? await db.select().from(employeePostingsTable).where(and(...conditions))
    : await db.select().from(employeePostingsTable);

  const enriched = await Promise.all(rows.map(enrichPosting));
  res.json(enriched);
});

// POST /employee-postings
router.post("/employee-postings", async (req, res): Promise<void> => {
  const { employeeId, orgUnitId, positionTitleEn, positionTitleAr, startDate, isCurrent, ...rest } = req.body;

  if (!employeeId || !orgUnitId || !positionTitleEn || !positionTitleAr || !startDate) {
    res.status(400).json({ error: "employeeId, orgUnitId, positionTitleEn, positionTitleAr, startDate are required" });
    return;
  }

  if (isCurrent === true) {
    await db
      .update(employeePostingsTable)
      .set({ isCurrent: false })
      .where(eq(employeePostingsTable.employeeId, parseInt(employeeId, 10)));
  }

  const [row] = await db
    .insert(employeePostingsTable)
    .values({ employeeId: parseInt(employeeId, 10), orgUnitId: parseInt(orgUnitId, 10), positionTitleEn, positionTitleAr, startDate, isCurrent: isCurrent ?? false, ...rest })
    .returning();

  const enriched = await enrichPosting(row);
  res.status(201).json(enriched);
});

// GET /employee-postings/:id
router.get("/employee-postings/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(employeePostingsTable).where(eq(employeePostingsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Employee posting not found" });
    return;
  }
  res.json(await enrichPosting(row));
});

// PATCH /employee-postings/:id
router.patch("/employee-postings/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(employeePostingsTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(employeePostingsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Employee posting not found" });
    return;
  }
  res.json(await enrichPosting(row));
});

// DELETE /employee-postings/:id
router.delete("/employee-postings/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(employeePostingsTable)
    .where(eq(employeePostingsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Employee posting not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
