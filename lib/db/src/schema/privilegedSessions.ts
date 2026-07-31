import { pgTable, serial, integer, varchar, timestamp, text } from "drizzle-orm/pg-core";

// Recorded elevated-access windows. Every break-glass activation opens a
// privileged session; revocation (or expiry) closes it. Security officers
// review each session post-hoc — sessions with reviewedAt = null are the
// open review queue.
export const privilegedSessionsTable = pgTable("privileged_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Link back to the grant that opened this session (the "reason link").
  breakGlassAccessId: integer("break_glass_access_id").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  // When the grant is scheduled to lapse (mirror of the grant's expiresAt).
  scheduledEndAt: timestamp("scheduled_end_at").notNull(),
  // Set when the session ends early (e.g. the grant is revoked).
  endedAt: timestamp("ended_at"),
  endReason: varchar("end_reason", { length: 60 }),
  // Post-hoc review by a security officer.
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewOutcome: varchar("review_outcome", { length: 30 }), // "justified" | "unjustified" | "under_investigation"
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PrivilegedSession = typeof privilegedSessionsTable.$inferSelect;
