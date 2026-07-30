import { pgTable, serial, varchar, integer, numeric, timestamp, text } from "drizzle-orm/pg-core";
import { payrollPeriodsTable } from "./payrollPeriods";

export const workforceSnapshotsTable = pgTable("workforce_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: text("snapshot_date").notNull(),
  period: varchar("period", { length: 20 }).notNull().default("monthly"),
  headcount: integer("headcount").notNull().default(0),
  newHires: integer("new_hires").notNull().default(0),
  departures: integer("departures").notNull().default(0),
  openVacancies: integer("open_vacancies").notNull().default(0),
  totalPayroll: numeric("total_payroll", { precision: 15, scale: 2 }).notNull().default("0"),
  avgSalary: numeric("avg_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  overtimeHours: numeric("overtime_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  absenceRate: numeric("absence_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payrollVarianceLogTable = pgTable("payroll_variance_log", {
  id: serial("id").primaryKey(),
  periodId: integer("period_id").notNull().references(() => payrollPeriodsTable.id),
  prevPeriodId: integer("prev_period_id"),
  totalGross: numeric("total_gross", { precision: 15, scale: 2 }).notNull().default("0"),
  prevTotalGross: numeric("prev_total_gross", { precision: 15, scale: 2 }),
  variance: numeric("variance", { precision: 15, scale: 2 }).notNull().default("0"),
  variancePct: numeric("variance_pct", { precision: 6, scale: 2 }).notNull().default("0"),
  exceptionsCount: integer("exceptions_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const analyticsKpiCacheTable = pgTable("analytics_kpi_cache", {
  id: serial("id").primaryKey(),
  cacheKey: varchar("cache_key", { length: 120 }).notNull().unique(),
  valueJson: text("value_json").notNull(),
  computedAt: timestamp("computed_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type WorkforceSnapshot = typeof workforceSnapshotsTable.$inferSelect;
export type PayrollVarianceLog = typeof payrollVarianceLogTable.$inferSelect;
export type AnalyticsKpiCache = typeof analyticsKpiCacheTable.$inferSelect;
