import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Explicit chain-of-command relationships between personnel.
// Supplements the org unit hierarchy for cases where CoC crosses unit boundaries.
export const chainOfCommandTable = pgTable("chain_of_command", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  supervisorEmployeeId: integer("supervisor_employee_id").notNull(),
  // "direct" | "functional" | "dotted_line" | "secondment" | "acting"
  relationshipType: varchar("relationship_type", { length: 30 }).notNull().default("direct"),
  effectiveFrom: varchar("effective_from", { length: 10 }).notNull(),  // YYYY-MM-DD
  effectiveTo: varchar("effective_to", { length: 10 }),
  isActive: boolean("is_active").notNull().default(true),
  notesEn: text("notes_en"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ChainOfCommandEntry = typeof chainOfCommandTable.$inferSelect;
