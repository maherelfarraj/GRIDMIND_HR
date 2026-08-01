import { db, employeesTable } from "@workspace/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";

/**
 * Read-time reconciliation for future-dated offboardings: any employee still
 * "active" whose recorded last working day has passed is flipped to
 * "terminated". Called before employee reads and payroll calculation so the
 * status can never drift from the recorded date, without needing a scheduler.
 */
export async function reconcileTerminationStatuses(): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  await db.update(employeesTable)
    .set({ status: "terminated", updatedAt: new Date() })
    .where(and(
      eq(employeesTable.status, "active"),
      isNotNull(employeesTable.terminationDate),
      lte(employeesTable.terminationDate, todayStr),
    ));
}
