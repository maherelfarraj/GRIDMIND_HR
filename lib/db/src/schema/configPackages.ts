import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Configuration packages — signed bundles for offline transfer between environments.
 * Used to carry approved configuration changes from dev → staging → production
 * without internet connectivity (air-gap safe).
 *
 * Package lifecycle: draft → signed → exported → imported → applied | rejected
 */
export const configPackagesTable = pgTable("config_packages", {
  id: serial("id").primaryKey(),
  // Short human-readable name
  packageName: varchar("package_name", { length: 150 }).notNull(),
  // "full_org" | "policy_set" | "integration_profiles" | "branding" | "patch"
  packageType: varchar("package_type", { length: 30 }).notNull().default("policy_set"),
  // "draft" | "pending_sign" | "signed" | "exported" | "imported" | "applied" | "rejected"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // Semantic version string
  version: varchar("version", { length: 20 }).notNull(),
  // "development" | "staging" | "production"
  sourceEnvironment: varchar("source_environment", { length: 20 }).notNull().default("development"),
  targetEnvironment: varchar("target_environment", { length: 20 }).notNull().default("production"),
  // Org this package is for (null = system-wide)
  orgId: integer("org_id"),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  // List of policy areas included (JSON array)
  policyAreasJson: text("policy_areas_json").notNull().default("[]"),
  // The actual package content — JSON of all config items
  payloadJson: text("payload_json"),
  // SHA-256 of payloadJson
  payloadChecksum: varchar("payload_checksum", { length: 64 }),
  // Digital signature (HMAC-SHA256 using server's signing key)
  signature: text("signature"),
  signedAt: timestamp("signed_at"),
  signedByUserId: integer("signed_by_user_id"),
  exportedAt: timestamp("exported_at"),
  exportedByUserId: integer("exported_by_user_id"),
  importedAt: timestamp("imported_at"),
  importedByUserId: integer("imported_by_user_id"),
  appliedAt: timestamp("applied_at"),
  appliedByUserId: integer("applied_by_user_id"),
  rejectedAt: timestamp("rejected_at"),
  rejectedByUserId: integer("rejected_by_user_id"),
  rejectionReason: text("rejection_reason"),
  // Pre-apply impact analysis
  impactPreviewJson: text("impact_preview_json"),
  // Whether a policy change request (maker-checker) was used to produce this
  changeRequestId: integer("change_request_id"),
  isRollbackPackage: boolean("is_rollback_package").notNull().default(false),
  rollbackOfPackageId: integer("rollback_of_package_id"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ConfigPackage = typeof configPackagesTable.$inferSelect;

/**
 * Config package items — individual config entries within a package.
 * Provides granular visibility into exactly which records changed.
 */
export const configPackageItemsTable = pgTable("config_package_items", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  policyArea: varchar("policy_area", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: integer("entity_id"),
  entityLabel: varchar("entity_label", { length: 200 }),
  // "create" | "update" | "delete" | "no_change"
  changeType: varchar("change_type", { length: 15 }).notNull().default("update"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  // "pending" | "applied" | "skipped" | "error"
  applyStatus: varchar("apply_status", { length: 15 }).notNull().default("pending"),
  applyError: text("apply_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ConfigPackageItem = typeof configPackageItemsTable.$inferSelect;

/**
 * Environment snapshots — point-in-time captures of the full configuration state.
 * Used for comparison between environments (dev vs staging vs production).
 */
export const environmentSnapshotsTable = pgTable("environment_snapshots", {
  id: serial("id").primaryKey(),
  // "development" | "staging" | "production"
  environment: varchar("environment", { length: 20 }).notNull(),
  orgId: integer("org_id"),
  snapshotName: varchar("snapshot_name", { length: 150 }).notNull(),
  // Scope of what was captured
  // "full" | "policy_only" | "integrations_only" | "branding_only"
  scope: varchar("scope", { length: 30 }).notNull().default("full"),
  // Full JSON snapshot of all captured config areas
  snapshotJson: text("snapshot_json"),
  // SHA-256 of snapshotJson
  checksum: varchar("checksum", { length: 64 }),
  itemCount: integer("item_count").notNull().default(0),
  capturedByUserId: integer("captured_by_user_id"),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  // Whether this snapshot is currently "pinned" (protected from auto-cleanup)
  isPinned: boolean("is_pinned").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EnvironmentSnapshot = typeof environmentSnapshotsTable.$inferSelect;

/**
 * Per-org report templates — configurable report definitions with org branding.
 * Extends the existing reportDefinitionsTable with org-scoped templates
 * that carry the org's logo, headers/footers, and locale settings.
 */
export const orgReportTemplatesTable = pgTable("org_report_templates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  // "payslip" | "leave_summary" | "attendance_summary" | "headcount" | "appraisal_summary"
  //  | "org_chart" | "security_clearance_roster" | "payroll_summary" | "custom"
  templateType: varchar("template_type", { length: 40 }).notNull(),
  nameEn: varchar("name_en", { length: 150 }).notNull(),
  nameAr: varchar("name_ar", { length: 150 }).notNull(),
  // "portrait" | "landscape"
  paperOrientation: varchar("paper_orientation", { length: 15 }).notNull().default("portrait"),
  // "A4" | "A3" | "Letter"
  paperSize: varchar("paper_size", { length: 10 }).notNull().default("A4"),
  // Whether to include org logo in header
  includeOrgLogo: boolean("include_org_logo").notNull().default(true),
  // Whether to include org branding colors
  includeBranding: boolean("include_branding").notNull().default(true),
  // Custom header/footer HTML (sanitized)
  headerHtmlEn: text("header_html_en"),
  headerHtmlAr: text("header_html_ar"),
  footerHtmlEn: text("footer_html_en"),
  footerHtmlAr: text("footer_html_ar"),
  // Columns/fields to include (JSON array of field names)
  columnsJson: text("columns_json"),
  // Grouping and sorting config JSON
  groupingJson: text("grouping_json"),
  // Filter defaults JSON
  defaultFiltersJson: text("default_filters_json"),
  // "json" | "csv" | "pdf" | "xlsx"
  defaultExportFormat: varchar("default_export_format", { length: 10 }).notNull().default("pdf"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OrgReportTemplate = typeof orgReportTemplatesTable.$inferSelect;
