import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Probation period tracking and outcome recording.
export const probationRecordsTable = pgTable("probation_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  contractId: integer("contract_id"),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  extendedEndDate: varchar("extended_end_date", { length: 10 }),
  // "active" | "extended" | "passed" | "failed" | "terminated"
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // Mid-probation review date
  midReviewDate: varchar("mid_review_date", { length: 10 }),
  midReviewConductedAt: timestamp("mid_review_conducted_at"),
  midReviewScore: integer("mid_review_score"),   // 1-5
  midReviewNotes: text("mid_review_notes"),
  midReviewByEmployeeId: integer("mid_review_by_employee_id"),
  // Final review
  finalReviewConductedAt: timestamp("final_review_conducted_at"),
  finalReviewScore: integer("final_review_score"),
  finalReviewNotes: text("final_review_notes"),
  finalReviewByEmployeeId: integer("final_review_by_employee_id"),
  // "pass" | "extend" | "terminate"
  outcome: varchar("outcome", { length: 20 }),
  outcomeDate: varchar("outcome_date", { length: 10 }),
  outcomeNotes: text("outcome_notes"),
  confirmationLetterSent: boolean("confirmation_letter_sent").notNull().default(false),
  confirmationLetterSentAt: timestamp("confirmation_letter_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ProbationRecord = typeof probationRecordsTable.$inferSelect;
