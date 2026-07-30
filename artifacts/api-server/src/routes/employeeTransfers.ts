import { Router } from "express";
import { db, employeeTransfersTable, employeesTable, orgUnitsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichTransfer(t: typeof employeeTransfersTable.$inferSelect) {
  let employeeNameEn: string | null = null;
  if (t.employeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, t.employeeId));
    if (emp) employeeNameEn = emp.firstNameEn + " " + emp.lastNameEn;
  }

  let fromUnitNameEn: string | null = null;
  if (t.fromOrgUnitId) {
    const [unit] = await db.select().from(orgUnitsTable).where(eq(orgUnitsTable.id, t.fromOrgUnitId));
    if (unit) fromUnitNameEn = unit.nameEn;
  }

  let toUnitNameEn: string | null = null;
  if (t.toOrgUnitId) {
    const [unit] = await db.select().from(orgUnitsTable).where(eq(orgUnitsTable.id, t.toOrgUnitId));
    if (unit) toUnitNameEn = unit.nameEn;
  }

  return { ...t, employeeNameEn, fromUnitNameEn, toUnitNameEn };
}

// GET /employee-transfers
router.get("/employee-transfers", async (req, res): Promise<void> => {
  const { employeeId, status } = req.query as Record<string, string>;

  const conditions = [];
  if (employeeId) conditions.push(eq(employeeTransfersTable.employeeId, parseInt(employeeId, 10)));
  if (status) conditions.push(eq(employeeTransfersTable.status, status));

  const rows = conditions.length
    ? await db.select().from(employeeTransfersTable).where(and(...conditions))
    : await db.select().from(employeeTransfersTable);

  const enriched = await Promise.all(rows.map(enrichTransfer));
  res.json(enriched);
});

// POST /employee-transfers
router.post("/employee-transfers", async (req, res): Promise<void> => {
  const { employeeId, toOrgUnitId, transferDate, orderNumber, ...rest } = req.body;

  if (!employeeId || !toOrgUnitId || !transferDate || !orderNumber) {
    res.status(400).json({ error: "employeeId, toOrgUnitId, transferDate, orderNumber are required" });
    return;
  }

  const [row] = await db
    .insert(employeeTransfersTable)
    .values({
      employeeId: parseInt(employeeId, 10),
      toOrgUnitId: parseInt(toOrgUnitId, 10),
      transferDate,
      orderNumber,
      ...rest,
    })
    .returning();

  res.status(201).json(await enrichTransfer(row));
});

// GET /employee-transfers/:id
router.get("/employee-transfers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(employeeTransfersTable).where(eq(employeeTransfersTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Employee transfer not found" });
    return;
  }
  res.json(await enrichTransfer(row));
});

// PATCH /employee-transfers/:id
router.patch("/employee-transfers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(employeeTransfersTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(employeeTransfersTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Employee transfer not found" });
    return;
  }
  res.json(await enrichTransfer(row));
});

export default router;
