import { pgTable, serial, integer, varchar, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

// Manpower requisition — headcount request from a department/unit manager.
export const jobRequisitionsTable = pgTable("job_requisitions", {
  id: serial("id").primaryKey(),
  requisitionNumber: varchar("requisition_number", { length: 30 }).notNull().unique(),
  // Department / org unit requesting the hire
  departmentId: integer("department_id").notNull(),
  orgUnitId: integer("org_unit_id"),
  jobTitleEn: varchar("job_title_en", { length: 200 }).notNull(),
  jobTitleAr: varchar("job_title_ar", { length: 200 }).notNull(),
  jobDescriptionEn: text("job_description_en"),
  gradeCode: varchar("grade_code", { length: 20 }),
  headcount: integer("headcount").notNull().default(1),
  // "new_headcount" | "replacement" | "expansion"
  requisitionType: varchar("requisition_type", { length: 30 }).notNull().default("new_headcount"),
  // "internal" | "external" | "both"
  sourcingStrategy: varchar("sourcing_strategy", { length: 20 }).notNull().default("both"),
  // "full_time" | "part_time" | "contract" | "temporary"
  employmentType: varchar("employment_type", { length: 30 }).notNull().default("full_time"),
  budgetedSalaryMin: numeric("budgeted_salary_min", { precision: 12, scale: 2 }),
  budgetedSalaryMax: numeric("budgeted_salary_max", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
  targetStartDate: varchar("target_start_date", { length: 10 }),
  justification: text("justification"),
  // "low" | "medium" | "high" | "urgent"
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  // "draft" | "submitted" | "approved" | "rejected" | "on_hold" | "closed" | "filled"
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  requestedByEmployeeId: integer("requested_by_employee_id").notNull(),
  approvedByEmployeeId: integer("approved_by_employee_id"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  closedAt: timestamp("closed_at"),
  // org type gate
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type JobRequisition = typeof jobRequisitionsTable.$inferSelect;
