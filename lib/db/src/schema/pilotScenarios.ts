import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Pilot / demo account configurations.
 * Each row defines a built-in demo persona with a role and guided scenario.
 * Passwords are never stored here — the system resets them on pilot reset.
 */
export const pilotAccountsTable = pgTable("pilot_accounts", {
  id: serial("id").primaryKey(),
  persona: varchar("persona", { length: 60 }).notNull().unique(),
  // Human-readable label shown in the pilot launcher
  labelEn: varchar("label_en", { length: 120 }).notNull(),
  labelAr: varchar("label_ar", { length: 120 }).notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  // The system username this persona maps to (e.g. "demo.hr_manager")
  systemUsername: varchar("system_username", { length: 80 }).notNull(),
  // "hr_admin" | "hr_manager" | "supervisor" | "employee" | "finance" | "it_admin" | "auditor" | "commander"
  roleType: varchar("role_type", { length: 30 }).notNull(),
  // JSON array of permitted module paths this persona can visit
  permittedPathsJson: text("permitted_paths_json"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PilotAccount = typeof pilotAccountsTable.$inferSelect;

/**
 * Guided pilot scenarios — step-by-step walkthroughs of key workflows.
 * Used to demonstrate the system to evaluators / pilot users.
 */
export const pilotScenariosTable = pgTable("pilot_scenarios", {
  id: serial("id").primaryKey(),
  scenarioCode: varchar("scenario_code", { length: 40 }).notNull().unique(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleAr: varchar("title_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  category: varchar("category", { length: 40 }).notNull().default("general"),
  // "commercial" | "government" | "military" | "all"
  applicableTo: varchar("applicable_to", { length: 20 }).notNull().default("all"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(15),
  // JSON array of step objects: { stepNumber, titleEn, titleAr, instructions, navigateTo, actionHint }
  stepsJson: text("steps_json").notNull().default("[]"),
  // Which pilot persona(s) this scenario targets (comma-separated)
  targetPersonas: varchar("target_personas", { length: 200 }),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PilotScenario = typeof pilotScenariosTable.$inferSelect;

/**
 * Tracks which pilot scenarios a demo user has started/completed.
 */
export const pilotScenarioProgressTable = pgTable("pilot_scenario_progress", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull(),
  userId: integer("user_id").notNull(),
  // "not_started" | "in_progress" | "complete" | "skipped"
  status: varchar("status", { length: 20 }).notNull().default("not_started"),
  currentStep: integer("current_step").notNull().default(1),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PilotScenarioProgress = typeof pilotScenarioProgressTable.$inferSelect;
