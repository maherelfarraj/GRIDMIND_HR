import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Current and historical position/posting assignments for employees.
export const employeePostingsTable = pgTable("employee_postings", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  orgUnitId: integer("org_unit_id").notNull(),
  dutyStationId: integer("duty_station_id"),
  rankId: integer("rank_id"),  // militaryRanksTable.id
  positionTitleEn: varchar("position_title_en", { length: 200 }).notNull(),
  positionTitleAr: varchar("position_title_ar", { length: 200 }).notNull(),
  positionCode: varchar("position_code", { length: 30 }),
  // "permanent" | "temporary" | "tdy" | "acting" | "attached"
  postingType: varchar("posting_type", { length: 30 }).notNull().default("permanent"),
  startDate: varchar("start_date", { length: 10 }).notNull(),  // YYYY-MM-DD
  endDate: varchar("end_date", { length: 10 }),
  isCurrent: boolean("is_current").notNull().default(true),
  orderNumber: varchar("order_number", { length: 60 }),
  orderDate: varchar("order_date", { length: 10 }),
  authorizedByEmployeeId: integer("authorized_by_employee_id"),
  remarksEn: text("remarks_en"),
  remarksAr: text("remarks_ar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmployeePosting = typeof employeePostingsTable.$inferSelect;
