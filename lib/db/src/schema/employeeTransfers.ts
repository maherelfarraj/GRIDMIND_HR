import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Transfer orders between org units / duty stations.
export const employeeTransfersTable = pgTable("employee_transfers", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  fromOrgUnitId: integer("from_org_unit_id"),
  toOrgUnitId: integer("to_org_unit_id").notNull(),
  fromStationId: integer("from_station_id"),
  toStationId: integer("to_station_id"),
  transferDate: varchar("transfer_date", { length: 10 }).notNull(),  // YYYY-MM-DD
  effectiveDate: varchar("effective_date", { length: 10 }),
  orderNumber: varchar("order_number", { length: 60 }).notNull(),
  orderDate: varchar("order_date", { length: 10 }),
  // "requested" | "approved" | "executed" | "cancelled" | "deferred"
  status: varchar("status", { length: 20 }).notNull().default("requested"),
  reasonEn: text("reason_en"),
  reasonAr: text("reason_ar"),
  initiatedByUserId: integer("initiated_by_user_id"),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  requiresDualAuth: boolean("requires_dual_auth").notNull().default(false),
  dualAuthRequestId: integer("dual_auth_request_id"),
  remarksEn: text("remarks_en"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmployeeTransfer = typeof employeeTransfersTable.$inferSelect;
