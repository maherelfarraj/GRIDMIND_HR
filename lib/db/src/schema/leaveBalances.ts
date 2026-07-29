import { pgTable, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { leaveTypesTable } from "./leaveTypes";

export const leaveBalancesTable = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id),
  year: integer("year").notNull(),
  openingBalance: numeric("opening_balance", { precision: 6, scale: 2 }).notNull().default("0"),
  accrued: numeric("accrued", { precision: 6, scale: 2 }).notNull().default("0"),
  used: numeric("used", { precision: 6, scale: 2 }).notNull().default("0"),
  pending: numeric("pending", { precision: 6, scale: 2 }).notNull().default("0"),
  adjustment: numeric("adjustment", { precision: 6, scale: 2 }).notNull().default("0"),
  carriedOver: numeric("carried_over", { precision: 6, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LeaveBalance = typeof leaveBalancesTable.$inferSelect;
