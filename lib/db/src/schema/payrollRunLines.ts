import { pgTable, serial, varchar, integer, numeric } from "drizzle-orm/pg-core";
import { payrollRunsTable } from "./payrollRuns";
import { payComponentsTable } from "./payComponents";

export const payrollRunLinesTable = pgTable("payroll_run_lines", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRunsTable.id),
  payComponentId: integer("pay_component_id").references(() => payComponentsTable.id),
  codeEn: varchar("code_en", { length: 30 }).notNull(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  // earning | deduction | benefit
  type: varchar("type", { length: 20 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type PayrollRunLine = typeof payrollRunLinesTable.$inferSelect;
