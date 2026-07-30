import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Succession planning: talent pools, candidate readiness, and individual development plans.

export const successionPoolsTable = pgTable("succession_pools", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // Target position / job family this pool feeds
  targetJobTitleEn: varchar("target_job_title_en", { length: 200 }),
  targetGradeCode: varchar("target_grade_code", { length: 20 }),
  targetRankCode: varchar("target_rank_code", { length: 20 }),
  // "critical_role" | "leadership" | "technical_expert" | "general"
  poolType: varchar("pool_type", { length: 30 }).notNull().default("leadership"),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  ownedByEmployeeId: integer("owned_by_employee_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const successionCandidatesTable = pgTable("succession_candidates", {
  id: serial("id").primaryKey(),
  poolId: integer("pool_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  // "ready_now" | "ready_1_year" | "ready_2_years" | "ready_3_plus"
  readinessLevel: varchar("readiness_level", { length: 30 }).notNull().default("ready_2_years"),
  // 1-5 talent score (combines performance, potential, leadership)
  talentScore: integer("talent_score").notNull().default(3),
  performanceRating: varchar("performance_rating", { length: 10 }),  // from last appraisal
  // "high" | "medium" | "low"
  flightRisk: varchar("flight_risk", { length: 10 }).notNull().default("low"),
  // "high" | "medium" | "low"
  impactIfLost: varchar("impact_if_lost", { length: 10 }).notNull().default("medium"),
  // "stay" | "grow" | "move" | "exit"
  futureIntent: varchar("future_intent", { length: 20 }).notNull().default("grow"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedByUserId: integer("added_by_user_id"),
  lastReviewedAt: timestamp("last_reviewed_at"),
  reviewNotes: text("review_notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const developmentPlansTable = pgTable("development_plans", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  cycleId: integer("cycle_id"),           // link to goal/appraisal cycle
  successionCandidateId: integer("succession_candidate_id"),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }),
  // Competency gaps this plan addresses (comma-separated competency IDs)
  targetCompetencies: varchar("target_competencies", { length: 500 }),
  // "draft" | "active" | "completed" | "on_hold"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  completionPct: integer("completion_pct").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const developmentActivitiesTable = pgTable("development_activities", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  // "training" | "mentoring" | "coaching" | "stretch_assignment" | "shadowing" | "certification" | "reading"
  activityType: varchar("activity_type", { length: 30 }).notNull().default("training"),
  targetCompetencyId: integer("target_competency_id"),
  courseId: integer("course_id"),
  dueDate: varchar("due_date", { length: 10 }),
  // "pending" | "in_progress" | "completed" | "cancelled"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  completedAt: timestamp("completed_at"),
  completionNotes: text("completion_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SuccessionPool = typeof successionPoolsTable.$inferSelect;
export type SuccessionCandidate = typeof successionCandidatesTable.$inferSelect;
export type DevelopmentPlan = typeof developmentPlansTable.$inferSelect;
export type DevelopmentActivity = typeof developmentActivitiesTable.$inferSelect;
