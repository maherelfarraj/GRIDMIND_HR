import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityAlertsTable = pgTable("security_alerts", {
  id: serial("id").primaryKey(),
  severity: text("severity").notNull().default("medium"),
  titleEn: text("title_en").notNull(),
  titleAr: text("title_ar").notNull(),
  descriptionEn: text("description_en").notNull(),
  descriptionAr: text("description_ar").notNull(),
  category: text("category").notNull().default("system"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedByUserId: integer("acknowledged_by_user_id"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedNote: text("acknowledged_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSecurityAlertSchema = createInsertSchema(securityAlertsTable).omit({ id: true, createdAt: true, acknowledgedAt: true });
export type InsertSecurityAlert = z.infer<typeof insertSecurityAlertSchema>;
export type SecurityAlert = typeof securityAlertsTable.$inferSelect;
