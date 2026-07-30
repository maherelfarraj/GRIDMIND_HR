import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Policy change requests — maker-checker workflow for any configuration change.
 * Any change to org configuration, leave policies, payroll policies,
 * approval chains, or security settings must go through this table.
 */
export const policyChangeRequestsTable = pgTable("policy_change_requests", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  // e.g. "leave_policy" | "payroll_policy" | "approval_chain" | "org_branding"
  //  | "policy_locale" | "calendar_config" | "numbering_scheme" | "retention_rule"
  //  | "employment_type_config" | "integration_profile" | "security_policy"
  policyArea: varchar("policy_area", { length: 50 }).notNull(),
  // Friendly title for display
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleAr: varchar("title_ar", { length: 200 }).notNull(),
  // "draft" | "pending_review" | "approved" | "rejected" | "applied" | "withdrawn"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // Who made the change request
  makerUserId: integer("maker_user_id").notNull(),
  // Who reviewed/approved/rejected
  checkerUserId: integer("checker_user_id"),
  checkerComment: text("checker_comment"),
  decidedAt: timestamp("decided_at"),
  // The entity being changed (e.g. leaveTypeId, orgId)
  targetEntityType: varchar("target_entity_type", { length: 50 }),
  targetEntityId: integer("target_entity_id"),
  targetEntityLabel: varchar("target_entity_label", { length: 200 }),
  // Diff: what the config looks like before and after
  changeBeforeJson: text("change_before_json"),
  changeAfterJson: text("change_after_json").notNull(),
  // Summary of what changed (human-readable)
  changeSummaryEn: text("change_summary_en"),
  changeSummaryAr: text("change_summary_ar"),
  // Impact analysis (generated at submission time)
  impactPreviewJson: text("impact_preview_json"),
  // Version number of the policy after this change is applied
  appliedVersion: integer("applied_version"),
  appliedAt: timestamp("applied_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PolicyChangeRequest = typeof policyChangeRequestsTable.$inferSelect;

/**
 * Policy version history — immutable snapshots of policy state.
 * Appended when a policy change request is applied.
 * Enables rollback and diff comparison.
 */
export const policyVersionsTable = pgTable("policy_versions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  policyArea: varchar("policy_area", { length: 50 }).notNull(),
  targetEntityType: varchar("target_entity_type", { length: 50 }),
  targetEntityId: integer("target_entity_id"),
  targetEntityLabel: varchar("target_entity_label", { length: 200 }),
  version: integer("version").notNull(),
  // Full JSON snapshot of the policy at this version
  snapshotJson: text("snapshot_json").notNull(),
  // SHA-256 hash of snapshotJson for integrity verification
  checksum: varchar("checksum", { length: 64 }),
  changeRequestId: integer("change_request_id"),
  appliedByUserId: integer("applied_by_user_id").notNull(),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  // Whether this version is the current active one
  isCurrent: boolean("is_current").notNull().default(true),
  // Reason for rollback if this is a rollback version
  rollbackReason: text("rollback_reason"),
  // The version this rolled back from
  rolledBackFromVersion: integer("rolled_back_from_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PolicyVersion = typeof policyVersionsTable.$inferSelect;

/**
 * Approval chain configurations — reusable named approval sequences.
 * Each chain defines a list of steps with approver roles/users.
 * Referenced by leave types, policy change requests, payroll approval, etc.
 */
export const approvalChainConfigsTable = pgTable("approval_chain_configs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  name: varchar("name", { length: 100 }).notNull(),
  nameAr: varchar("name_ar", { length: 100 }).notNull(),
  // "leave" | "payroll" | "policy_change" | "recruitment" | "contract" | "general"
  chainType: varchar("chain_type", { length: 30 }).notNull().default("general"),
  // JSON array of step objects:
  // { stepNumber, labelEn, labelAr, approverType ("role"|"user"|"department_head"|"system"),
  //   approverRoleId?, approverUserId?, autoApproveIfNone, timeoutHours, escalateOnTimeout }
  stepsJson: text("steps_json").notNull().default("[]"),
  // Whether all steps must be completed or just one (for parallel approval)
  requireAllSteps: boolean("require_all_steps").notNull().default(true),
  // Max total approval time before auto-escalation
  totalTimeoutHours: integer("total_timeout_hours"),
  // "reject" | "escalate" | "auto_approve"
  timeoutAction: varchar("timeout_action", { length: 20 }).notNull().default("escalate"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ApprovalChainConfig = typeof approvalChainConfigsTable.$inferSelect;
