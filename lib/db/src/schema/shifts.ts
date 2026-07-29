import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";
import { departmentsTable } from "./departments";

export const shiftsTable = pgTable("shifts", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  shiftCode: varchar("shift_code", { length: 20 }).notNull().unique(),
  shiftType: varchar("shift_type", { length: 20 }).notNull().default("day"), // day | night | split | flexible
  startTime: varchar("start_time", { length: 5 }).notNull(), // HH:MM
  endTime: varchar("end_time", { length: 5 }).notNull(),     // HH:MM
  breakMinutes: integer("break_minutes").notNull().default(60),
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(15),
  maxOvertimeMinutes: integer("max_overtime_minutes").notNull().default(120),
  color: varchar("color", { length: 7 }).notNull().default("#3B82F6"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
