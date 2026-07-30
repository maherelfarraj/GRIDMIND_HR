import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Per-employee onboarding session and task tracking.
export const employeeOnboardingTable = pgTable("employee_onboarding", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  templateId: integer("template_id"),
  contractId: integer("contract_id"),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  targetCompletionDate: varchar("target_completion_date", { length: 10 }),
  completedAt: timestamp("completed_at"),
  // "not_started" | "in_progress" | "completed" | "overdue" | "cancelled"
  status: varchar("status", { length: 20 }).notNull().default("not_started"),
  completionPct: integer("completion_pct").notNull().default(0),
  hrOwnerUserId: integer("hr_owner_user_id"),
  managerEmployeeId: integer("manager_employee_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const onboardingTasksTable = pgTable("onboarding_tasks", {
  id: serial("id").primaryKey(),
  onboardingId: integer("onboarding_id").notNull(),
  templateItemId: integer("template_item_id"),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }).notNull(),
  ownerRole: varchar("owner_role", { length: 30 }).notNull().default("hr"),
  taskType: varchar("task_type", { length: 30 }).notNull().default("general"),
  dueDate: varchar("due_date", { length: 10 }),
  // "pending" | "in_progress" | "completed" | "skipped" | "overdue"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id"),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmployeeOnboarding = typeof employeeOnboardingTable.$inferSelect;
export type OnboardingTask = typeof onboardingTasksTable.$inferSelect;
