import { pgTable, serial, integer, varchar, boolean, timestamp, text } from "drizzle-orm/pg-core";

// Vacancy announcement linked to an approved requisition.
export const jobPostingsTable = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  postingCode: varchar("posting_code", { length: 30 }).notNull().unique(),
  requisitionId: integer("requisition_id").notNull(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleAr: varchar("title_ar", { length: 200 }).notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  requirementsEn: text("requirements_en"),
  qualificationsEn: text("qualifications_en"),
  // "internal" | "external" | "both"
  visibility: varchar("visibility", { length: 20 }).notNull().default("both"),
  publishedAt: timestamp("published_at"),
  closingDate: varchar("closing_date", { length: 10 }),
  // "draft" | "published" | "closed" | "on_hold" | "cancelled"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  applicationCount: integer("application_count").notNull().default(0),
  departmentId: integer("department_id").notNull(),
  dutyStationId: integer("duty_station_id"),
  postedByUserId: integer("posted_by_user_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type JobPosting = typeof jobPostingsTable.$inferSelect;
