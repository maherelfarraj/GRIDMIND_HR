import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Interview round and scoring — each row = one interviewer's assessment of one applicant in one round.
export const interviewScoresTable = pgTable("interview_scores", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  interviewerEmployeeId: integer("interviewer_employee_id").notNull(),
  roundNumber: integer("round_number").notNull().default(1),
  // "hr_screen" | "technical" | "competency" | "panel" | "executive" | "final"
  roundType: varchar("round_type", { length: 30 }).notNull().default("hr_screen"),
  scheduledAt: timestamp("scheduled_at"),
  conductedAt: timestamp("conducted_at"),
  // "scheduled" | "completed" | "no_show" | "cancelled" | "rescheduled"
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  durationMinutes: integer("duration_minutes"),
  // Scores 1-5 per dimension
  technicalScore: integer("technical_score"),     // 1-5
  communicationScore: integer("communication_score"),
  leadershipScore: integer("leadership_score"),
  cultureFitScore: integer("culture_fit_score"),
  overallScore: integer("overall_score"),         // 1-5 aggregate
  // "strong_yes" | "yes" | "maybe" | "no"
  recommendation: varchar("recommendation", { length: 20 }),
  strengthsNotes: text("strengths_notes"),
  concernsNotes: text("concerns_notes"),
  generalNotes: text("general_notes"),
  isSubmitted: boolean("is_submitted").notNull().default(false),
  submittedAt: timestamp("submitted_at"),
  meetingLocation: varchar("meeting_location", { length: 200 }),
  interviewMode: varchar("interview_mode", { length: 20 }).notNull().default("in_person"),  // "in_person" | "video" | "phone"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type InterviewScore = typeof interviewScoresTable.$inferSelect;
