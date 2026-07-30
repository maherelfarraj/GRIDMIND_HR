import { pgTable, serial, integer, varchar, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

// Job offer extended to a selected applicant.
export const jobOffersTable = pgTable("job_offers", {
  id: serial("id").primaryKey(),
  offerNumber: varchar("offer_number", { length: 30 }).notNull().unique(),
  applicationId: integer("application_id").notNull(),
  applicantId: integer("applicant_id").notNull(),
  jobPostingId: integer("job_posting_id").notNull(),
  // Position details
  jobTitleEn: varchar("job_title_en", { length: 200 }).notNull(),
  jobTitleAr: varchar("job_title_ar", { length: 200 }).notNull(),
  departmentId: integer("department_id"),
  gradeCode: varchar("grade_code", { length: 20 }),
  // Compensation
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  housingAllowance: numeric("housing_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  transportAllowance: numeric("transport_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPackage: numeric("total_package", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
  // Contract
  employmentType: varchar("employment_type", { length: 30 }).notNull().default("full_time"),
  proposedStartDate: varchar("proposed_start_date", { length: 10 }),
  probationMonths: integer("probation_months").notNull().default(3),
  offerValidUntil: varchar("offer_valid_until", { length: 10 }).notNull(),
  // "draft" | "sent" | "accepted" | "declined" | "expired" | "rescinded"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  declinedAt: timestamp("declined_at"),
  declineReason: text("decline_reason"),
  signedDocumentId: integer("signed_document_id"),
  preparedByUserId: integer("prepared_by_user_id"),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  specialConditions: text("special_conditions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type JobOffer = typeof jobOffersTable.$inferSelect;
