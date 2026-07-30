import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

export const reportBuilderConfigsTable = pgTable("report_builder_configs", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  descriptionEn: text("description_en"),
  createdByUserId: integer("created_by_user_id"),
  dataSource: varchar("data_source", { length: 80 }).notNull().default("employees"),
  columnsJson: text("columns_json").notNull().default("[]"),
  filtersJson: text("filters_json"),
  sortByJson: text("sort_by_json"),
  groupByJson: text("group_by_json"),
  roleRestriction: varchar("role_restriction", { length: 50 }),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const exportJobsTable = pgTable("export_jobs", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 30 }).notNull().default("xlsx"),
  entityType: varchar("entity_type", { length: 60 }).notNull(),
  entityId: integer("entity_id"),
  requestedByUserId: integer("requested_by_user_id"),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  parametersJson: text("parameters_json"),
  outputPath: varchar("output_path", { length: 255 }),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduledExportsTable = pgTable("scheduled_exports", {
  id: serial("id").primaryKey(),
  reportBuilderConfigId: integer("report_builder_config_id").references(() => reportBuilderConfigsTable.id),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  cronExpression: varchar("cron_expression", { length: 60 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Asia/Riyadh"),
  format: varchar("format", { length: 10 }).notNull().default("xlsx"),
  recipientUserIds: text("recipient_user_ids"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ReportBuilderConfig = typeof reportBuilderConfigsTable.$inferSelect;
export type ExportJob = typeof exportJobsTable.$inferSelect;
export type ScheduledExport = typeof scheduledExportsTable.$inferSelect;
