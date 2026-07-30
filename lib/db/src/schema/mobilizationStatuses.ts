import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Mobilization / readiness status per employee.
export const mobilizationStatusesTable = pgTable("mobilization_statuses", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().unique(),
  // "available" | "mobilized" | "demobilized" | "reserve" | "deferred" | "exempt" | "deployed"
  status: varchar("status", { length: 30 }).notNull().default("available"),
  // Unit this employee is mobilized/assigned to
  unitAssignment: varchar("unit_assignment", { length: 200 }),
  deploymentStart: varchar("deployment_start", { length: 10 }),  // YYYY-MM-DD
  deploymentEnd: varchar("deployment_end", { length: 10 }),
  deploymentLocation: varchar("deployment_location", { length: 200 }),
  // "administrative" | "operational" | "combat" | "support" | "training"
  deploymentType: varchar("deployment_type", { length: 30 }).notNull().default("administrative"),
  // "A1" ready | "A2" partially ready | "B1" limited | "C1" not ready
  readinessCode: varchar("readiness_code", { length: 5 }).notNull().default("A1"),
  mraRating: varchar("mra_rating", { length: 20 }),  // Medical Readiness Assessment
  exemptionReason: text("exemption_reason"),
  remarksEn: text("remarks_en"),
  updatedByUserId: integer("updated_by_user_id"),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MobilizationStatus = typeof mobilizationStatusesTable.$inferSelect;
