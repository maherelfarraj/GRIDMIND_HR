import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Disciplinary actions, commendations and promotion recommendations.
export const disciplinaryRecordsTable = pgTable("disciplinary_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  // "verbal_warning" | "written_warning" | "final_warning" | "suspension" | "demotion" | "termination"
  actionType: varchar("action_type", { length: 30 }).notNull(),
  incidentDate: varchar("incident_date", { length: 10 }).notNull(),
  actionDate: varchar("action_date", { length: 10 }).notNull(),
  descriptionEn: text("description_en").notNull(),
  descriptionAr: text("description_ar"),
  // "attendance" | "conduct" | "performance" | "policy_violation" | "insubordination" | "other"
  category: varchar("category", { length: 30 }).notNull().default("conduct"),
  // "pending" | "active" | "appealed" | "overturned" | "expired"
  status: varchar("status", { length: 20 }).notNull().default("active"),
  expiryDate: varchar("expiry_date", { length: 10 }),
  issuedByEmployeeId: integer("issued_by_employee_id").notNull(),
  hrApprovedByUserId: integer("hr_approved_by_user_id"),
  employeeAcknowledged: boolean("employee_acknowledged").notNull().default(false),
  employeeAcknowledgedAt: timestamp("employee_acknowledged_at"),
  employeeResponse: text("employee_response"),
  appealDate: varchar("appeal_date", { length: 10 }),
  appealOutcome: varchar("appeal_outcome", { length: 100 }),
  documentId: integer("document_id"),
  // Security/audit fields
  requiresDualAuth: boolean("requires_dual_auth").notNull().default(false),
  dualAuthRequestId: integer("dual_auth_request_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const commendationRecordsTable = pgTable("commendation_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  // "certificate" | "monetary_award" | "promotion_points" | "letter_of_appreciation" | "public_recognition"
  awardType: varchar("award_type", { length: 40 }).notNull().default("letter_of_appreciation"),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }),
  descriptionEn: text("description_en"),
  awardDate: varchar("award_date", { length: 10 }).notNull(),
  nominatedByEmployeeId: integer("nominated_by_employee_id"),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  // Points added to succession pool scoring
  promotionPoints: integer("promotion_points").notNull().default(0),
  documentId: integer("document_id"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const promotionRecommendationsTable = pgTable("promotion_recommendations", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  appraisalId: integer("appraisal_id"),
  currentGradeCode: varchar("current_grade_code", { length: 20 }),
  recommendedGradeCode: varchar("recommended_grade_code", { length: 20 }),
  currentRankCode: varchar("current_rank_code", { length: 20 }),
  recommendedRankCode: varchar("recommended_rank_code", { length: 20 }),
  recommendationDate: varchar("recommendation_date", { length: 10 }).notNull(),
  justificationEn: text("justification_en").notNull(),
  // "pending" | "approved" | "deferred" | "rejected"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedByEmployeeId: integer("reviewed_by_employee_id"),
  reviewedAt: timestamp("reviewed_at"),
  effectiveDate: varchar("effective_date", { length: 10 }),
  notes: text("notes"),
  requiresDualAuth: boolean("requires_dual_auth").notNull().default(false),
  dualAuthRequestId: integer("dual_auth_request_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DisciplinaryRecord = typeof disciplinaryRecordsTable.$inferSelect;
export type CommendationRecord = typeof commendationRecordsTable.$inferSelect;
export type PromotionRecommendation = typeof promotionRecommendationsTable.$inferSelect;
