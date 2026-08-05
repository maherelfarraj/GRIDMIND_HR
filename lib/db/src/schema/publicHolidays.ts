import { pgTable, serial, varchar, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";

export const publicHolidaysTable = pgTable("public_holidays", {
  id: serial("id").primaryKey(),
  // null = global holiday visible to every organization
  orgId: integer("org_id"),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  date: text("date").notNull(),
  year: integer("year").notNull(),
  isRecurring: boolean("is_recurring").notNull().default(false),
  // all | commercial | government | military
  applicableTo: varchar("applicable_to", { length: 30 }).notNull().default("all"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PublicHoliday = typeof publicHolidaysTable.$inferSelect;
