import { pgTable, serial, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const leaveDelegationsTable = pgTable("leave_delegations", {
  id: serial("id").primaryKey(),
  delegatorEmployeeId: integer("delegator_employee_id").notNull().references(() => employeesTable.id),
  delegateeEmployeeId: integer("delegatee_employee_id").notNull().references(() => employeesTable.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeaveDelegation = typeof leaveDelegationsTable.$inferSelect;
