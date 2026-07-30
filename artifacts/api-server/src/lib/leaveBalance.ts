import { db, leaveBalancesTable, leaveTypesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

type LeaveBalanceRow = typeof leaveBalancesTable.$inferSelect;

/**
 * Ensures a leave balance row exists for (employeeId, leaveTypeId, year).
 *
 * If no row exists (e.g. a new calendar year has started), one is
 * auto-provisioned from the leave type's `defaultDaysPerYear`, with
 * carry-over from the previous year's remaining balance capped at the
 * leave type's `maxCarryoverDays`.
 *
 * Returns the existing or newly created balance row, or null if the
 * leave type does not exist.
 */
export async function ensureLeaveBalance(
  employeeId: number,
  leaveTypeId: number,
  year: number,
): Promise<LeaveBalanceRow | null> {
  const [existing] = await db.select().from(leaveBalancesTable).where(
    and(
      eq(leaveBalancesTable.employeeId, employeeId),
      eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
      eq(leaveBalancesTable.year, year),
    )
  );
  if (existing) return existing;

  const [leaveType] = await db.select().from(leaveTypesTable)
    .where(eq(leaveTypesTable.id, leaveTypeId));
  if (!leaveType) return null;

  // Carry-over: leftover from the previous year, capped by maxCarryoverDays
  let carriedOver = 0;
  if (leaveType.maxCarryoverDays > 0) {
    const [prev] = await db.select().from(leaveBalancesTable).where(
      and(
        eq(leaveBalancesTable.employeeId, employeeId),
        eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
        eq(leaveBalancesTable.year, year - 1),
      )
    );
    if (prev) {
      const remaining = parseFloat(prev.openingBalance) + parseFloat(prev.accrued) +
        parseFloat(prev.carriedOver) + parseFloat(prev.adjustment) -
        parseFloat(prev.used) - parseFloat(prev.pending);
      carriedOver = Math.max(0, Math.min(remaining, leaveType.maxCarryoverDays));
    }
  }

  const [created] = await db.insert(leaveBalancesTable).values({
    employeeId,
    leaveTypeId,
    year,
    openingBalance: "0",
    accrued: String(leaveType.defaultDaysPerYear),
    used: "0",
    pending: "0",
    adjustment: "0",
    carriedOver: carriedOver.toFixed(2),
  }).returning();
  return created;
}
