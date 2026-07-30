import {
  pgTable, serial, varchar, boolean, text, timestamp,
  integer, numeric,
} from "drizzle-orm/pg-core";

/**
 * System health check results — one row per check per run.
 * Categories: database | storage | memory | network | auth | backup
 *             | license | api | config | security
 */
export const systemHealthChecksTable = pgTable("system_health_checks", {
  id: serial("id").primaryKey(),
  checkName: varchar("check_name", { length: 80 }).notNull(),
  checkCategory: varchar("check_category", { length: 30 }).notNull().default("system"),
  // "pass" | "warn" | "fail" | "skipped"
  result: varchar("result", { length: 10 }).notNull().default("skipped"),
  message: text("message"),
  // Measured value (e.g. disk usage percent, response ms)
  metricValue: numeric("metric_value", { precision: 14, scale: 4 }),
  metricUnit: varchar("metric_unit", { length: 20 }),
  // Threshold that triggered warn/fail
  thresholdWarn: numeric("threshold_warn", { precision: 14, scale: 4 }),
  thresholdFail: numeric("threshold_fail", { precision: 14, scale: 4 }),
  durationMs: integer("duration_ms"),
  isCritical: boolean("is_critical").notNull().default(false),
  // Group multiple checks into one "run"
  runId: varchar("run_id", { length: 64 }),
  runAt: timestamp("run_at").defaultNow().notNull(),
  triggeredByUserId: integer("triggered_by_user_id"),
});

export type SystemHealthCheck = typeof systemHealthChecksTable.$inferSelect;

/**
 * Environment readiness checks — distinct from health checks.
 * Checks prerequisites before go-live: filesystem perms, DB connectivity,
 * SMTP config, LDAP config, disk space, backup dir writable, etc.
 */
export const environmentReadinessChecksTable = pgTable("environment_readiness_checks", {
  id: serial("id").primaryKey(),
  checkName: varchar("check_name", { length: 80 }).notNull(),
  checkCategory: varchar("check_category", { length: 30 }).notNull(),
  // "pass" | "warn" | "fail" | "pending"
  result: varchar("result", { length: 10 }).notNull().default("pending"),
  message: text("message"),
  remediationHint: text("remediation_hint"),
  isMandatory: boolean("is_mandatory").notNull().default(true),
  // Whether this check was manually overridden by an admin
  isOverridden: boolean("is_overridden").notNull().default(false),
  overriddenByUserId: integer("overridden_by_user_id"),
  overrideReason: text("override_reason"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EnvironmentReadinessCheck = typeof environmentReadinessChecksTable.$inferSelect;

/**
 * Signed software update packages.
 * Stores metadata and verification status for each update received.
 * Actual install is triggered manually by an admin.
 */
export const softwareUpdatePackagesTable = pgTable("software_update_packages", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 30 }).notNull(),
  buildNumber: varchar("build_number", { length: 20 }),
  releaseChannel: varchar("release_channel", { length: 20 }).notNull().default("stable"),
  // "pending_verification" | "verified" | "invalid_signature" | "installed" | "superseded"
  status: varchar("status", { length: 30 }).notNull().default("pending_verification"),
  packageFilename: varchar("package_filename", { length: 255 }),
  fileSizeBytes: integer("file_size_bytes"),
  checksum: varchar("checksum", { length: 128 }),
  signatureValid: boolean("signature_valid"),
  signatureVerifiedAt: timestamp("signature_verified_at"),
  // Signed manifest as JSON (modules, changelog, min requirements)
  manifestJson: text("manifest_json"),
  releaseNotesEn: text("release_notes_en"),
  releaseNotesAr: text("release_notes_ar"),
  installedAt: timestamp("installed_at"),
  installedByUserId: integer("installed_by_user_id"),
  rollbackPackageId: integer("rollback_package_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SoftwareUpdatePackage = typeof softwareUpdatePackagesTable.$inferSelect;

/**
 * Deployment status dashboard entries.
 * A curated list of go-live readiness items with current pass/fail status.
 */
export const deploymentChecklistItemsTable = pgTable("deployment_checklist_items", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 40 }).notNull(),
  itemCode: varchar("item_code", { length: 60 }).notNull().unique(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleAr: varchar("title_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  // "pass" | "fail" | "warn" | "pending" | "na" | "override"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // "required" | "recommended" | "optional"
  priority: varchar("priority", { length: 15 }).notNull().default("required"),
  // "prototype" | "production" — labels items that are simulated in demo mode
  implementationLevel: varchar("implementation_level", { length: 15 }).notNull().default("production"),
  statusNotes: text("status_notes"),
  lastCheckedAt: timestamp("last_checked_at"),
  checkedByUserId: integer("checked_by_user_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DeploymentChecklistItem = typeof deploymentChecklistItemsTable.$inferSelect;
