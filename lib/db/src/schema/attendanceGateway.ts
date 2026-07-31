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
 *  - Only the SHA-256 hash of the secret is stored (never the secret itself).
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
  secretHash: varchar("secret_hash", { length: 64 }).notNull(), // sha256 hex of the shared secret
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE | REVOKED
  registeredByUserId: integer("registered_by_user_id").notNull().references(() => systemUsersTable.id),
  lastSeenAt: timestamp("last_seen_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  clockDriftMs: bigint("clock_drift_ms", { mode: "number" }), // last measured gateway↔server drift
  driftAlert: boolean("drift_alert").notNull().default(false), // drift beyond tolerance
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

export type GatewayRegistration = typeof gatewayRegistrationsTable.$inferSelect;
export type PunchImportBatch = typeof punchImportBatchesTable.$inferSelect;
