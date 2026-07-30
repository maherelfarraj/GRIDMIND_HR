import { pgTable, serial, integer, varchar, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

// Performance goal cycles and individual employee goals / KPIs.
export const goalCyclesTable = pgTable("goal_cycles", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  // "annual" | "half_year" | "quarterly"
  cycleType: varchar("cycle_type", { length: 20 }).notNull().default("annual"),
  year: integer("year").notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  goalSettingDeadline: varchar("goal_setting_deadline", { length: 10 }),
  midYearReviewDate: varchar("mid_year_review_date", { length: 10 }),
  // "planning" | "active" | "mid_review" | "final_review" | "closed"
  status: varchar("status", { length: 20 }).notNull().default("planning"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const employeeGoalsTable = pgTable("employee_goals", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }),
  descriptionEn: text("description_en"),
  // "strategic" | "operational" | "developmental" | "behavioral"
  goalType: varchar("goal_type", { length: 30 }).notNull().default("operational"),
  weight: integer("weight").notNull().default(25),  // % of total goals
  // KPIs
  targetValue: varchar("target_value", { length: 100 }),
  targetUnit: varchar("target_unit", { length: 50 }),
  actualValue: varchar("actual_value", { length: 100 }),
  // "not_started" | "in_progress" | "at_risk" | "completed" | "exceeded"
  progressStatus: varchar("progress_status", { length: 20 }).notNull().default("not_started"),
  completionPct: integer("completion_pct").notNull().default(0),
  // 1–5 score assigned during appraisal
  finalScore: integer("final_score"),
  managerScore: integer("manager_score"),
  // "draft" | "submitted" | "approved" | "active" | "closed"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  dueDate: varchar("due_date", { length: 10 }),
  linkedOrgObjective: varchar("linked_org_objective", { length: 300 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type GoalCycle = typeof goalCyclesTable.$inferSelect;
export type EmployeeGoal = typeof employeeGoalsTable.$inferSelect;
