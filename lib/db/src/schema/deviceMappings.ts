import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const deviceEmployeeMappingsTable = pgTable("device_employee_mappings", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  accessLevel: text("access_level").notNull().default("standard"), // standard | restricted | admin
  enrolledAt: text("enrolled_at").notNull(), // ISO date string
  enrolledByUserId: integer("enrolled_by_user_id").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  biometricType: text("biometric_type").notNull().default("fingerprint"), // fingerprint | face | card | pin
  deviceUserId: text("device_user_id"), // the device's internal user id, used by gateway punch resolution
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDeviceMappingSchema = createInsertSchema(deviceEmployeeMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeviceMapping = z.infer<typeof insertDeviceMappingSchema>;
export type DeviceEmployeeMapping = typeof deviceEmployeeMappingsTable.$inferSelect;
