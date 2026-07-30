import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Dual-authorization workflow for sensitive actions (rank changes, clearance updates,
// forced transfers, payroll close, break-glass revocation, etc.).
export const dualAuthRequestsTable = pgTable("dual_auth_requests", {
  id: serial("id").primaryKey(),
  // E.g. "clearance_change" | "forced_transfer" | "payroll_close" | "account_lockout" | "data_export" | "break_glass_revoke"
  actionType: varchar("action_type", { length: 60 }).notNull(),
  targetEntityType: varchar("target_entity_type", { length: 60 }),
  targetEntityId: integer("target_entity_id"),
  targetEntityLabel: varchar("target_entity_label", { length: 200 }),
  descriptionEn: text("description_en").notNull(),
  descriptionAr: text("description_ar"),
  justification: text("justification"),
  initiatedByUserId: integer("initiated_by_user_id").notNull(),
  // "pending" | "first_approved" | "approved" | "rejected" | "expired" | "withdrawn"
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  firstApproverUserId: integer("first_approver_user_id"),
  firstApprovedAt: timestamp("first_approved_at"),
  firstApproverNotes: text("first_approver_notes"),
  secondApproverUserId: integer("second_approver_user_id"),
  secondApprovedAt: timestamp("second_approved_at"),
  secondApproverNotes: text("second_approver_notes"),
  expiresAt: timestamp("expires_at").notNull(),
  completedAt: timestamp("completed_at"),
  rejectedByUserId: integer("rejected_by_user_id"),
  rejectionReason: text("rejection_reason"),
  // JSON blob of the change being authorized (before/after values)
  payloadJson: text("payload_json"),
  requiresSeparateDepartments: boolean("requires_separate_departments").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DualAuthRequest = typeof dualAuthRequestsTable.$inferSelect;
