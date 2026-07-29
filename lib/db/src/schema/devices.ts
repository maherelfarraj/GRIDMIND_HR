import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceDevicesTable = pgTable("attendance_devices", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  serialNumber: text("serial_number").notNull().unique(),
  model: text("model").notNull(),
  vendor: text("vendor").notNull(),
  type: text("type").notNull(),
  ipAddress: text("ip_address"),
  location: text("location").notNull(),
  locationAr: text("location_ar").notNull(),
  departmentId: integer("department_id"),
  status: text("status").notNull().default("online"),
  lastSyncAt: timestamp("last_sync_at"),
  firmwareVersion: text("firmware_version"),
  integrationProtocol: text("integration_protocol").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDeviceSchema = createInsertSchema(attendanceDevicesTable).omit({ id: true, createdAt: true, lastSyncAt: true });
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type AttendanceDevice = typeof attendanceDevicesTable.$inferSelect;
