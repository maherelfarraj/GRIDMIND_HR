import { pgTable, serial, varchar, integer, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

export const leaveTypesTable = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  codeEn: varchar("code_en", { length: 20 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  // general | sick | emergency | maternity | paternity | study | military | unpaid
  category: varchar("category", { length: 30 }).notNull().default("general"),
  defaultDaysPerYear: integer("default_days_per_year").notNull().default(0),
  // annual | monthly | none
  accrualFrequency: varchar("accrual_frequency", { length: 20 }).notNull().default("annual"),
  accrualAmount: numeric("accrual_amount", { precision: 5, scale: 2 }).notNull().default("0"),
  maxCarryoverDays: integer("max_carryover_days").notNull().default(0),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  requiresAttachment: boolean("requires_attachment").notNull().default(false),
  minAdvanceNoticeDays: integer("min_advance_notice_days").notNull().default(0),
  maxConsecutiveDays: integer("max_consecutive_days"),
  // all | male | female
  applicableToGender: varchar("applicable_to_gender", { length: 10 }).default("all"),
  isActive: boolean("is_active").notNull().default(true),
  color: varchar("color", { length: 7 }).notNull().default("#6366F1"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LeaveType = typeof leaveTypesTable.$inferSelect;
