import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { payrollPeriodsTable } from "./payrollPeriods";
import { employeesTable } from "./employees";

/**
 * Days HR has excused for a detected no-show absence within a payroll period.
 * Excused days are skipped by the ABSENCE deduction on (re)calculation.
 */
export const payrollExcusedAbsencesTable = pgTable("payroll_excused_absences", {
  id: serial("id").primaryKey(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriodsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  // YYYY-MM-DD (matches payroll period start/end date convention)
  date: text("date").notNull(),
  reason: text("reason").notNull(),
  excusedByUserId: integer("excused_by_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_excused_unique").on(t.payrollPeriodId, t.employeeId, t.date),
]);

export type PayrollExcusedAbsence = typeof payrollExcusedAbsencesTable.$inferSelect;
