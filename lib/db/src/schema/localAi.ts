import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";
import { rolesTable } from "./roles";

// ─── Local AI Layer — Phase 7C ────────────────────────────────────────────────

// Single-row config table (id=1)
export const aiConfigTable = pgTable("ai_config", {
  id: serial("id").primaryKey(),
  modelEndpoint: varchar("model_endpoint", { length: 255 }),
  modelName: varchar("model_name", { length: 100 }),
  isEnabled: boolean("is_enabled").notNull().default(false),
  // JSON array: ["policy_search","report_query","document_classify","anomaly_explain"]
  enabledFeatures: text("enabled_features"),
  maxTokens: integer("max_tokens").notNull().default(2048),
  // stored as 0–100 representing 0.00–1.00
  temperatureX100: integer("temperature_x100").notNull().default(70),
  requireApprovalForBulk: boolean("require_approval_for_bulk").notNull().default(true),
  auditAllQueries: boolean("audit_all_queries").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedByUserId: integer("updated_by_user_id"),
});

export const aiQueriesTable = pgTable("ai_queries", {
  id: serial("id").primaryKey(),
  // "policy_search" | "report_query" | "document_classify" | "anomaly_explain"
  featureType: varchar("feature_type", { length: 40 }).notNull(),
  queryText: text("query_text").notNull(),
  responseText: text("response_text"),
  // JSON array of {source, excerpt, page}
  citationsJson: text("citations_json"),
  modelUsed: varchar("model_used", { length: 100 }),
  tokensUsed: integer("tokens_used"),
  durationMs: integer("duration_ms"),
  wasSimulated: boolean("was_simulated").notNull().default(true),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  requestedByUserId: integer("requested_by_user_id"),
  entityType: varchar("entity_type", { length: 60 }),
  entityId: integer("entity_id"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiPermissionsTable = pgTable("ai_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").references(() => rolesTable.id),
  // "policy_search" | "report_query" | "document_classify" | "anomaly_explain"
  featureType: varchar("feature_type", { length: 40 }).notNull(),
  isAllowed: boolean("is_allowed").notNull().default(false),
  grantedByUserId: integer("granted_by_user_id"),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
});

export type AiConfig = typeof aiConfigTable.$inferSelect;
export type AiQuery = typeof aiQueriesTable.$inferSelect;
export type AiPermission = typeof aiPermissionsTable.$inferSelect;
