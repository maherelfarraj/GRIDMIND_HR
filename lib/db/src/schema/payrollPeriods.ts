import { pgTable, serial, varchar, integer, boolean, timestamp, numeric, text } from "drizzle-orm/pg-core";

export const payrollPeriodsTable = pgTable("payroll_periods", {
  id: serial("id").primaryKey(),
  periodCode: varchar("period_code", { length: 20 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  // monthly | biweekly | weekly
  periodType: varchar("period_type", { length: 20 }).notNull().default("monthly"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  payDate: text("pay_date").notNull(),
  // draft | calculating | under_review | first_approved | second_approved | closed
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  totalEmployees: integer("total_employees").notNull().default(0),
  totalGrossSalary: numeric("total_gross_salary", { precision: 14, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 14, scale: 2 }).notNull().default("0"),
  totalNetSalary: numeric("total_net_salary", { precision: 14, scale: 2 }).notNull().default("0"),
  exceptionCount: integer("exception_count").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
  firstApprovedBy: integer("first_approved_by"),
  firstApprovedAt: timestamp("first_approved_at"),
  firstApproverNote: text("first_approver_note"),
  secondApprovedBy: integer("second_approved_by"),
  secondApprovedAt: timestamp("second_approved_at"),
  secondApproverNote: text("second_approver_note"),
  closedAt: timestamp("closed_at"),
  isClosed: boolean("is_closed").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PayrollPeriod = typeof payrollPeriodsTable.$inferSelect;
