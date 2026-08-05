import { pgTable, serial, varchar, integer, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { leaveTypesTable } from "./leaveTypes";

export const leaveRequestsTable = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  requestNumber: varchar("request_number", { length: 20 }).notNull().unique(),
  orgId: integer("org_id").notNull().default(1),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  totalDays: numeric("total_days", { precision: 5, scale: 1 }).notNull(),
  halfDay: boolean("half_day").notNull().default(false),
  halfDayPeriod: varchar("half_day_period", { length: 10 }), // am | pm
  reasonEn: text("reason_en"),
  reasonAr: text("reason_ar"),
  // draft | submitted | under_review | approved | rejected | cancelled | returned
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  coveringEmployeeId: integer("covering_employee_id").references(() => employeesTable.id),
  returnedToWork: boolean("returned_to_work").notNull().default(false),
  returnDate: text("return_date"),
  returnNotes: text("return_notes"),
  currentStepNumber: integer("current_step_number").notNull().default(1),
  totalApprovalSteps: integer("total_approval_steps").notNull().default(2),
  submittedAt: timestamp("submitted_at"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;
