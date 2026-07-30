import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Policy locale configuration per organization.
 * Controls currency, timezone, calendar type, date format, and number format.
 */
export const policyLocalesTable = pgTable("policy_locales", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().unique(),
  // "en" | "ar" | "both"
  defaultLanguage: varchar("default_language", { length: 5 }).notNull().default("ar"),
  // IANA timezone, e.g. "Asia/Riyadh"
  timezone: varchar("timezone", { length: 60 }).notNull().default("Asia/Riyadh"),
  // "gregorian" | "hijri" | "umm_al_qura" | "persian" | "coptic"
  calendarType: varchar("calendar_type", { length: 20 }).notNull().default("gregorian"),
  // Whether to show hijri dates alongside Gregorian
  showHijriDates: boolean("show_hijri_dates").notNull().default(false),
  // ISO 4217 currency code
  currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR"),
  currencySymbolEn: varchar("currency_symbol_en", { length: 10 }).default("SAR"),
  currencySymbolAr: varchar("currency_symbol_ar", { length: 10 }).default("ر.س"),
  // "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd"
  dateFormat: varchar("date_format", { length: 20 }).notNull().default("dd/MM/yyyy"),
  // "HH:mm" | "hh:mm a"
  timeFormat: varchar("time_format", { length: 10 }).notNull().default("HH:mm"),
  // "arabic_indic" | "western_arabic"
  numeralStyle: varchar("numeral_style", { length: 20 }).notNull().default("western_arabic"),
  // Country-specific number formatting
  thousandsSeparator: varchar("thousands_separator", { length: 5 }).default(","),
  decimalSeparator: varchar("decimal_separator", { length: 5 }).default("."),
  updatedByUserId: integer("updated_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PolicyLocale = typeof policyLocalesTable.$inferSelect;

/**
 * Numbering schemes — configurable auto-number formats per org per entity type.
 * e.g. employee numbers: "EMP-{YYYY}-{NNNN}", purchase orders, leave requests, etc.
 */
export const numberingSchemesTable = pgTable("numbering_schemes", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  // "employee" | "leave_request" | "payroll_period" | "import_job" | "contract" | "appraisal"
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  // Template string: {PREFIX}-{YYYY}-{MM}-{NNNN} etc.
  template: varchar("template", { length: 100 }).notNull(),
  prefix: varchar("prefix", { length: 20 }),
  suffix: varchar("suffix", { length: 20 }),
  // Current sequence counter
  currentSequence: integer("current_sequence").notNull().default(0),
  // Min padding digits for sequential number
  sequencePadding: integer("sequence_padding").notNull().default(4),
  // "per_year" | "per_month" | "global"
  resetCycle: varchar("reset_cycle", { length: 15 }).notNull().default("per_year"),
  lastResetAt: timestamp("last_reset_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NumberingScheme = typeof numberingSchemesTable.$inferSelect;

/**
 * Employment type configurations per organization.
 * Extends the built-in employee.employmentType with org-specific rules.
 */
export const employmentTypeConfigsTable = pgTable("employment_type_configs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  // Mirrors employee.employmentType values
  employmentType: varchar("employment_type", { length: 30 }).notNull(),
  labelEn: varchar("label_en", { length: 100 }).notNull(),
  labelAr: varchar("label_ar", { length: 100 }).notNull(),
  // Whether this type is eligible for each benefit class
  eligibleLeave: boolean("eligible_leave").notNull().default(true),
  eligiblePayroll: boolean("eligible_payroll").notNull().default(true),
  eligibleBenefits: boolean("eligible_benefits").notNull().default(true),
  eligiblePension: boolean("eligible_pension").notNull().default(false),
  // Whether probation applies
  probationEnabled: boolean("probation_enabled").notNull().default(true),
  probationDays: integer("probation_days").notNull().default(90),
  // Contract duration rules: null = indefinite, >0 = months
  defaultContractMonths: integer("default_contract_months"),
  maxRenewals: integer("max_renewals"),
  // Applicable org types (JSON array of orgType values)
  applicableOrgTypesJson: text("applicable_org_types_json").notNull().default('["company"]'),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmploymentTypeConfig = typeof employmentTypeConfigsTable.$inferSelect;

/**
 * Calendar configurations — org-specific work-calendar rules.
 * Separate from publicHolidaysTable (which stores specific dates).
 * Stores the base working-day and working-hour rules.
 */
export const calendarConfigsTable = pgTable("calendar_configs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().unique(),
  // JSON array of ISO day numbers: 0=Sun…6=Sat (e.g. [4, 5] = Thu/Fri weekend)
  weekendDaysJson: text("weekend_days_json").notNull().default("[4,5]"),
  // Default standard hours per working day
  standardHoursPerDay: integer("standard_hours_per_day").notNull().default(8),
  // Default start/end times in "HH:MM" format
  defaultShiftStart: varchar("default_shift_start", { length: 5 }).default("08:00"),
  defaultShiftEnd: varchar("default_shift_end", { length: 5 }).default("16:00"),
  // Whether to use separate summer schedule (gov/military)
  hasSummerSchedule: boolean("has_summer_schedule").notNull().default(false),
  summerMonthsJson: text("summer_months_json"),
  summerHoursPerDay: integer("summer_hours_per_day"),
  summerShiftStart: varchar("summer_shift_start", { length: 5 }),
  summerShiftEnd: varchar("summer_shift_end", { length: 5 }),
  updatedByUserId: integer("updated_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CalendarConfig = typeof calendarConfigsTable.$inferSelect;

/**
 * Data retention rules per organization per data category.
 * Governs how long records are kept before archival/deletion.
 */
export const retentionRulesTable = pgTable("retention_rules", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  // "employee_records" | "payroll_runs" | "attendance_logs" | "audit_logs" | "leave_requests"
  //  | "documents" | "appraisals" | "security_clearances" | "health_data"
  dataCategory: varchar("data_category", { length: 50 }).notNull(),
  labelEn: varchar("label_en", { length: 150 }).notNull(),
  labelAr: varchar("label_ar", { length: 150 }).notNull(),
  // Retention period in months (0 = indefinite)
  retentionMonths: integer("retention_months").notNull().default(0),
  // "archive" | "delete" | "anonymize"
  expiryAction: varchar("expiry_action", { length: 20 }).notNull().default("archive"),
  // Legal basis for retention (GDPR/NDMO)
  legalBasisEn: text("legal_basis_en"),
  legalBasisAr: text("legal_basis_ar"),
  requiresApprovalToDelete: boolean("requires_approval_to_delete").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RetentionRule = typeof retentionRulesTable.$inferSelect;
