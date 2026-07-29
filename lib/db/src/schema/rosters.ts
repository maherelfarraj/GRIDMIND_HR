import { pgTable, serial, integer, varchar, boolean, text, timestamp, date } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { shiftsTable } from "./shifts";

export const rostersTable = pgTable("rosters", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  shiftId: integer("shift_id").references(() => shiftsTable.id),
  date: date("date").notNull(),
  isOffDay: boolean("is_off_day").notNull().default(false),
  isPublicHoliday: boolean("is_public_holiday").notNull().default(false),
  status: varchar("status", { length: 30 }).notNull().default("scheduled"),
  // scheduled | worked | absent | late | leave | holiday | overtime
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
