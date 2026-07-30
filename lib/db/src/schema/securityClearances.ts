import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Security clearance records per employee. Access to this table is itself restricted.
export const securityClearancesTable = pgTable("security_clearances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().unique(),
  // "unclassified" | "restricted" | "confidential" | "secret" | "top_secret" | "sci"
  clearanceLevel: varchar("clearance_level", { length: 20 }).notNull().default("unclassified"),
  // "active" | "suspended" | "revoked" | "expired" | "pending_investigation" | "interim"
  status: varchar("status", { length: 30 }).notNull().default("pending_investigation"),
  grantedDate: varchar("granted_date", { length: 10 }),   // YYYY-MM-DD
  expiryDate: varchar("expiry_date", { length: 10 }),
  investigationAuthority: varchar("investigation_authority", { length: 200 }),
  investigationReferenceNumber: varchar("investigation_reference_number", { length: 80 }),
  adjudicationNotes: text("adjudication_notes"),
  lastReviewedAt: timestamp("last_reviewed_at"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  suspensionReason: text("suspension_reason"),
  // Polygraph / special access program flags (comma-separated codes, e.g. "SI,TK,HCS")
  accessCaveats: varchar("access_caveats", { length: 200 }),
  // Requires dual-auth to change the clearance level
  requiresDualAuthForChanges: boolean("requires_dual_auth_for_changes").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SecurityClearance = typeof securityClearancesTable.$inferSelect;
