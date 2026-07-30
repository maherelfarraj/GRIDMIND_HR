import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// ─── Document Management — Phase 6 ───────────────────────────────────────────

// Configurable category with retention and access rules.
export const documentCategoriesTable = pgTable("document_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // "personal" | "contract" | "compliance" | "medical" | "disciplinary" | "training" | "financial" | "government" | "classified"
  categoryType: varchar("category_type", { length: 30 }).notNull().default("personal"),
  // "public" | "internal" | "confidential" | "secret" | "top_secret"
  defaultClassification: varchar("default_classification", { length: 20 }).notNull().default("internal"),
  retentionYears: integer("retention_years").notNull().default(7),
  // "delete" | "archive" | "review" | "legal_hold"
  retentionAction: varchar("retention_action", { length: 20 }).notNull().default("archive"),
  allowDownload: boolean("allow_download").notNull().default(true),
  allowPrint: boolean("allow_print").notNull().default(true),
  requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
  watermarkOnDownload: boolean("watermark_on_download").notNull().default(false),
  watermarkText: varchar("watermark_text", { length: 200 }),
  requiresExpiryDate: boolean("requires_expiry_date").notNull().default(false),
  // Roles that can upload (comma-separated)
  uploadRoles: varchar("upload_roles", { length: 500 }).notNull().default("hr,admin"),
  // Roles that can view (comma-separated; "all" for all)
  viewRoles: varchar("view_roles", { length: 500 }).notNull().default("hr,admin"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Versioned document record — replaces the basic documentsTable for enterprise use.
export const enterpriseDocumentsTable = pgTable("enterprise_documents", {
  id: serial("id").primaryKey(),
  documentNumber: varchar("document_number", { length: 40 }).notNull().unique(),
  categoryId: integer("category_id").notNull(),
  // Owner — may be employee, org unit, or system-level
  employeeId: integer("employee_id"),
  orgUnitId: integer("org_unit_id"),
  // "employee_record" | "org_policy" | "template" | "report" | "contract" | "certificate" | "other"
  scope: varchar("scope", { length: 30 }).notNull().default("employee_record"),
  titleEn: varchar("title_en", { length: 400 }).notNull(),
  titleAr: varchar("title_ar", { length: 400 }),
  descriptionEn: text("description_en"),
  // "public" | "internal" | "confidential" | "secret" | "top_secret"
  classificationLevel: varchar("classification_level", { length: 20 }).notNull().default("internal"),
  currentVersionId: integer("current_version_id"),  // FK to document_versions (set after insert)
  currentVersionNumber: varchar("current_version_number", { length: 10 }).notNull().default("1.0"),
  // "draft" | "active" | "superseded" | "expired" | "archived" | "legal_hold"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  issuedAt: varchar("issued_at", { length: 10 }),
  expiresAt: varchar("expires_at", { length: 10 }),
  expiryAlertSentAt: timestamp("expiry_alert_sent_at"),
  // Legal hold
  isOnLegalHold: boolean("is_on_legal_hold").notNull().default(false),
  legalHoldReason: text("legal_hold_reason"),
  legalHoldPlacedAt: timestamp("legal_hold_placed_at"),
  legalHoldPlacedByUserId: integer("legal_hold_placed_by_user_id"),
  // Permissions override (null = use category defaults)
  allowDownloadOverride: boolean("allow_download_override"),
  allowPrintOverride: boolean("allow_print_override"),
  watermarkOverride: varchar("watermark_override", { length: 200 }),
  // Retention
  retentionExpiresAt: varchar("retention_expires_at", { length: 10 }),
  // Acknowledgement
  requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
  acknowledgedCount: integer("acknowledged_count").notNull().default(0),
  // Tagging
  tagsJson: text("tags_json"),  // JSON array of string tags
  uploadedByUserId: integer("uploaded_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Version history for a document.
export const documentVersionsTable = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  versionNumber: varchar("version_number", { length: 10 }).notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  // Stored path (local filesystem or object storage key)
  storagePath: varchar("storage_path", { length: 1000 }).notNull(),
  checksum: varchar("checksum", { length: 64 }),  // SHA-256
  uploadedByUserId: integer("uploaded_by_user_id"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  changeNotes: text("change_notes"),
  isCurrentVersion: boolean("is_current_version").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Immutable access log — every view, download, or print action.
export const documentAccessLogsTable = pgTable("document_access_logs", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  versionId: integer("version_id"),
  userId: integer("user_id").notNull(),
  employeeId: integer("employee_id"),
  // "view" | "download" | "print" | "share" | "upload" | "delete_attempt" | "legal_hold"
  action: varchar("action", { length: 30 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 500 }),
  wasWatermarked: boolean("was_watermarked").notNull().default(false),
  // "allowed" | "denied" | "warned"
  outcome: varchar("outcome", { length: 20 }).notNull().default("allowed"),
  denialReason: varchar("denial_reason", { length: 200 }),
  accessedAt: timestamp("accessed_at").defaultNow().notNull(),
});

// Employee acknowledgement of a document (policy, procedure, etc.).
export const documentAcknowledgementsTable = pgTable("document_acknowledgements", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  // "pending" | "acknowledged" | "declined"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  acknowledgedAt: timestamp("acknowledged_at"),
  declinedAt: timestamp("declined_at"),
  declineReason: text("decline_reason"),
  ipAddress: varchar("ip_address", { length: 45 }),
  deadlineDate: varchar("deadline_date", { length: 10 }),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Reusable document template (e.g. offer letter, certificate, employment letter).
export const documentTemplatesTable = pgTable("document_templates", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  // "offer_letter" | "employment_certificate" | "salary_certificate" | "experience_letter" | "noc" | "warning_letter" | "commendation" | "custom"
  templateType: varchar("template_type", { length: 40 }).notNull(),
  // HTML/Handlebars template body
  bodyHtml: text("body_html").notNull(),
  bodyHtmlAr: text("body_html_ar"),
  // Available merge fields (JSON array of field names)
  mergeFieldsJson: text("merge_fields_json"),
  headerImagePath: varchar("header_image_path", { length: 500 }),
  footerText: text("footer_text"),
  footerTextAr: text("footer_text_ar"),
  categoryId: integer("category_id"),
  isActive: boolean("is_active").notNull().default(true),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DocumentCategory = typeof documentCategoriesTable.$inferSelect;
export type EnterpriseDocument = typeof enterpriseDocumentsTable.$inferSelect;
export type DocumentVersion = typeof documentVersionsTable.$inferSelect;
export type DocumentAccessLog = typeof documentAccessLogsTable.$inferSelect;
export type DocumentAcknowledgement = typeof documentAcknowledgementsTable.$inferSelect;
export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;
