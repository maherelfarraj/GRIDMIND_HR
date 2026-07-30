import { pgTable, serial, varchar, boolean, timestamp, text, integer } from "drizzle-orm/pg-core";

// Candidate master record — may be external or an existing employee (internal transfer).
export const applicantsTable = pgTable("applicants", {
  id: serial("id").primaryKey(),
  // Non-null if internal (existing employee applying for internal transfer/promotion)
  employeeId: integer("employee_id"),
  firstNameEn: varchar("first_name_en", { length: 100 }).notNull(),
  lastNameEn: varchar("last_name_en", { length: 100 }).notNull(),
  firstNameAr: varchar("first_name_ar", { length: 100 }),
  lastNameAr: varchar("last_name_ar", { length: 100 }),
  email: varchar("email", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  nationalId: varchar("national_id", { length: 20 }),
  nationality: varchar("nationality", { length: 80 }),
  gender: varchar("gender", { length: 10 }),
  dateOfBirth: varchar("date_of_birth", { length: 10 }),
  // "internal" | "external"
  applicantType: varchar("applicant_type", { length: 20 }).notNull().default("external"),
  // Current employer / last position
  currentEmployer: varchar("current_employer", { length: 200 }),
  currentTitle: varchar("current_title", { length: 200 }),
  totalExperienceYears: integer("total_experience_years"),
  highestEducation: varchar("highest_education", { length: 60 }),
  linkedinUrl: varchar("linkedin_url", { length: 500 }),
  resumeDocumentId: integer("resume_document_id"),
  source: varchar("source", { length: 80 }).notNull().default("direct"),  // "portal" | "referral" | "agency" | "direct"
  referredByEmployeeId: integer("referred_by_employee_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Applicant = typeof applicantsTable.$inferSelect;
