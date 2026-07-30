import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// ─── Deployment Operations & Health — Phase 6 ────────────────────────────────

// Environment health check results.
export const healthChecksTable = pgTable("health_checks", {
  id: serial("id").primaryKey(),
  // "database" | "storage" | "api" | "auth" | "backup" | "disk" | "memory" | "license" | "sync"
  checkType: varchar("check_type", { length: 30 }).notNull(),
  checkName: varchar("check_name", { length: 200 }).notNull(),
  // "pass" | "warn" | "fail" | "unknown"
  status: varchar("status", { length: 20 }).notNull().default("unknown"),
  message: text("message"),
  details: text("details"),  // JSON with check-specific metrics
  responseTimeMs: integer("response_time_ms"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  // "manual" | "scheduled" | "startup" | "api"
  triggeredBy: varchar("triggered_by", { length: 20 }).notNull().default("manual"),
});

// Signed software update package tracking.
export const updatePackagesTable = pgTable("update_packages", {
  id: serial("id").primaryKey(),
  packageVersion: varchar("package_version", { length: 30 }).notNull(),
  packageName: varchar("package_name", { length: 200 }).notNull(),
  releaseNotes: text("release_notes"),
  releaseNotesAr: text("release_notes_ar"),
  storagePath: varchar("storage_path", { length: 1000 }),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  signatureB64: varchar("signature_b64", { length: 2000 }),
  signedByKeyId: varchar("signed_by_key_id", { length: 100 }),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  fileSizeBytes: integer("file_size_bytes"),
  isCritical: boolean("is_critical").notNull().default(false),
  requiresRestart: boolean("requires_restart").notNull().default(true),
  minCompatibleVersion: varchar("min_compatible_version", { length: 30 }),
  // "available" | "downloaded" | "verified" | "installing" | "installed" | "failed" | "rolled_back"
  status: varchar("status", { length: 20 }).notNull().default("available"),
  installedAt: timestamp("installed_at"),
  installedByUserId: integer("installed_by_user_id"),
  rollbackVersion: varchar("rollback_version", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Deployment lifecycle events — immutable audit trail.
export const deploymentEventsTable = pgTable("deployment_events", {
  id: serial("id").primaryKey(),
  // "install" | "update" | "rollback" | "backup" | "restore" | "health_check" | "config_change" | "license_update" | "migration"
  eventType: varchar("event_type", { length: 30 }).notNull(),
  description: text("description").notNull(),
  performedByUserId: integer("performed_by_user_id"),
  performedBySystem: boolean("performed_by_system").notNull().default(false),
  // "success" | "failure" | "partial" | "in_progress"
  outcome: varchar("outcome", { length: 20 }).notNull().default("success"),
  detailsJson: text("details_json"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
});

// Installation readiness checklist results.
export const installationReadinessTable = pgTable("installation_readiness", {
  id: serial("id").primaryKey(),
  checkCategory: varchar("check_category", { length: 50 }).notNull(),
  checkItemEn: varchar("check_item_en", { length: 400 }).notNull(),
  checkItemAr: varchar("check_item_ar", { length: 400 }),
  // "pass" | "fail" | "warn" | "skipped" | "pending"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  resultMessage: text("result_message"),
  isMandatory: boolean("is_mandatory").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type HealthCheck = typeof healthChecksTable.$inferSelect;
export type UpdatePackage = typeof updatePackagesTable.$inferSelect;
export type DeploymentEvent = typeof deploymentEventsTable.$inferSelect;
export type InstallationReadiness = typeof installationReadinessTable.$inferSelect;
