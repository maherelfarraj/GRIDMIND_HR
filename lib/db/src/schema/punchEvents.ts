import { pgTable, serial, integer, varchar, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { attendanceDevicesTable } from "./devices";
import { attendanceRecordsTable } from "./attendance";

export const punchEventsTable = pgTable("punch_events", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  deviceId: integer("device_id").references(() => attendanceDevicesTable.id),
  attendanceRecordId: integer("attendance_record_id").references(() => attendanceRecordsTable.id),
  eventTime: timestamp("event_time").notNull(),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  // CLOCK_IN | CLOCK_OUT | BREAK_START | BREAK_END | OVERTIME_START | OVERTIME_END
  source: varchar("source", { length: 20 }).notNull().default("BIOMETRIC"),
  // BIOMETRIC | MANUAL | CORRECTION | IMPORT
  isVerified: boolean("is_verified").notNull().default(true),
  isMissing: boolean("is_missing").notNull().default(false), // flagged as missing by system
  rawPayload: text("raw_payload"), // JSON from device
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
