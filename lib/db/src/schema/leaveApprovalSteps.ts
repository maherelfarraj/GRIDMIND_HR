import { pgTable, serial, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { leaveRequestsTable } from "./leaveRequests";

export const leaveApprovalStepsTable = pgTable("leave_approval_steps", {
  id: serial("id").primaryKey(),
  leaveRequestId: integer("leave_request_id").notNull().references(() => leaveRequestsTable.id),
  stepNumber: integer("step_number").notNull(),
  // department_manager | hr_officer | hr_director | finance_director
  roleRequired: varchar("role_required", { length: 50 }),
  assignedToEmployeeId: integer("assigned_to_employee_id").references(() => employeesTable.id),
  // pending | approved | rejected | delegated | skipped
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // approve | reject
  decision: varchar("decision", { length: 20 }),
  notes: text("notes"),
  decidedAt: timestamp("decided_at"),
  delegatedToEmployeeId: integer("delegated_to_employee_id").references(() => employeesTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeaveApprovalStep = typeof leaveApprovalStepsTable.$inferSelect;
