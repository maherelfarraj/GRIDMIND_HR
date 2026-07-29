import { pgTable, serial, varchar, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";

export const salaryGradesTable = pgTable("salary_grades", {
  id: serial("id").primaryKey(),
  gradeCode: varchar("grade_code", { length: 20 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  step: integer("step").notNull().default(1),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  housingAllowancePct: numeric("housing_allowance_pct", { precision: 5, scale: 2 }).notNull().default("25"),
  transportAllowancePct: numeric("transport_allowance_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
  // commercial | government | military
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SalaryGrade = typeof salaryGradesTable.$inferSelect;
