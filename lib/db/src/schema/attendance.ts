import { pgTable, serial, text, integer, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  orgId: integer("org_id").notNull().default(1),
  departmentId: integer("department_id").notNull(),
  date: text("date").notNull(),
  checkInTime: text("check_in_time"),
  checkOutTime: text("check_out_time"),
  status: text("status").notNull().default("present"),
  deviceId: integer("device_id"),
  lateMinutes: integer("late_minutes"),
  overtimeMinutes: integer("overtime_minutes"),
  workingHours: real("working_hours"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // One attendance row per employee per day — required for the gateway's
  // concurrency-safe punch materialization upsert.
  uniqueIndex("uq_attendance_employee_date").on(t.employeeId, t.date),
]);

export const insertAttendanceSchema = createInsertSchema(attendanceRecordsTable).omit({ id: true, createdAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
