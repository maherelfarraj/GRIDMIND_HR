import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * UAT scripts — structured user acceptance test scripts for each role.
 * One script per role per module area. Steps are executed sequentially.
 */
export const uatScriptsTable = pgTable("uat_scripts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  scriptCode: varchar("script_code", { length: 40 }).notNull().unique(),
  titleEn: varchar("title_en", { length: 250 }).notNull(),
  titleAr: varchar("title_ar", { length: 250 }).notNull(),
  // "hr_admin" | "hr_manager" | "payroll_admin" | "attendance_supervisor"
  // | "line_manager" | "employee" | "auditor" | "security_admin"
  // | "government_user" | "defense_user" | "it_admin" | "finance_officer"
  targetRole: varchar("target_role", { length: 30 }).notNull(),
  // Module being tested
  // "authentication" | "leave" | "payroll" | "attendance" | "recruitment"
  // | "performance" | "training" | "documents" | "reporting" | "security"
  // | "backup_restore" | "approvals" | "self_service" | "admin"
  module: varchar("module", { length: 30 }).notNull(),
  // "commercial" | "government" | "defense" | "all"
  orgTypeApplicability: varchar("org_type_applicability", { length: 20 }).notNull().default("all"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(20),
  prerequisitesEn: text("prerequisites_en"),
  prerequisitesAr: text("prerequisites_ar"),
  // JSON array of step objects:
  // { stepNumber, actionEn, actionAr, expectedResultEn, expectedResultAr,
  //   navigateTo?, inputData?, screenshotRequired, isOptional }
  stepsJson: text("steps_json").notNull().default("[]"),
  // Acceptance criteria (JSON array of strings)
  acceptanceCriteriaJson: text("acceptance_criteria_json").notNull().default("[]"),
  // Which go-live gate this script provides evidence for
  relatedGateCodes: text("related_gate_codes"),
  isActive: boolean("is_active").notNull().default(true),
  version: varchar("version", { length: 10 }).notNull().default("1.0"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UatScript = typeof uatScriptsTable.$inferSelect;

/**
 * UAT test runs — each time a tester executes a UAT script.
 */
export const uatTestRunsTable = pgTable("uat_test_runs", {
  id: serial("id").primaryKey(),
  scriptId: integer("script_id").notNull(),
  orgId: integer("org_id"),
  // The tester
  testerUserId: integer("tester_user_id").notNull(),
  testerRole: varchar("tester_role", { length: 30 }),
  testerNameEn: varchar("tester_name_en", { length: 100 }),
  // "in_progress" | "pass" | "fail" | "partial" | "blocked"
  result: varchar("result", { length: 15 }).notNull().default("in_progress"),
  currentStep: integer("current_step").notNull().default(1),
  totalSteps: integer("total_steps").notNull().default(0),
  passedSteps: integer("passed_steps").notNull().default(0),
  failedSteps: integer("failed_steps").notNull().default(0),
  skippedSteps: integer("skipped_steps").notNull().default(0),
  // Defect IDs raised during this run
  raisedDefectIds: text("raised_defect_ids"),
  overallNotes: text("overall_notes"),
  // Environment details
  browserInfo: varchar("browser_info", { length: 100 }),
  environment: varchar("environment", { length: 20 }).notNull().default("pilot"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UatTestRun = typeof uatTestRunsTable.$inferSelect;

/**
 * UAT test run step results — individual step outcomes within a run.
 */
export const uatTestRunStepsTable = pgTable("uat_test_run_steps", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  stepNumber: integer("step_number").notNull(),
  // "pass" | "fail" | "skip" | "pending"
  result: varchar("result", { length: 10 }).notNull().default("pending"),
  actualResultEn: text("actual_result_en"),
  // Defect raised at this step (if any)
  defectId: integer("defect_id"),
  notes: text("notes"),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UatTestRunStep = typeof uatTestRunStepsTable.$inferSelect;
