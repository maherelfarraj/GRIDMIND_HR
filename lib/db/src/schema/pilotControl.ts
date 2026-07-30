import {
  pgTable, serial, varchar, boolean, text, timestamp, integer, numeric,
} from "drizzle-orm/pg-core";

/**
 * Go-live gates — the authoritative checklist of hard gates that must pass
 * before the system can be marked production-ready for a given org.
 * Gates are evaluated programmatically from real DB state where possible.
 */
export const goLiveGatesTable = pgTable("go_live_gates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  gateCode: varchar("gate_code", { length: 60 }).notNull().unique(),
  // "auth" | "authorization" | "data_isolation" | "payroll" | "attendance"
  // | "leave" | "backup" | "licensing" | "security" | "ui" | "integration"
  // | "pilot_data" | "offline" | "approval_workflow"
  category: varchar("category", { length: 30 }).notNull(),
  titleEn: varchar("title_en", { length: 250 }).notNull(),
  titleAr: varchar("title_ar", { length: 250 }).notNull(),
  descriptionEn: text("description_en"),
  // "critical" | "major" | "minor" — critical = must pass before go-live
  severity: varchar("severity", { length: 10 }).notNull().default("critical"),
  // "pass" | "fail" | "warn" | "pending" | "blocked" | "na" | "override"
  status: varchar("status", { length: 10 }).notNull().default("pending"),
  // "automated" — evaluated from DB queries each time
  // "manual" — requires human sign-off
  // "hybrid" — automated check + human confirmation
  evaluationType: varchar("evaluation_type", { length: 15 }).notNull().default("manual"),
  // Evidence recorded when status is set (test run ID, snapshot ID, etc.)
  evidenceJson: text("evidence_json"),
  // Blocker description when status=fail/blocked
  blockerDescriptionEn: text("blocker_description_en"),
  blockerDescriptionAr: text("blocker_description_ar"),
  // Remediation guidance
  remediationEn: text("remediation_en"),
  remediationAr: text("remediation_ar"),
  // Who last evaluated this gate
  evaluatedByUserId: integer("evaluated_by_user_id"),
  lastEvaluatedAt: timestamp("last_evaluated_at"),
  // Whether an authorized override was applied despite failure
  isOverridden: boolean("is_overridden").notNull().default(false),
  overriddenByUserId: integer("overridden_by_user_id"),
  overrideReason: text("override_reason"),
  overriddenAt: timestamp("overridden_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type GoLiveGate = typeof goLiveGatesTable.$inferSelect;

/**
 * Readiness scorecards — per-module readiness summary rolled up from gates.
 * One row per module per org, updated whenever its gates are re-evaluated.
 */
export const readinessScorecardTable = pgTable("readiness_scorecard", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  module: varchar("module", { length: 40 }).notNull().unique(),
  moduleDisplayEn: varchar("module_display_en", { length: 100 }).notNull(),
  moduleDisplayAr: varchar("module_display_ar", { length: 100 }).notNull(),
  // "ready" | "partial" | "blocked" | "not_started" | "skipped"
  readinessStatus: varchar("readiness_status", { length: 15 }).notNull().default("not_started"),
  totalGates: integer("total_gates").notNull().default(0),
  passingGates: integer("passing_gates").notNull().default(0),
  failingGates: integer("failing_gates").notNull().default(0),
  overriddenGates: integer("overridden_gates").notNull().default(0),
  // 0–100 score
  readinessScore: numeric("readiness_score", { precision: 5, scale: 2 }).notNull().default("0"),
  // Role coverage: which UAT roles have completed their scripts for this module
  coveredRolesJson: text("covered_roles_json").notNull().default("[]"),
  lastRecalculatedAt: timestamp("last_recalculated_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ReadinessScorecard = typeof readinessScorecardTable.$inferSelect;

/**
 * Pilot defects — issues found during pilot testing, formally tracked.
 * Linked to go-live gates; critical-severity defects block go-live.
 */
export const pilotDefectsTable = pgTable("pilot_defects", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  defectCode: varchar("defect_code", { length: 20 }).notNull(),
  // "authentication" | "authorization" | "payroll" | "attendance" | "leave"
  // | "documents" | "ui_bilingual" | "integration" | "performance" | "data_integrity"
  // | "security" | "backup_restore" | "offline" | "reporting"
  module: varchar("module", { length: 30 }).notNull(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }),
  descriptionEn: text("description_en"),
  stepsToReproduce: text("steps_to_reproduce"),
  // "critical" | "high" | "medium" | "low"
  severity: varchar("severity", { length: 10 }).notNull().default("medium"),
  // "open" | "in_progress" | "resolved" | "verified" | "wont_fix" | "deferred"
  status: varchar("status", { length: 15 }).notNull().default("open"),
  // "blocker" — gates cannot pass until this is resolved
  isGoLiveBlocker: boolean("is_go_live_blocker").notNull().default(false),
  // Which gate this defect blocks
  relatedGateCode: varchar("related_gate_code", { length: 60 }),
  // Which UAT script or security test surfaced this
  sourceTestCode: varchar("source_test_code", { length: 40 }),
  assignedToUserId: integer("assigned_to_user_id"),
  reportedByUserId: integer("reported_by_user_id"),
  reportedAt: timestamp("reported_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id"),
  resolutionNotes: text("resolution_notes"),
  verifiedAt: timestamp("verified_at"),
  verifiedByUserId: integer("verified_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PilotDefect = typeof pilotDefectsTable.$inferSelect;

/**
 * Migration status tracker — tracks the completion of each data migration task
 * required before go-live (e.g. legacy employee data import, leave balance migration).
 */
export const migrationStatusTable = pgTable("migration_status", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  migrationCode: varchar("migration_code", { length: 60 }).notNull().unique(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleAr: varchar("title_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // "not_started" | "in_progress" | "complete" | "failed" | "skipped"
  status: varchar("status", { length: 15 }).notNull().default("not_started"),
  // "required" | "recommended" | "optional"
  priority: varchar("priority", { length: 15 }).notNull().default("required"),
  totalRecords: integer("total_records"),
  migratedRecords: integer("migrated_records").notNull().default(0),
  failedRecords: integer("failed_records").notNull().default(0),
  progressPercent: numeric("progress_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  runByUserId: integer("run_by_user_id"),
  errorSummary: text("error_summary"),
  sourceSystem: varchar("source_system", { length: 100 }),
  isGoLiveBlocker: boolean("is_go_live_blocker").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MigrationStatus = typeof migrationStatusTable.$inferSelect;

/**
 * Restore test results — records each backup restore test.
 * A successful recent restore test is required for the backup_restore gate to pass.
 */
export const restoreTestResultsTable = pgTable("restore_test_results", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  // References backup_records.id if linked to a specific backup
  backupRecordId: integer("backup_record_id"),
  // "full" | "partial" | "point_in_time"
  restoreType: varchar("restore_type", { length: 20 }).notNull().default("full"),
  // "pass" | "fail" | "partial"
  result: varchar("result", { length: 10 }).notNull(),
  // Time taken for restore in seconds
  restoreDurationSeconds: integer("restore_duration_seconds"),
  // Verification checks run after restore
  verificationChecksJson: text("verification_checks_json"),
  // Row counts verified post-restore (JSON: { employees: N, payrollRuns: N, ... })
  rowCountsJson: text("row_counts_json"),
  failureReason: text("failure_reason"),
  testedByUserId: integer("tested_by_user_id"),
  testedAt: timestamp("tested_at").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RestoreTestResult = typeof restoreTestResultsTable.$inferSelect;
