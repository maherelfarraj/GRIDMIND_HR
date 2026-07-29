import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceCorrectionsTable = pgTable("attendance_corrections", {
  id: serial("id").primaryKey(),
  attendanceRecordId: integer("attendance_record_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  requestedByUserId: integer("requested_by_user_id").notNull(),
  reviewedByUserId: integer("reviewed_by_user_id"),
  correctionType: text("correction_type").notNull(), // check_in | check_out | status | hours
  originalValue: text("original_value"),
  requestedValue: text("requested_value").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAttendanceCorrectionSchema = createInsertSchema(attendanceCorrectionsTable).omit({ id: true, createdAt: true, updatedAt: true, reviewedAt: true });
export type InsertAttendanceCorrection = z.infer<typeof insertAttendanceCorrectionSchema>;
export type AttendanceCorrection = typeof attendanceCorrectionsTable.$inferSelect;
