import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Military rank definitions. Applicable when organizationType = "military".
// Civilians and government employees use grade/step from salaryGrades instead.
export const militaryRanksTable = pgTable("military_ranks", {
  id: serial("id").primaryKey(),
  rankCode: varchar("rank_code", { length: 20 }).notNull().unique(),
  abbreviationEn: varchar("abbreviation_en", { length: 20 }).notNull(),
  abbreviationAr: varchar("abbreviation_ar", { length: 20 }).notNull(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  // "enlisted" | "nco" | "officer" | "warrant" | "general" | "flag"
  category: varchar("category", { length: 30 }).notNull().default("enlisted"),
  // NATO-equivalent pay grade (OR-1 through OR-9, WO1-WO5, OF-1 through OF-10)
  natoEquivalent: varchar("nato_equivalent", { length: 10 }),
  // Ordinal for sorting/comparison (higher = more senior)
  rankOrder: integer("rank_order").notNull().default(0),
  // Map to salary grade code if applicable
  salaryGradeCode: varchar("salary_grade_code", { length: 20 }),
  // "military" | "government" | "commercial"
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("military"),
  insigniaDescription: text("insignia_description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MilitaryRank = typeof militaryRanksTable.$inferSelect;
