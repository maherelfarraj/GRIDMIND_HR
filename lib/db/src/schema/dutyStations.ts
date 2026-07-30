import { pgTable, serial, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Physical posting locations / duty stations.
export const dutyStationsTable = pgTable("duty_stations", {
  id: serial("id").primaryKey(),
  stationCode: varchar("station_code", { length: 20 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  country: varchar("country", { length: 60 }).notNull().default("Saudi Arabia"),
  region: varchar("region", { length: 100 }),
  city: varchar("city", { length: 100 }),
  address: text("address"),
  // Decimal degrees stored as text for air-gap/no-map compatibility
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  // "main_base" | "forward_base" | "headquarters" | "training_center" | "administrative" | "joint"
  stationType: varchar("station_type", { length: 40 }).notNull().default("administrative"),
  // "unclassified" | "restricted" | "confidential" | "secret" | "top_secret"
  classificationLevel: varchar("classification_level", { length: 20 }).notNull().default("unclassified"),
  commandingUnitCode: varchar("commanding_unit_code", { length: 30 }),
  timezoneName: varchar("timezone_name", { length: 60 }).notNull().default("Asia/Riyadh"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DutyStation = typeof dutyStationsTable.$inferSelect;
