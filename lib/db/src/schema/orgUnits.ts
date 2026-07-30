import { pgTable, serial, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Organizational unit hierarchy: commands, formations, directorates, units, etc.
// Self-referential parentId creates an arbitrary-depth tree.
export const orgUnitsTable = pgTable("org_units", {
  id: serial("id").primaryKey(),
  unitCode: varchar("unit_code", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  shortNameEn: varchar("short_name_en", { length: 60 }),
  shortNameAr: varchar("short_name_ar", { length: 60 }),
  // "command" | "hq" | "directorate" | "formation" | "brigade" | "battalion" |
  // "company" | "platoon" | "section" | "department" | "division" | "branch"
  unitType: varchar("unit_type", { length: 40 }).notNull().default("department"),
  // "military" | "government" | "commercial"
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  parentId: integer("parent_id"),  // self-ref → orgUnitsTable.id
  // Employee ID of the commanding officer / director
  commanderEmployeeId: integer("commander_employee_id"),
  missionEn: text("mission_en"),
  // Hierarchical level (1 = top command, higher numbers = subordinate)
  levelDepth: integer("level_depth").notNull().default(1),
  // Maximum authorized headcount
  authorizedStrength: integer("authorized_strength"),
  currentStrength: integer("current_strength").notNull().default(0),
  // Location / duty station code
  locationCode: varchar("location_code", { length: 30 }),
  // Security classification required to view this unit's records
  // "unclassified" | "restricted" | "confidential" | "secret" | "top_secret"
  classificationLevel: varchar("classification_level", { length: 20 }).notNull().default("unclassified"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OrgUnit = typeof orgUnitsTable.$inferSelect;
