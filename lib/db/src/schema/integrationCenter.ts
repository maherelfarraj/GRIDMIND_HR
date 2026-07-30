import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// ─── Integration Administration Center — Phase 7B ────────────────────────────

export const integrationConnectorsTable = pgTable("integration_connectors", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 100 }).notNull(),
  nameAr: varchar("name_ar", { length: 100 }).notNull(),
  // "attendance_device" | "active_directory" | "ldap" | "email_gateway" | "sms_gateway" | "erp_finance" | "file_exchange" | "custom"
  connectorType: varchar("connector_type", { length: 40 }).notNull(),
  // "ldap" | "smtp" | "rest_api" | "sftp" | "file"
  protocol: varchar("protocol", { length: 30 }).notNull(),
  endpoint: varchar("endpoint", { length: 255 }),
  portNumber: integer("port_number"),
  useTls: boolean("use_tls").notNull().default(false),
  credentialsJson: text("credentials_json"),
  timeoutSeconds: integer("timeout_seconds").notNull().default(30),
  // "unconfigured" | "healthy" | "degraded" | "error" | "disabled"
  status: varchar("status", { length: 20 }).notNull().default("unconfigured"),
  lastTestedAt: timestamp("last_tested_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorMessage: text("last_error_message"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  simulatedLabel: varchar("simulated_label", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const connectionHealthLogTable = pgTable("connection_health_log", {
  id: serial("id").primaryKey(),
  connectorId: integer("connector_id").notNull().references(() => integrationConnectorsTable.id),
  testedAt: timestamp("tested_at").defaultNow().notNull(),
  success: boolean("success").notNull(),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  checkedByUserId: integer("checked_by_user_id"),
});

export const integrationRetryQueueTable = pgTable("integration_retry_queue", {
  id: serial("id").primaryKey(),
  connectorId: integer("connector_id").notNull().references(() => integrationConnectorsTable.id),
  operationType: varchar("operation_type", { length: 60 }).notNull(),
  payloadJson: text("payload_json").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextRetryAt: timestamp("next_retry_at").notNull(),
  lastError: text("last_error"),
  // "pending" | "retrying" | "succeeded" | "abandoned"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const integrationEventLogTable = pgTable("integration_event_log", {
  id: serial("id").primaryKey(),
  connectorId: integer("connector_id"),
  // "sync" | "test" | "error" | "retry" | "config_change"
  eventType: varchar("event_type", { length: 60 }).notNull(),
  // "inbound" | "outbound" | "internal"
  direction: varchar("direction", { length: 10 }).notNull(),
  entityType: varchar("entity_type", { length: 60 }),
  entityCount: integer("entity_count"),
  success: boolean("success").notNull(),
  durationMs: integer("duration_ms"),
  messageEn: text("message_en"),
  detailsJson: text("details_json"),
  actorUserId: integer("actor_user_id"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
});

export type IntegrationConnector = typeof integrationConnectorsTable.$inferSelect;
export type ConnectionHealthLog = typeof connectionHealthLogTable.$inferSelect;
export type IntegrationRetryQueue = typeof integrationRetryQueueTable.$inferSelect;
export type IntegrationEventLog = typeof integrationEventLogTable.$inferSelect;
