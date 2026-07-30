import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemUsersTable = pgTable("system_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  fullNameEn: text("full_name_en").notNull(),
  fullNameAr: text("full_name_ar").notNull(),
  roleId: integer("role_id").notNull(),
  employeeId: integer("employee_id"),
  isActive: boolean("is_active").notNull().default(true),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSystemUserSchema = createInsertSchema(systemUsersTable).omit({ id: true, createdAt: true, lastLoginAt: true, passwordHash: true });
export type InsertSystemUser = z.infer<typeof insertSystemUserSchema>;
export type SystemUser = typeof systemUsersTable.$inferSelect;
