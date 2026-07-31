import { pgTable, serial, integer, varchar, boolean, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { attendanceDevicesTable } from "./devices";
import { attendanceRecordsTable } from "./attendance";

export const punchEventsTable = pgTable(
  "punch_events",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
    deviceId: integer("device_id").references(() => attendanceDevicesTable.id),
    attendanceRecordId: integer("attendance_record_id").references(() => attendanceRecordsTable.id),
    eventTime: timestamp("event_time").notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(),
    // CLOCK_IN | CLOCK_OUT | BREAK_START | BREAK_END | OVERTIME_START | OVERTIME_END
    source: varchar("source", { length: 20 }).notNull().default("BIOMETRIC"),
    // BIOMETRIC | MANUAL | CORRECTION | IMPORT | GATEWAY
    isVerified: boolean("is_verified").notNull().default(true),
    isMissing: boolean("is_missing").notNull().default(false), // flagged as missing by system
    rawPayload: text("raw_payload"), // JSON from device
    // Gateway ingestion columns (nullable for legacy/manual punches):
    dedupeKey: varchar("dedupe_key", { length: 64 }), // sha256 of registration|deviceEventUid|employee|time|type
    importBatchId: integer("import_batch_id"), // FK to punch_import_batches (soft, avoids circular import)
    deviceEventUid: varchar("device_event_uid", { length: 120 }), // device-native event id
    rawPayloadSha256: varchar("raw_payload_sha256", { length: 64 }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_punch_events_dedupe_key").on(t.dedupeKey)],
);
