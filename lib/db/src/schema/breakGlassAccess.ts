import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Emergency break-glass access records. Access granted outside normal permissions
// must be recorded, time-limited, and reviewed post-hoc.
export const breakGlassAccessTable = pgTable("break_glass_access", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // E.g. "employee_record" | "security_clearance" | "payroll_run" | "audit_log"
  resourceType: varchar("resource_type", { length: 60 }).notNull(),
  resourceId: integer("resource_id"),
  resourceLabel: varchar("resource_label", { length: 200 }),
  justification: text("justification").notNull(),
  emergencyCode: varchar("emergency_code", { length: 20 }),  // pre-issued code for offline auth
  accessGrantedAt: timestamp("access_granted_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: integer("revoked_by_user_id"),
  revocationReason: text("revocation_reason"),
  // Post-access review
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewOutcome: varchar("review_outcome", { length: 30 }),  // "justified" | "unjustified" | "under_investigation"
  reviewNotes: text("review_notes"),
  // Notification sent to supervisory chain?
  notificationSent: boolean("notification_sent").notNull().default(false),
  notifiedAt: timestamp("notified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BreakGlassAccess = typeof breakGlassAccessTable.$inferSelect;
