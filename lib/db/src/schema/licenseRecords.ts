import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Local license management for air-gap deployments.
export const licenseRecordsTable = pgTable("license_records", {
  id: serial("id").primaryKey(),
  productName: varchar("product_name", { length: 100 }).notNull().default("HRMS Command"),
  // "community" | "standard" | "enterprise" | "defense" | "evaluation"
  edition: varchar("edition", { length: 30 }).notNull().default("enterprise"),
  // SHA-256 hash of the actual license key (key is never stored in plaintext)
  licenseKeyHash: varchar("license_key_hash", { length: 128 }).notNull(),
  issuedTo: varchar("issued_to", { length: 200 }),
  issuedToOrgCode: varchar("issued_to_org_code", { length: 30 }),
  maxUsers: integer("max_users").notNull().default(100),
  maxBranches: integer("max_branches").notNull().default(5),
  validFrom: varchar("valid_from", { length: 10 }).notNull(),   // YYYY-MM-DD
  validUntil: varchar("valid_until", { length: 10 }),           // null = perpetual
  // JSON array of enabled feature modules
  featuresJson: text("features_json"),
  isActive: boolean("is_active").notNull().default(true),
  activatedAt: timestamp("activated_at"),
  lastValidatedAt: timestamp("last_validated_at"),
  // "online" | "offline" | "hardware_token"
  validationMethod: varchar("validation_method", { length: 30 }).notNull().default("offline"),
  validationNotes: text("validation_notes"),
  offlineGraceDays: integer("offline_grace_days").notNull().default(30),
  nextValidationDue: varchar("next_validation_due", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LicenseRecord = typeof licenseRecordsTable.$inferSelect;
