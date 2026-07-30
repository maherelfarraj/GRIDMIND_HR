import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// ─── Notifications & Approval Inbox — Phase 6 ────────────────────────────────

// In-app notification queue (no external cloud dependency).
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").notNull(),
  recipientEmployeeId: integer("recipient_employee_id"),
  // "leave_request" | "leave_decision" | "attendance_correction" | "payroll_published" |
  // "document_expiry" | "cert_expiry" | "probation_review" | "appraisal_due" |
  // "goal_approved" | "approval_required" | "announcement" | "system" | "security_alert"
  notificationType: varchar("notification_type", { length: 40 }).notNull(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }),
  bodyEn: text("body_en").notNull(),
  bodyAr: text("body_ar"),
  // "info" | "success" | "warning" | "error" | "urgent"
  severity: varchar("severity", { length: 20 }).notNull().default("info"),
  // Deep-link within the app
  actionUrl: varchar("action_url", { length: 500 }),
  actionLabelEn: varchar("action_label_en", { length: 100 }),
  // Linked entity
  entityType: varchar("entity_type", { length: 50 }),
  entityId: integer("entity_id"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  isDismissed: boolean("is_dismissed").notNull().default(false),
  dismissedAt: timestamp("dismissed_at"),
  // Escalation tracking
  requiresAction: boolean("requires_action").notNull().default(false),
  actionDeadline: varchar("action_deadline", { length: 10 }),
  isEscalated: boolean("is_escalated").notNull().default(false),
  escalatedAt: timestamp("escalated_at"),
  escalatedToUserId: integer("escalated_to_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

// Per-user notification preferences.
export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  // JSON map: { notificationType: boolean } — true = subscribed
  subscriptionsJson: text("subscriptions_json"),
  // Quiet hours
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
  quietHoursStart: varchar("quiet_hours_start", { length: 5 }),  // "22:00"
  quietHoursEnd: varchar("quiet_hours_end", { length: 5 }),      // "07:00"
  preferredLanguage: varchar("preferred_language", { length: 2 }).notNull().default("en"),
  // Dashboard alert frequency: "realtime" | "hourly" | "daily"
  dashboardFrequency: varchar("dashboard_frequency", { length: 20 }).notNull().default("realtime"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Escalation rules — when to escalate unactioned items.
export const escalationRulesTable = pgTable("escalation_rules", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  // Entity type that triggers this rule
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  // Status that triggers (e.g. "pending")
  triggerStatus: varchar("trigger_status", { length: 30 }).notNull(),
  // Hours before escalation fires
  escalateAfterHours: integer("escalate_after_hours").notNull().default(24),
  // Role to escalate to
  escalateToRole: varchar("escalate_to_role", { length: 50 }),
  // Or specific user
  escalateToUserId: integer("escalate_to_user_id"),
  notificationSeverity: varchar("notification_severity", { length: 20 }).notNull().default("warning"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Unified approval inbox item — aggregates all pending approvals for a user.
export const approvalInboxItemsTable = pgTable("approval_inbox_items", {
  id: serial("id").primaryKey(),
  assignedToUserId: integer("assigned_to_user_id").notNull(),
  assignedToEmployeeId: integer("assigned_to_employee_id"),
  // Entity that needs approval
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: integer("entity_id").notNull(),
  titleEn: varchar("title_en", { length: 400 }).notNull(),
  titleAr: varchar("title_ar", { length: 400 }),
  // "leave_approval" | "attendance_correction" | "job_requisition" | "promotion" | "dual_auth" | "expense" | "other"
  approvalType: varchar("approval_type", { length: 40 }).notNull(),
  requestedByEmployeeId: integer("requested_by_employee_id"),
  requestedAt: timestamp("requested_at").notNull(),
  deadline: varchar("deadline", { length: 10 }),
  priority: varchar("priority", { length: 20 }).notNull().default("normal"),  // "urgent" | "high" | "normal" | "low"
  // "pending" | "approved" | "rejected" | "delegated" | "escalated" | "expired"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  decidedAt: timestamp("decided_at"),
  decisionNotes: text("decision_notes"),
  isDelegated: boolean("is_delegated").notNull().default(false),
  delegatedToUserId: integer("delegated_to_user_id"),
  isEscalated: boolean("is_escalated").notNull().default(false),
  escalatedAt: timestamp("escalated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
export type EscalationRule = typeof escalationRulesTable.$inferSelect;
export type ApprovalInboxItem = typeof approvalInboxItemsTable.$inferSelect;
