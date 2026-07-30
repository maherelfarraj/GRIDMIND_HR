import {
  pgTable, serial, varchar, integer, boolean, text,
  timestamp, numeric,
} from "drizzle-orm/pg-core";

/**
 * Data import jobs — each represents one file upload / import attempt.
 * Types: employees | salary_grades | pay_components | leave_balances
 *        | public_holidays | org_structure | attendance_history | payroll_history
 */
export const dataImportJobsTable = pgTable("data_import_jobs", {
  id: serial("id").primaryKey(),
  // Type of data being imported
  importType: varchar("import_type", { length: 40 }).notNull(),
  // "pending" | "validating" | "preview" | "importing" | "complete" | "failed" | "rolled_back"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  originalFilename: varchar("original_filename", { length: 255 }),
  // "csv" | "xlsx" | "json"
  fileFormat: varchar("file_format", { length: 10 }).notNull().default("csv"),
  // Column mapping JSON: { sourceCol: targetField, ... }
  columnMappingJson: text("column_mapping_json"),
  // Mapping template name saved for reuse
  mappingTemplateName: varchar("mapping_template_name", { length: 100 }),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  rolledBackRows: integer("rolled_back_rows").notNull().default(0),
  // Whether preview (dry-run) was confirmed before actual import
  previewConfirmed: boolean("preview_confirmed").notNull().default(false),
  previewConfirmedAt: timestamp("preview_confirmed_at"),
  // Whether the import can be rolled back (true until a dependent record is created)
  isRollbackable: boolean("is_rollbackable").notNull().default(true),
  rolledBackAt: timestamp("rolled_back_at"),
  rolledBackByUserId: integer("rolled_back_by_user_id"),
  errorSummary: text("error_summary"),
  importedByUserId: integer("imported_by_user_id"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DataImportJob = typeof dataImportJobsTable.$inferSelect;

/** Individual rows from an import job, with per-row validation results. */
export const dataImportRowsTable = pgTable("data_import_rows", {
  id: serial("id").primaryKey(),
  importJobId: integer("import_job_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  // "valid" | "error" | "duplicate" | "imported" | "skipped" | "rolled_back"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  rawDataJson: text("raw_data_json"),
  mappedDataJson: text("mapped_data_json"),
  // Validation errors as JSON array of { field, message }
  errorsJson: text("errors_json"),
  // ID of the entity created (for rollback)
  createdEntityId: integer("created_entity_id"),
  createdEntityType: varchar("created_entity_type", { length: 40 }),
  isDuplicate: boolean("is_duplicate").notNull().default(false),
  duplicateOfId: integer("duplicate_of_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DataImportRow = typeof dataImportRowsTable.$inferSelect;

/** Saved column-mapping templates for reuse across imports of the same type. */
export const importMappingTemplatesTable = pgTable("import_mapping_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  importType: varchar("import_type", { length: 40 }).notNull(),
  columnMappingJson: text("column_mapping_json").notNull(),
  createdByUserId: integer("created_by_user_id"),
  isDefault: boolean("is_default").notNull().default(false),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ImportMappingTemplate = typeof importMappingTemplatesTable.$inferSelect;
