import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Competency frameworks and individual competencies.
export const competencyFrameworksTable = pgTable("competency_frameworks", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // "core" | "leadership" | "technical" | "functional"
  frameworkType: varchar("framework_type", { length: 30 }).notNull().default("core"),
  // Job families or grades this applies to (comma-separated codes or "all")
  applicableTo: varchar("applicable_to", { length: 500 }).notNull().default("all"),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  isActive: boolean("is_active").notNull().default(true),
  version: varchar("version", { length: 10 }).notNull().default("1.0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const competenciesTable = pgTable("competencies", {
  id: serial("id").primaryKey(),
  frameworkId: integer("framework_id").notNull(),
  codeEn: varchar("code_en", { length: 30 }).notNull(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // Level descriptors (what each score 1-5 means)
  level1En: text("level_1_en"),
  level2En: text("level_2_en"),
  level3En: text("level_3_en"),
  level4En: text("level_4_en"),
  level5En: text("level_5_en"),
  weight: integer("weight").notNull().default(20),  // % weight in appraisal
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CompetencyFramework = typeof competencyFrameworksTable.$inferSelect;
export type Competency = typeof competenciesTable.$inferSelect;
