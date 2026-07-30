import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Application — links an applicant to a job posting.
export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  applicationNumber: varchar("application_number", { length: 30 }).notNull().unique(),
  jobPostingId: integer("job_posting_id").notNull(),
  applicantId: integer("applicant_id").notNull(),
  // "applied" | "screening" | "shortlisted" | "interviewing" | "offer_extended" | "hired" | "rejected" | "withdrawn"
  status: varchar("status", { length: 30 }).notNull().default("applied"),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  coverLetterText: text("cover_letter_text"),
  screeningScore: integer("screening_score"),   // 0-100 automated scoring
  interviewScore: integer("interview_score"),   // final aggregated score
  overallRating: varchar("overall_rating", { length: 20 }),  // "strong_yes" | "yes" | "maybe" | "no"
  rejectionReason: text("rejection_reason"),
  rejectedAt: timestamp("rejected_at"),
  shortlistedAt: timestamp("shortlisted_at"),
  shortlistedByUserId: integer("shortlisted_by_user_id"),
  // Current stage / round number
  currentInterviewRound: integer("current_interview_round").notNull().default(0),
  backgroundCheckId: integer("background_check_id"),
  offerId: integer("offer_id"),
  isInternalApplicant: boolean("is_internal_applicant").notNull().default(false),
  assignedRecruiterId: integer("assigned_recruiter_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Application = typeof applicationsTable.$inferSelect;
