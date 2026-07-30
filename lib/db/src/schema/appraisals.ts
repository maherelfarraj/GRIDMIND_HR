import { pgTable, serial, integer, varchar, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

// Appraisal cycles, per-employee appraisal records, and calibration.
export const appraisalCyclesTable = pgTable("appraisal_cycles", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  goalCycleId: integer("goal_cycle_id"),
  competencyFrameworkId: integer("competency_framework_id"),
  year: integer("year").notNull(),
  // "annual" | "mid_year" | "probation" | "project"
  appraisalType: varchar("appraisal_type", { length: 30 }).notNull().default("annual"),
  selfAppraisalDeadline: varchar("self_appraisal_deadline", { length: 10 }),
  managerAppraisalDeadline: varchar("manager_appraisal_deadline", { length: 10 }),
  calibrationDeadline: varchar("calibration_deadline", { length: 10 }),
  // "draft" | "self_appraisal" | "manager_appraisal" | "calibration" | "results_shared" | "closed"
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  goalsWeight: integer("goals_weight").notNull().default(60),        // % weight
  competenciesWeight: integer("competencies_weight").notNull().default(40),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const appraisalRecordsTable = pgTable("appraisal_records", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  reviewerEmployeeId: integer("reviewer_employee_id"),
  // Self-assessment scores
  selfGoalsScore: numeric("self_goals_score", { precision: 4, scale: 2 }),
  selfCompetencyScore: numeric("self_competency_score", { precision: 4, scale: 2 }),
  selfOverallScore: numeric("self_overall_score", { precision: 4, scale: 2 }),
  selfStrengths: text("self_strengths"),
  selfDevelopmentAreas: text("self_development_areas"),
  selfSubmittedAt: timestamp("self_submitted_at"),
  // Manager assessment
  managerGoalsScore: numeric("manager_goals_score", { precision: 4, scale: 2 }),
  managerCompetencyScore: numeric("manager_competency_score", { precision: 4, scale: 2 }),
  managerOverallScore: numeric("manager_overall_score", { precision: 4, scale: 2 }),
  managerComments: text("manager_comments"),
  managerStrengths: text("manager_strengths"),
  managerDevelopmentAreas: text("manager_development_areas"),
  managerSubmittedAt: timestamp("manager_submitted_at"),
  // Calibrated final
  calibratedScore: numeric("calibrated_score", { precision: 4, scale: 2 }),
  calibrationNotes: text("calibration_notes"),
  calibratedAt: timestamp("calibrated_at"),
  calibratedByUserId: integer("calibrated_by_user_id"),
  // "A" | "B+" | "B" | "C" | "D" — final rating label
  finalRating: varchar("final_rating", { length: 10 }),
  // "not_started" | "self_submitted" | "manager_submitted" | "calibrated" | "shared" | "acknowledged"
  status: varchar("status", { length: 30 }).notNull().default("not_started"),
  sharedWithEmployeeAt: timestamp("shared_with_employee_at"),
  employeeAcknowledgedAt: timestamp("employee_acknowledged_at"),
  employeeResponse: text("employee_response"),
  // Promotion recommendation
  promotionRecommended: boolean("promotion_recommended").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Per-competency rating within an appraisal
export const appraisalCompetencyRatingsTable = pgTable("appraisal_competency_ratings", {
  id: serial("id").primaryKey(),
  appraisalId: integer("appraisal_id").notNull(),
  competencyId: integer("competency_id").notNull(),
  // "self" | "manager" | "calibrated"
  raterType: varchar("rater_type", { length: 20 }).notNull().default("manager"),
  score: integer("score").notNull(),   // 1-5
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Calibration session
export const calibrationSessionsTable = pgTable("calibration_sessions", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  departmentId: integer("department_id"),
  sessionDate: timestamp("session_date"),
  // "scheduled" | "in_progress" | "completed"
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  facilitatorUserId: integer("facilitator_user_id"),
  attendeesJson: text("attendees_json"),  // JSON array of employee IDs
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AppraisalCycle = typeof appraisalCyclesTable.$inferSelect;
export type AppraisalRecord = typeof appraisalRecordsTable.$inferSelect;
export type AppraisalCompetencyRating = typeof appraisalCompetencyRatingsTable.$inferSelect;
export type CalibrationSession = typeof calibrationSessionsTable.$inferSelect;
