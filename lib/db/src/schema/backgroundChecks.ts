import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Background check tracking per applicant/application.
export const backgroundChecksTable = pgTable("background_checks", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  applicantId: integer("applicant_id").notNull(),
  // "criminal" | "employment" | "education" | "reference" | "credit" | "medical" | "security_clearance" | "full"
  checkType: varchar("check_type", { length: 30 }).notNull().default("full"),
  // "pending" | "in_progress" | "passed" | "failed" | "requires_review" | "waived"
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  provider: varchar("provider", { length: 200 }),
  referenceNumber: varchar("reference_number", { length: 80 }),
  initiatedAt: timestamp("initiated_at"),
  completedAt: timestamp("completed_at"),
  expiryDate: varchar("expiry_date", { length: 10 }),
  resultSummary: text("result_summary"),
  flagNotes: text("flag_notes"),  // Issues found
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  isWaived: boolean("is_waived").notNull().default(false),
  waivedByUserId: integer("waived_by_user_id"),
  waivedReason: text("waived_reason"),
  documentId: integer("document_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BackgroundCheck = typeof backgroundChecksTable.$inferSelect;
