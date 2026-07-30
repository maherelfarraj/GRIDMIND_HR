import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Organization-wide configuration and feature flags.
// organizationType controls which defense features are enabled.
export const systemConfigTable = pgTable("system_config", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 80 }).notNull().unique(),
  value: text("value").notNull(),
  // "string" | "boolean" | "number" | "json"
  valueType: varchar("value_type", { length: 20 }).notNull().default("string"),
  category: varchar("category", { length: 60 }).notNull().default("general"),
  labelEn: varchar("label_en", { length: 200 }).notNull(),
  labelAr: varchar("label_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  isPublic: boolean("is_public").notNull().default(false),
  isReadonly: boolean("is_readonly").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SystemConfig = typeof systemConfigTable.$inferSelect;
