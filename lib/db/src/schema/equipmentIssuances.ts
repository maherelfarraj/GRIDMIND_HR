import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Equipment, assets and ID card issuance tracking.
export const equipmentIssuancesTable = pgTable("equipment_issuances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  onboardingId: integer("onboarding_id"),
  // "laptop" | "phone" | "tablet" | "access_card" | "uniform" | "vehicle" | "tools" | "other"
  itemType: varchar("item_type", { length: 40 }).notNull(),
  itemDescription: varchar("item_description", { length: 300 }).notNull(),
  serialNumber: varchar("serial_number", { length: 80 }),
  assetTag: varchar("asset_tag", { length: 60 }),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  issuedByUserId: integer("issued_by_user_id"),
  returnDueDate: varchar("return_due_date", { length: 10 }),
  returnedAt: timestamp("returned_at"),
  returnedByEmployeeId: integer("returned_by_employee_id"),
  receivedByUserId: integer("received_by_user_id"),
  // "issued" | "returned" | "lost" | "damaged" | "transferred"
  status: varchar("status", { length: 20 }).notNull().default("issued"),
  condition: varchar("condition", { length: 30 }).notNull().default("good"),  // "new" | "good" | "fair" | "poor"
  notes: text("notes"),
  employeeSignature: boolean("employee_signature").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const idCardRecordsTable = pgTable("id_card_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  cardNumber: varchar("card_number", { length: 60 }).notNull(),
  // "employee" | "contractor" | "visitor" | "military" | "government"
  cardType: varchar("card_type", { length: 30 }).notNull().default("employee"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiryDate: varchar("expiry_date", { length: 10 }),
  // "active" | "expired" | "lost" | "damaged" | "cancelled" | "replaced"
  status: varchar("status", { length: 20 }).notNull().default("active"),
  replacedByCardId: integer("replaced_by_card_id"),
  replacementReason: varchar("replacement_reason", { length: 200 }),
  issuedByUserId: integer("issued_by_user_id"),
  revokedAt: timestamp("revoked_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EquipmentIssuance = typeof equipmentIssuancesTable.$inferSelect;
export type IdCardRecord = typeof idCardRecordsTable.$inferSelect;
