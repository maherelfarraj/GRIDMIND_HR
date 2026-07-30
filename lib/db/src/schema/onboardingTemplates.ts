import { pgTable, serial, varchar, boolean, timestamp, text, integer } from "drizzle-orm/pg-core";

// Reusable onboarding checklist template per employment type / org type.
export const onboardingTemplatesTable = pgTable("onboarding_templates", {
  id: serial("id").primaryKey(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  // "full_time" | "contract" | "military" | "government"
  targetEmploymentType: varchar("target_employment_type", { length: 30 }).notNull().default("full_time"),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  departmentId: integer("department_id"),  // null = applies to all departments
  totalTasks: integer("total_tasks").notNull().default(0),
  estimatedDays: integer("estimated_days").notNull().default(30),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const onboardingTemplateItemsTable = pgTable("onboarding_template_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  titleEn: varchar("title_en", { length: 300 }).notNull(),
  titleAr: varchar("title_ar", { length: 300 }).notNull(),
  descriptionEn: text("description_en"),
  // "hr" | "it" | "security" | "manager" | "employee" | "finance" | "admin"
  ownerRole: varchar("owner_role", { length: 30 }).notNull().default("hr"),
  // "document" | "equipment" | "training" | "meeting" | "system_access" | "id_card" | "general"
  taskType: varchar("task_type", { length: 30 }).notNull().default("general"),
  dueDayOffset: integer("due_day_offset").notNull().default(1),  // days after start date
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OnboardingTemplate = typeof onboardingTemplatesTable.$inferSelect;
export type OnboardingTemplateItem = typeof onboardingTemplateItemsTable.$inferSelect;
