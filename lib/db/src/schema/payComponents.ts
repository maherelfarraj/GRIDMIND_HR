import { pgTable, serial, varchar, integer, boolean, timestamp, numeric, text } from "drizzle-orm/pg-core";

export const payComponentsTable = pgTable("pay_components", {
  id: serial("id").primaryKey(),
  codeEn: varchar("code_en", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  // earning | deduction | benefit
  type: varchar("type", { length: 20 }).notNull(),
  // fixed | percentage | per_day | per_hour
  calculationMethod: varchar("calculation_method", { length: 20 }).notNull().default("fixed"),
  value: numeric("value", { precision: 10, scale: 4 }).notNull().default("0"),
  // base_salary | gross_salary (for percentage-based)
  percentageBase: varchar("percentage_base", { length: 30 }),
  isTaxable: boolean("is_taxable").notNull().default(false),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  // all | commercial | government | military
  applicableTo: varchar("applicable_to", { length: 30 }).notNull().default("all"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PayComponent = typeof payComponentsTable.$inferSelect;
