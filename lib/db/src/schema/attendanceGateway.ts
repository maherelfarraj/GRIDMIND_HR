import { pgTable, serial, integer, varchar, boolean, text, timestamp, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { attendanceDevicesTable } from "./devices";
import { systemUsersTable } from "./systemUsers";

/**
 * Attendance Gateway registrations.
 *
 * A gateway is a small service running inside the customer network (air-gap
 * friendly) that talks to physical attendance devices through pluggable
 * adapters and forwards punches to the HR core over HMAC-signed requests.
 *
 * Security model:
 *  - Registration is created by an admin in the HR core; a random shared
 *    secret is generated server-side and returned exactly ONCE.
 *  - The secret itself is never stored; the server keeps the derived signing
 *    key (sha256 of the secret) only inside an AES-256-GCM envelope wrapped
 *    with a server-side pepper held outside the database, so a DB leak alone
 *    cannot forge signatures.
 *  - Every gateway request is authenticated via HMAC-SHA256 over
 *    `${timestamp}.${sha256(rawBody)}` using the shared secret.
 *  - No raw biometric templates ever reach the HR core: adapters only emit
 *    punch metadata (device user id, time, type).
 */
export const gatewayRegistrationsTable = pgTable("gateway_registrations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }),
  deviceId: integer("device_id").references(() => attendanceDevicesTable.id),
  adapterType: varchar("adapter_type", { length: 30 }).notNull().default("SIMULATOR"),
  // ZKTECO | SUPREMA | GENERIC_REST | CSV | SIMULATOR
  // Encrypted envelope of the HMAC signing key (sha256 of the shared secret),
  // wrapped with a server-side pepper stored outside the database. Legacy rows
  // may still hold the bare sha256 hex until rotated.
  secretHash: text("secret_hash").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE | REVOKED
  registeredByUserId: integer("registered_by_user_id").notNull().references(() => systemUsersTable.id),
  lastSeenAt: timestamp("last_seen_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  clockDriftMs: bigint("clock_drift_ms", { mode: "number" }), // last measured gateway↔server drift
  driftAlert: boolean("drift_alert").notNull().default(false), // drift beyond tolerance
  // Last adapter→middleware connection test reported via heartbeat.
  // REACHABLE | AUTH_FAILED | UNREACHABLE | NOT_CONFIGURED
  adapterConnStatus: varchar("adapter_conn_status", { length: 20 }),
  adapterConnMessage: text("adapter_conn_message"),
  adapterConnTestedAt: timestamp("adapter_conn_tested_at"),
  // Vendor SDK availability reported via heartbeat (null until a gateway
  // new enough to report them checks in).
  sdkPresent: boolean("sdk_present"),
  sdkVersion: varchar("sdk_version", { length: 60 }),
  // Device↔gateway clock skew measured by the gateway at testConnection()
  // time (distinct from clockDriftMs = gateway↔server drift). A skewed
  // device clock silently mis-stamps every punch, so it gets its own alert.
  deviceClockSkewMs: bigint("device_clock_skew_ms", { mode: "number" }),
  deviceClockSkewAlert: boolean("device_clock_skew_alert").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Punch import batches — one row per signed upload (gateway push, CSV import,
 * simulator run). Stores the raw-payload hash for tamper evidence and the
 * dedupe outcome so reconciliation can compare gateway-side vs server-side
 * counts per batch UUID.
 */
export const punchImportBatchesTable = pgTable(
  "punch_import_batches",
  {
    id: serial("id").primaryKey(),
    batchUuid: varchar("batch_uuid", { length: 64 }).notNull(),
    registrationId: integer("registration_id").references(() => gatewayRegistrationsTable.id),
    source: varchar("source", { length: 20 }).notNull().default("GATEWAY"), // GATEWAY | CSV | SIMULATOR
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    eventCount: integer("event_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    unmappedCount: integer("unmapped_count").notNull().default(0),
    rawPayloadSha256: varchar("raw_payload_sha256", { length: 64 }),
    signatureValid: boolean("signature_valid").notNull().default(true),
    clockDriftMs: bigint("clock_drift_ms", { mode: "number" }),
    status: varchar("status", { length: 20 }).notNull().default("COMPLETED"), // COMPLETED | PARTIAL | FAILED
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_punch_import_batches_uuid").on(t.batchUuid)],
);

/**
 * Device commands — remote operations (currently RESTART) queued by an HR
 * operator for a physical attendance device. The site's gateway picks pending
 * commands up in its next heartbeat response (PENDING → DELIVERED) and then
 * reports the outcome over the signed ack endpoint (→ ACKNOWLEDGED | FAILED).
 * Commands that are never delivered/acked expire so the queue can't wedge.
 */
export const deviceCommandsTable = pgTable("device_commands", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull().references(() => attendanceDevicesTable.id),
  registrationId: integer("registration_id").notNull().references(() => gatewayRegistrationsTable.id),
  command: varchar("command", { length: 30 }).notNull().default("RESTART"), // RESTART
  status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING | DELIVERED | ACKNOWLEDGED | FAILED | EXPIRED
  requestedByUserId: integer("requested_by_user_id").references(() => systemUsersTable.id),
  resultMessage: text("result_message"),
  deliveredAt: timestamp("delivered_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type GatewayRegistration = typeof gatewayRegistrationsTable.$inferSelect;
export type DeviceCommand = typeof deviceCommandsTable.$inferSelect;
export type PunchImportBatch = typeof punchImportBatchesTable.$inferSelect;
