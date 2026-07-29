import { pgTable, serial, varchar, integer, boolean, timestamp, numeric, text } from "drizzle-orm/pg-core";
import { payrollPeriodsTable } from "./payrollPeriods";
import { employeesTable } from "./employees";
import { salaryGradesTable } from "./salaryGrades";

export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriodsTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  salaryGradeId: integer("salary_grade_id").references(() => salaryGradesTable.id),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  grossSalary: numeric("gross_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  totalEarnings: numeric("total_earnings", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  netSalary: numeric("net_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  overtimeHours: numeric("overtime_hours", { precision: 6, scale: 2 }).notNull().default("0"),
  overtimePay: numeric("overtime_pay", { precision: 10, scale: 2 }).notNull().default("0"),
  deductedLeaveDays: numeric("deducted_leave_days", { precision: 5, scale: 1 }).notNull().default("0"),
  leaveDeductionAmount: numeric("leave_deduction_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  workingDays: integer("working_days").notNull().default(0),
  presentDays: integer("present_days").notNull().default(0),
  absentDays: integer("absent_days").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
  hasException: boolean("has_exception").notNull().default(false),
  exceptionNote: text("exception_note"),
  // draft | calculated | exception | approved
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  calculatedAt: timestamp("calculated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PayrollRun = typeof payrollRunsTable.$inferSelect;
