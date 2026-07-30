import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Encrypted synchronization queue for HQ-to-branch and branch-to-HQ data sync.
export const syncQueueTable = pgTable("sync_queue", {
  id: serial("id").primaryKey(),
  // Server codes — "HQ" is the headquarters
  sourceServerCode: varchar("source_server_code", { length: 30 }).notNull(),
  targetServerCode: varchar("target_server_code", { length: 30 }).notNull(),
  entityType: varchar("entity_type", { length: 60 }).notNull(),
  entityId: integer("entity_id"),
  entityLabel: varchar("entity_label", { length: 200 }),
  // "create" | "update" | "delete" | "bulk_sync"
  operation: varchar("operation", { length: 20 }).notNull().default("update"),
  // "pending" | "in_progress" | "completed" | "failed" | "conflict" | "skipped"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // SHA-256 of the encrypted payload (not the payload itself — air-gap safe)
  payloadHash: varchar("payload_hash", { length: 128 }),
  payloadSizeBytes: integer("payload_size_bytes"),
  // encrypted: true means payload is encrypted with branch server public key
  isEncrypted: boolean("is_encrypted").notNull().default(true),
  // Conflict resolution: "pending_review" | "hq_wins" | "branch_wins" | "manual_merge"
  conflictResolution: varchar("conflict_resolution", { length: 30 }),
  conflictNotes: text("conflict_notes"),
  processedAt: timestamp("processed_at"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SyncQueueEntry = typeof syncQueueTable.$inferSelect;
