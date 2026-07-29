import { Router } from "express";
import { db, leaveBalancesTable, leaveTypesTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /leave-balances?employeeId=&year=&leaveTypeId=
router.get("/leave-balances", async (req, res): Promise<void> => {
  const { employeeId, year, leaveTypeId } = req.query as Record<string, string>;

  const conditions = [];
  if (employeeId) conditions.push(eq(leaveBalancesTable.employeeId, parseInt(employeeId, 10)));
  if (year) conditions.push(eq(leaveBalancesTable.year, parseInt(year, 10)));
  if (leaveTypeId) conditions.push(eq(leaveBalancesTable.leaveTypeId, parseInt(leaveTypeId, 10)));

  const balances = conditions.length > 0
    ? await db.select().from(leaveBalancesTable).where(and(...conditions))
    : await db.select().from(leaveBalancesTable);

  // Enrich with employee + type names
  const emps = await db.select().from(employeesTable);
  const types = await db.select().from(leaveTypesTable);
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
  const typeMap = Object.fromEntries(types.map(t => [t.id, t]));

  const enriched = balances.map(b => {
    const emp = empMap[b.employeeId];
    const lt = typeMap[b.leaveTypeId];
    const available = parseFloat(b.openingBalance) + parseFloat(b.accrued) + parseFloat(b.carriedOver) +
      parseFloat(b.adjustment) - parseFloat(b.used) - parseFloat(b.pending);
    return {
      ...b,
      available: available.toFixed(2),
      employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
      leaveTypeNameEn: lt?.nameEn ?? "Unknown",
      leaveTypeNameAr: lt?.nameAr ?? "Unknown",
      leaveTypeColor: lt?.color ?? "#6366F1",
    };
  });

  res.json(enriched);
});

// POST /leave-balances — create or upsert balance
router.post("/leave-balances", async (req, res): Promise<void> => {
  const { employeeId, leaveTypeId, year, openingBalance, accrued, adjustment, carriedOver } = req.body;
  if (!employeeId || !leaveTypeId || !year) {
    res.status(400).json({ error: "employeeId, leaveTypeId, year required" });
    return;
  }
  const [existing] = await db.select().from(leaveBalancesTable)
    .where(and(
      eq(leaveBalancesTable.employeeId, employeeId),
      eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
      eq(leaveBalancesTable.year, year),
    ));
  if (existing) {
    const [updated] = await db.update(leaveBalancesTable)
      .set({ openingBalance, accrued, adjustment, carriedOver, updatedAt: new Date() })
      .where(eq(leaveBalancesTable.id, existing.id))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(leaveBalancesTable).values({
      employeeId, leaveTypeId, year,
      openingBalance: openingBalance ?? "0",
      accrued: accrued ?? "0",
      used: "0",
      pending: "0",
      adjustment: adjustment ?? "0",
      carriedOver: carriedOver ?? "0",
    }).returning();
    res.status(201).json(created);
  }
});

// PATCH /leave-balances/:id
router.patch("/leave-balances/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { openingBalance, accrued, used, pending, adjustment, carriedOver } = req.body;
  const [b] = await db.update(leaveBalancesTable)
    .set({ openingBalance, accrued, used, pending, adjustment, carriedOver, updatedAt: new Date() })
    .where(eq(leaveBalancesTable.id, id))
    .returning();
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  res.json(b);
});

export default router;
