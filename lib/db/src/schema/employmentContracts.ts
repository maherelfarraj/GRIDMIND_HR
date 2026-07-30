import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Employment contract tracking — from offer acceptance through signing.
export const employmentContractsTable = pgTable("employment_contracts", {
  id: serial("id").primaryKey(),
  contractNumber: varchar("contract_number", { length: 30 }).notNull().unique(),
  employeeId: integer("employee_id"),  // Set once employee record is created
  applicantId: integer("applicant_id"),
  offerId: integer("offer_id").notNull(),
  // "fixed_term" | "indefinite" | "project_based" | "secondment" | "military_service"
  contractType: varchar("contract_type", { length: 30 }).notNull().default("indefinite"),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }),  // null for indefinite
  probationEndDate: varchar("probation_end_date", { length: 10 }),
  // "draft" | "sent" | "signed" | "active" | "expired" | "terminated" | "rescinded"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  signedAt: timestamp("signed_at"),
  signedByApplicant: boolean("signed_by_applicant").notNull().default(false),
  signedByOrg: boolean("signed_by_org").notNull().default(false),
  orgSignatoryEmployeeId: integer("org_signatory_employee_id"),
  documentId: integer("document_id"),
  terminationDate: varchar("termination_date", { length: 10 }),
  terminationReason: text("termination_reason"),
  preparedByUserId: integer("prepared_by_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmploymentContract = typeof employmentContractsTable.$inferSelect;
