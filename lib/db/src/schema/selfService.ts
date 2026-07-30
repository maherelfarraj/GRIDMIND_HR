import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Employee self-service: general requests, announcements, and approval delegations.

export const employeeRequestsTable = pgTable("employee_requests", {
  id: serial("id").primaryKey(),
  requestNumber: varchar("request_number", { length: 30 }).notNull().unique(),
  employeeId: integer("employee_id").notNull(),
  // "salary_certificate" | "employment_letter" | "experience_letter" | "noc" |
  // "bank_letter" | "visa_support" | "address_proof" | "payslip_copy" | "other"
  requestType: varchar("request_type", { length: 40 }).notNull(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // Addressee / purpose details
  addressedTo: varchar("addressed_to", { length: 200 }),
  purposeEn: varchar("purpose_en", { length: 300 }),
  // "pending" | "in_review" | "approved" | "rejected" | "fulfilled" | "cancelled"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  fulfilledAt: timestamp("fulfilled_at"),
  generatedDocumentId: integer("generated_document_id"),
  urgency: varchar("urgency", { length: 20 }).notNull().default("normal"),  // "urgent" | "normal" | "low"
  requiredByDate: varchar("required_by_date", { length: 10 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }).notNull(),
  bodyEn: text("body_en").notNull(),
  bodyAr: text("body_ar"),
  // "general" | "policy" | "event" | "emergency" | "training" | "holiday" | "system"
  category: varchar("category", { length: 30 }).notNull().default("general"),
  // "all" | "department" | "org_unit" | "grade" | "employment_type"
  targetAudience: varchar("target_audience", { length: 30 }).notNull().default("all"),
  targetEntityId: integer("target_entity_id"),
  isPinned: boolean("is_pinned").notNull().default(false),
  publishedAt: timestamp("published_at"),
  expiresAt: timestamp("expires_at"),
  // "draft" | "published" | "expired" | "archived"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  authorUserId: integer("author_user_id").notNull(),
  viewCount: integer("view_count").notNull().default(0),
  requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
  acknowledgedCount: integer("acknowledged_count").notNull().default(0),
  attachmentDocumentId: integer("attachment_document_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Manager delegates approval authority to another employee during absence
export const approvalDelegationsTable = pgTable("approval_delegations", {
  id: serial("id").primaryKey(),
  delegatorEmployeeId: integer("delegator_employee_id").notNull(),
  delegateEmployeeId: integer("delegate_employee_id").notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  // "leave_approval" | "attendance_approval" | "expense_approval" | "all"
  delegationType: varchar("delegation_type", { length: 40 }).notNull().default("all"),
  reason: text("reason"),
  // "active" | "expired" | "revoked"
  status: varchar("status", { length: 20 }).notNull().default("active"),
  approvedByUserId: integer("approved_by_user_id"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmployeeRequest = typeof employeeRequestsTable.$inferSelect;
export type Announcement = typeof announcementsTable.$inferSelect;
export type ApprovalDelegation = typeof approvalDelegationsTable.$inferSelect;
