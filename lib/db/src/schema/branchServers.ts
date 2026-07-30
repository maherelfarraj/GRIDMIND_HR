import { pgTable, serial, varchar, boolean, timestamp, text, integer } from "drizzle-orm/pg-core";

// Registered branch/field servers for HQ-to-branch synchronization (air-gap model).
export const branchServersTable = pgTable("branch_servers", {
  id: serial("id").primaryKey(),
  serverCode: varchar("server_code", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  location: varchar("location", { length: 200 }),
  orgUnitCode: varchar("org_unit_code", { length: 30 }),
  ipAddress: varchar("ip_address", { length: 60 }),
  // SHA-256 fingerprint of the server's TLS certificate public key
  publicKeyHash: varchar("public_key_hash", { length: 128 }),
  // "active" | "offline" | "maintenance" | "decommissioned" | "pending_registration"
  status: varchar("status", { length: 30 }).notNull().default("pending_registration"),
  syncEnabled: boolean("sync_enabled").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 30 }),
  pendingSyncCount: integer("pending_sync_count").notNull().default(0),
  adminEmail: varchar("admin_email", { length: 200 }),
  softwareVersion: varchar("software_version", { length: 30 }),
  licenseKeyHash: varchar("license_key_hash", { length: 128 }),
  notes: text("notes"),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BranchServer = typeof branchServersTable.$inferSelect;
