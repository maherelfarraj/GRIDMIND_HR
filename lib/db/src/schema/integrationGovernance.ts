import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Integration credential vault references.
 * IMPORTANT: This table stores REFERENCES to credentials (vault key names, env var names),
 * never the actual credentials. The real credentials live in the server's secret vault
 * or environment variables. This satisfies air-gap security requirements.
 */
export const integrationCredentialVaultRefsTable = pgTable("integration_credential_vault_refs", {
  id: serial("id").primaryKey(),
  // Human-readable label for this credential set
  labelEn: varchar("label_en", { length: 150 }).notNull(),
  labelAr: varchar("label_ar", { length: 150 }).notNull(),
  // "ldap" | "active_directory" | "smtp" | "sms_gateway" | "attendance_device"
  //  | "finance_api" | "document_signing" | "sso_saml" | "sso_oidc" | "internal_api"
  credentialType: varchar("credential_type", { length: 30 }).notNull(),
  // Reference key name in the vault / env (NOT the value)
  vaultKeyRef: varchar("vault_key_ref", { length: 200 }).notNull(),
  // Optional: secondary key (e.g. secret in addition to API key)
  vaultSecretRef: varchar("vault_secret_ref", { length: 200 }),
  // Description for auditors
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  // "active" | "rotated" | "expired" | "revoked"
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // When this credential was last rotated (not the value — just the timestamp)
  lastRotatedAt: timestamp("last_rotated_at"),
  // When rotation is next due (for policy enforcement)
  rotationDueAt: timestamp("rotation_due_at"),
  // Who owns this credential (for accountability)
  ownerUserId: integer("owner_user_id"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IntegrationCredentialVaultRef = typeof integrationCredentialVaultRefsTable.$inferSelect;

/**
 * Integration connection profiles — named, reusable connection configurations.
 * Extends integrationConnectorsTable (Phase 7B) with governance fields.
 * One connector type can have multiple profiles (e.g. test vs production LDAP server).
 */
export const integrationConnectionProfilesTable = pgTable("integration_connection_profiles", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  // References integrationConnectorsTable.id (the Phase 7B connector type)
  connectorId: integer("connector_id"),
  profileName: varchar("profile_name", { length: 100 }).notNull(),
  profileNameAr: varchar("profile_name_ar", { length: 100 }).notNull(),
  // "ldap" | "active_directory" | "sso_saml" | "sso_oidc" | "smtp" | "sms_gateway"
  //  | "attendance_device" | "finance_api" | "document_signing" | "internal_api"
  integrationType: varchar("integration_type", { length: 30 }).notNull(),
  // "development" | "staging" | "production"
  environment: varchar("environment", { length: 20 }).notNull().default("production"),
  // Connection parameters JSON (no secrets — vault refs only)
  // e.g. { host, port, baseDn, bindDnRef: "vault:ldap_bind_dn", ... }
  connectionParamsJson: text("connection_params_json").notNull().default("{}"),
  // Reference to credential vault ref
  credentialVaultRefId: integer("credential_vault_ref_id"),
  // "active" | "inactive" | "testing" | "error" | "disabled"
  status: varchar("status", { length: 20 }).notNull().default("inactive"),
  // Last connection test result
  lastTestResult: varchar("last_test_result", { length: 20 }),
  lastTestMessage: text("last_test_message"),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestedByUserId: integer("last_tested_by_user_id"),
  lastTestLatencyMs: integer("last_test_latency_ms"),
  lastTestSimulated: boolean("last_test_simulated"),
  // Health monitoring
  isHealthMonitoringEnabled: boolean("is_health_monitoring_enabled").notNull().default(false),
  healthCheckIntervalMinutes: integer("health_check_interval_minutes").notNull().default(15),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  alertOnFailureCount: integer("alert_on_failure_count").notNull().default(3),
  // Retry policy
  retryEnabled: boolean("retry_enabled").notNull().default(true),
  retryMaxAttempts: integer("retry_max_attempts").notNull().default(3),
  retryBackoffSeconds: integer("retry_backoff_seconds").notNull().default(30),
  // Air-gap mode: all data exchanged via local network only
  isAirGapSafe: boolean("is_air_gap_safe").notNull().default(true),
  // "pending_approval" | "approved" | "suspended" — governance state
  governanceStatus: varchar("governance_status", { length: 20 }).notNull().default("pending_approval"),
  approvedByUserId: integer("approved_by_user_id"),
  approvedAt: timestamp("approved_at"),
  approvalNotes: text("approval_notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IntegrationConnectionProfile = typeof integrationConnectionProfilesTable.$inferSelect;

/**
 * Integration governance rules — org-level policies governing what integrations
 * are permitted, how they are approved, and under what conditions they may operate.
 */
export const integrationGovernanceRulesTable = pgTable("integration_governance_rules", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  // "ldap" | "attendance_device" | "smtp" | etc.
  integrationType: varchar("integration_type", { length: 30 }).notNull(),
  ruleCode: varchar("rule_code", { length: 60 }).notNull(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleAr: varchar("title_ar", { length: 200 }).notNull(),
  // "required" | "allowed" | "prohibited"
  permissionLevel: varchar("permission_level", { length: 15 }).notNull().default("allowed"),
  // Whether dual-auth is required to activate
  requiresDualAuth: boolean("requires_dual_auth").notNull().default(false),
  // Whether activation needs a policy change request (maker-checker)
  requiresMakerChecker: boolean("requires_maker_checker").notNull().default(true),
  // Maximum number of active profiles of this type
  maxActiveProfiles: integer("max_active_profiles").notNull().default(1),
  // Whether the integration may reach external networks (false = LAN only)
  allowExternalNetwork: boolean("allow_external_network").notNull().default(false),
  // Governance notes
  notesEn: text("notes_en"),
  notesAr: text("notes_ar"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IntegrationGovernanceRule = typeof integrationGovernanceRulesTable.$inferSelect;

/**
 * Integration audit log — all events on integration connections.
 * Separate from the general auditLogsTable; richer integration-specific fields.
 */
export const integrationAuditLogTable = pgTable("integration_audit_log", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id"),
  integrationType: varchar("integration_type", { length: 30 }),
  // "connected" | "disconnected" | "test_passed" | "test_failed" | "credentials_rotated"
  //  | "profile_approved" | "profile_suspended" | "retry_triggered" | "health_alert"
  //  | "data_synced" | "export_sent" | "import_received"
  eventType: varchar("event_type", { length: 40 }).notNull(),
  // "success" | "failure" | "warning"
  outcome: varchar("outcome", { length: 15 }).notNull().default("success"),
  message: text("message"),
  // Metadata: rows processed, bytes, response time, etc.
  metadataJson: text("metadata_json"),
  actorUserId: integer("actor_user_id"),
  // IP / device that triggered the event (for security events)
  sourceIp: varchar("source_ip", { length: 45 }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
});

export type IntegrationAuditLog = typeof integrationAuditLogTable.$inferSelect;
