import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// ─── Reporting Engine — Phase 6 ──────────────────────────────────────────────

// Saved report definition with parameters and access control.
export const reportDefinitionsTable = pgTable("report_definitions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 300 }).notNull(),
  nameAr: varchar("name_ar", { length: 300 }).notNull(),
  descriptionEn: text("description_en"),
  // "workforce" | "attendance" | "leave" | "payroll" | "recruitment" | "training" |
  // "performance" | "security_events" | "compliance" | "succession" | "custom"
  reportType: varchar("report_type", { length: 30 }).notNull(),
  // "tabular" | "summary" | "dashboard" | "chart" | "matrix"
  outputFormat: varchar("output_format", { length: 20 }).notNull().default("tabular"),
  // JSON spec: { columns: [...], filters: [...], groupBy: [...], sortBy: [...] }
  querySpecJson: text("query_spec_json").notNull(),
  // Default filter values as JSON
  defaultFiltersJson: text("default_filters_json"),
  // Roles allowed to run this report (comma-separated)
  allowedRoles: varchar("allowed_roles", { length: 500 }).notNull().default("hr,admin"),
  // Fields to mask for non-privileged users (comma-separated field names)
  maskedFieldsJson: text("masked_fields_json"),
  // "pdf" | "excel" | "csv" | "both"
  supportedExports: varchar("supported_exports", { length: 30 }).notNull().default("both"),
  supportsArabic: boolean("supports_arabic").notNull().default(true),
  supportsEnglish: boolean("supports_english").notNull().default(true),
  isSystemReport: boolean("is_system_report").notNull().default(false),  // Cannot be deleted
  isActive: boolean("is_active").notNull().default(true),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Saved filter set per user per report.
export const savedReportFiltersTable = pgTable("saved_report_filters", {
  id: serial("id").primaryKey(),
  reportDefinitionId: integer("report_definition_id").notNull(),
  userId: integer("user_id").notNull(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  filtersJson: text("filters_json").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isShared: boolean("is_shared").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Scheduled report generation (local — no cloud dependency).
export const reportSchedulesTable = pgTable("report_schedules", {
  id: serial("id").primaryKey(),
  reportDefinitionId: integer("report_definition_id").notNull(),
  savedFilterId: integer("saved_filter_id"),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  // "daily" | "weekly" | "monthly" | "quarterly" | "manual"
  frequency: varchar("frequency", { length: 20 }).notNull().default("monthly"),
  // Cron-style day spec: day of month (1-31 or "last"), day of week (0-6)
  dayOfMonth: integer("day_of_month"),
  dayOfWeek: integer("day_of_week"),
  timeOfDay: varchar("time_of_day", { length: 8 }).notNull().default("06:00"),
  // "pdf" | "excel" | "csv"
  exportFormat: varchar("export_format", { length: 10 }).notNull().default("pdf"),
  // "en" | "ar" | "both"
  language: varchar("language", { length: 4 }).notNull().default("en"),
  // Delivery: save to local path
  outputPath: varchar("output_path", { length: 500 }),
  // Notify these user IDs when ready (JSON array)
  notifyUserIdsJson: text("notify_user_ids_json"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastRunStatus: varchar("last_run_status", { length: 20 }),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Generated report output record.
export const reportOutputsTable = pgTable("report_outputs", {
  id: serial("id").primaryKey(),
  reportDefinitionId: integer("report_definition_id").notNull(),
  scheduleId: integer("schedule_id"),
  generatedByUserId: integer("generated_by_user_id"),
  parametersJson: text("parameters_json"),
  filtersJson: text("filters_json"),
  // "pdf" | "excel" | "csv"
  outputFormat: varchar("output_format", { length: 10 }).notNull(),
  language: varchar("language", { length: 4 }).notNull().default("en"),
  storagePath: varchar("storage_path", { length: 1000 }),
  fileName: varchar("file_name", { length: 500 }),
  fileSizeBytes: integer("file_size_bytes"),
  rowCount: integer("row_count"),
  // "pending" | "generating" | "ready" | "failed" | "expired"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  generationStartedAt: timestamp("generation_started_at"),
  generationCompletedAt: timestamp("generation_completed_at"),
  errorMessage: text("error_message"),
  expiresAt: timestamp("expires_at"),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReportDefinition = typeof reportDefinitionsTable.$inferSelect;
export type SavedReportFilter = typeof savedReportFiltersTable.$inferSelect;
export type ReportSchedule = typeof reportSchedulesTable.$inferSelect;
export type ReportOutput = typeof reportOutputsTable.$inferSelect;
