import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Backup and restore verification records.
export const backupRecordsTable = pgTable("backup_records", {
  id: serial("id").primaryKey(),
  // "full" | "incremental" | "differential" | "wal_archive" | "config_only"
  backupType: varchar("backup_type", { length: 30 }).notNull().default("full"),
  // "in_progress" | "completed" | "failed" | "verified" | "corrupted" | "expired"
  status: varchar("status", { length: 20 }).notNull().default("in_progress"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  fileSizeBytes: integer("file_size_bytes"),
  // SHA-256 checksum of the backup archive
  checksum: varchar("checksum", { length: 128 }),
  storageLocation: varchar("storage_location", { length: 500 }),
  retentionDays: integer("retention_days").notNull().default(90),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  verifiedByUserId: integer("verified_by_user_id"),
  verificationNotes: text("verification_notes"),
  // Test restore result: "not_tested" | "restored_ok" | "restore_failed"
  restoreTestResult: varchar("restore_test_result", { length: 20 }).notNull().default("not_tested"),
  restoreTestedAt: timestamp("restore_tested_at"),
  initiatedByUserId: integer("initiated_by_user_id"),
  serverCode: varchar("server_code", { length: 30 }).notNull().default("HQ"),
  errorMessage: text("error_message"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BackupRecord = typeof backupRecordsTable.$inferSelect;
