import { pgTable, serial, integer, varchar, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

// Secondment records — temporary assignment to a host organization.
export const employeeSecondmentsTable = pgTable("employee_secondments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  hostOrgUnitId: integer("host_org_unit_id").notNull(),
  parentOrgUnitId: integer("parent_org_unit_id"),
  hostDutyStationId: integer("host_duty_station_id"),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }),
  // "active" | "completed" | "cancelled" | "extended"
  status: varchar("status", { length: 20 }).notNull().default("active"),
  purposeEn: text("purpose_en"),
  purposeAr: text("purpose_ar"),
  // % of base salary paid as secondment allowance
  allowancePct: numeric("allowance_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  orderNumber: varchar("order_number", { length: 60 }),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  requiresDualAuth: boolean("requires_dual_auth").notNull().default(false),
  dualAuthRequestId: integer("dual_auth_request_id"),
  hostContactName: varchar("host_contact_name", { length: 200 }),
  hostContactEmail: varchar("host_contact_email", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmployeeSecondment = typeof employeeSecondmentsTable.$inferSelect;
