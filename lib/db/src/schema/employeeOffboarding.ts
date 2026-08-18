import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Tenant-scoped employee separation workflow and final-clearance tracking.
export const employeeOffboardingTable = pgTable("employee_offboarding", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  separationType: varchar("separation_type", { length: 30 }).notNull(),
  noticeDate: varchar("notice_date", { length: 10 }),
  lastWorkingDate: varchar("last_working_date", { length: 10 }).notNull(),
  // "draft" | "in_progress" | "blocked" | "completed" | "cancelled"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  completionPct: integer("completion_pct").notNull().default(0),
  hrOwnerUserId: integer("hr_owner_user_id"),
  managerEmployeeId: integer("manager_employee_id"),
  reason: text("reason"),
  eligibleForRehire: boolean("eligible_for_rehire"),
  exitInterviewCompletedAt: timestamp("exit_interview_completed_at"),
  finalSettlementCompletedAt: timestamp("final_settlement_completed_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const offboardingTasksTable = pgTable("offboarding_tasks", {
  id: serial("id").primaryKey(),
  offboardingId: integer("offboarding_id").notNull(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }).notNull(),
  // "hr" | "manager" | "employee" | "it" | "finance" | "security" | "facilities"
  ownerRole: varchar("owner_role", { length: 30 }).notNull().default("hr"),
  controlArea: varchar("control_area", { length: 30 }).notNull().default("general"),
  dueDate: varchar("due_date", { length: 10 }),
  // "pending" | "in_progress" | "completed" | "skipped" | "blocked"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id"),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmployeeOffboarding = typeof employeeOffboardingTable.$inferSelect;
export type OffboardingTask = typeof offboardingTasksTable.$inferSelect;
