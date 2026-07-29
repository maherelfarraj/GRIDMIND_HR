import { pgTable, serial, varchar, integer, boolean, numeric, timestamp, date, text } from "drizzle-orm/pg-core";
import { departmentsTable } from "./departments";

export const overtimeRulesTable = pgTable("overtime_rules", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  departmentId: integer("department_id").references(() => departmentsTable.id), // null = global
  maxDailyMinutes: integer("max_daily_minutes").notNull().default(120),
  maxWeeklyMinutes: integer("max_weekly_minutes").notNull().default(600),
  multiplierWeekday: numeric("multiplier_weekday", { precision: 4, scale: 2 }).notNull().default("1.50"),
  multiplierWeekend: numeric("multiplier_weekend", { precision: 4, scale: 2 }).notNull().default("2.00"),
  multiplierHoliday: numeric("multiplier_holiday", { precision: 4, scale: 2 }).notNull().default("2.50"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
