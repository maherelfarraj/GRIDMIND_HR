import { Router } from "express";
import { db, leaveBalancesTable, leaveTypesTable, employeesTable, auditLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ensureLeaveBalance } from "../lib/leaveBalance";

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
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
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
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseInt(req.params.id, 10);
  const { openingBalance, accrued, used, pending, adjustment, carriedOver } = req.body;
  const [b] = await db.update(leaveBalancesTable)
    .set({ openingBalance, accrued, used, pending, adjustment, carriedOver, updatedAt: new Date() })
    .where(eq(leaveBalancesTable.id, id))
    .returning();
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  res.json(b);
});

// POST /leave-balances/annual-reset
// Creates new year balance rows for every active employee × leave type,
// carrying over min(balance_available, maxCarryoverDays) from the previous year.
router.post("/leave-balances/annual-reset", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1; // demo fallback
    const { year } = req.body;
    if (!year) { res.status(400).json({ error: "year required" }); return; }
    const newYear = parseInt(year, 10);
    const prevYear = newYear - 1;

    const employees = await db.select().from(employeesTable);
    const leaveTypes = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.isActive, true));

    let created = 0;

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        // Skip if already exists for this year
        const [existing] = await db.select().from(leaveBalancesTable).where(
          and(
            eq(leaveBalancesTable.employeeId, emp.id),
            eq(leaveBalancesTable.leaveTypeId, lt.id),
            eq(leaveBalancesTable.year, newYear),
          )
        );
        if (existing) continue;

        // Find previous year balance to compute carryover
        const [prev] = await db.select().from(leaveBalancesTable).where(
          and(
            eq(leaveBalancesTable.employeeId, emp.id),
            eq(leaveBalancesTable.leaveTypeId, lt.id),
            eq(leaveBalancesTable.year, prevYear),
          )
        );

        let carryover = 0;
        if (prev && lt.maxCarryoverDays > 0) {
          const available = parseFloat(prev.openingBalance) + parseFloat(prev.accrued) +
            parseFloat(prev.carriedOver) + parseFloat(prev.adjustment) -
            parseFloat(prev.used) - parseFloat(prev.pending);
          carryover = Math.min(Math.max(0, available), lt.maxCarryoverDays);
        }

        await db.insert(leaveBalancesTable).values({
          employeeId: emp.id,
          leaveTypeId: lt.id,
          year: newYear,
          openingBalance: String(lt.defaultDaysPerYear),
          accrued: "0",
          used: "0",
          pending: "0",
          adjustment: "0",
          carriedOver: carryover.toFixed(2),
        });
        created++;
      }
    }

    await db.insert(auditLogsTable).values({
      action: "leave_balance.annual_reset",
      entityType: "leave_balance",
      actorUserId,
      changesJson: JSON.stringify({ year: newYear, created }),
    });

    res.json({ created, year: newYear });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /leave-balances/provision-year
// Bulk-provisions balance rows for all ACTIVE employees × active leave types
// for a target year, reusing ensureLeaveBalance so carry-over caps apply.
// Idempotent: existing rows are left untouched.
router.post("/leave-balances/provision-year", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1; // demo fallback
    const { year } = req.body;
    const targetYear = parseInt(year, 10);
    if (!year || Number.isNaN(targetYear)) {
      res.status(400).json({ error: "year required" });
      return;
    }

    const employees = await db.select().from(employeesTable)
      .where(eq(employeesTable.status, "active"));
    const leaveTypes = await db.select().from(leaveTypesTable)
      .where(eq(leaveTypesTable.isActive, true));

    // Snapshot existing rows for the year so we can count newly created ones.
    const existingRows = await db.select().from(leaveBalancesTable)
      .where(eq(leaveBalancesTable.year, targetYear));
    const existingKeys = new Set(existingRows.map(r => `${r.employeeId}:${r.leaveTypeId}`));

    let created = 0;
    let skipped = 0;
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const key = `${emp.id}:${lt.id}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        const row = await ensureLeaveBalance(emp.id, lt.id, targetYear);
        if (row) created++;
      }
    }

    await db.insert(auditLogsTable).values({
      action: "leave_balance.provision_year",
      entityType: "leave_balance",
      actorUserId,
      changesJson: JSON.stringify({ year: targetYear, created, skipped }),
    });

    res.json({ created, skipped, year: targetYear });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
