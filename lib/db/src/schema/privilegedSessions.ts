import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Privileged-session monitoring: elevated-access sessions are logged in full.
export const privilegedSessionsTable = pgTable("privileged_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // "admin" | "security_officer" | "break_glass" | "auditor" | "hr_director"
  accessLevel: varchar("access_level", { length: 40 }).notNull(),
  ipAddress: varchar("ip_address", { length: 60 }),
  userAgent: varchar("user_agent", { length: 500 }),
  sessionTokenHash: varchar("session_token_hash", { length: 128 }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  isActive: boolean("is_active").notNull().default(true),
  // JSON array of resource paths accessed during this session
  resourcesAccessedJson: text("resources_accessed_json"),
  // JSON array of anomaly flags (e.g. ["after_hours", "high_volume", "new_location"])
  anomalyFlagsJson: text("anomaly_flags_json"),
  breakGlassId: integer("break_glass_id"),
  // Automatically terminated due to inactivity or policy
  terminationReason: varchar("termination_reason", { length: 80 }),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PrivilegedSession = typeof privilegedSessionsTable.$inferSelect;
