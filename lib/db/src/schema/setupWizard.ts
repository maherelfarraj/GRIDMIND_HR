import { pgTable, serial, varchar, boolean, text, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Tracks first-run setup wizard progress. One row per installation.
 * Steps: org_profile → branding → locale → payroll → workweek → holidays
 *        → org_structure → roles_grades → admins → approvals → devices
 *        → backup → security → complete
 */
export const setupWizardProgressTable = pgTable("setup_wizard_progress", {
  id: serial("id").primaryKey(),
  instanceId: varchar("instance_id", { length: 64 }).notNull().default("default"),
  currentStep: varchar("current_step", { length: 40 }).notNull().default("org_profile"),
  completedStepsJson: text("completed_steps_json").notNull().default("[]"),
  isComplete: boolean("is_complete").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id"),
  // Snapshot of answers for each completed step (JSON object keyed by step name)
  answersJson: text("answers_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SetupWizardProgress = typeof setupWizardProgressTable.$inferSelect;
