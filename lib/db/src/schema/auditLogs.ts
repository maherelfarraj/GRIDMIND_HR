import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable(
  "audit_logs",
  {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  entityLabel: text("entity_label"),
  changesJson: text("changes_json"),
  // Set when the actor had an open privileged (break-glass) session at write
  // time — populated by a DB trigger so every write site is covered. Lets
  // reviewers see exactly what was done under elevated access, not just what
  // happened to fall inside the time window.
  privilegedSessionId: integer("privileged_session_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Supports GET /privileged-sessions/:id/activity page + count queries,
    // which filter by actor_user_id and a created_at range.
    index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
  ],
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
