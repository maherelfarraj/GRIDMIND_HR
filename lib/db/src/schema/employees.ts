import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeNumber: text("employee_number").notNull().unique(),
  firstNameEn: text("first_name_en").notNull(),
  lastNameEn: text("last_name_en").notNull(),
  firstNameAr: text("first_name_ar").notNull(),
  lastNameAr: text("last_name_ar").notNull(),
  nationalId: text("national_id").notNull(),
  jobTitleEn: text("job_title_en").notNull(),
  jobTitleAr: text("job_title_ar").notNull(),
  departmentId: integer("department_id").notNull(),
  managerId: integer("manager_id"),
  roleId: integer("role_id").notNull(),
  status: text("status").notNull().default("active"),
  employmentType: text("employment_type").notNull().default("full_time"),
  grade: text("grade"),
  rankEn: text("rank_en"),
  rankAr: text("rank_ar"),
  email: text("email").notNull(),
  phone: text("phone"),
  hireDate: text("hire_date").notNull(),
  contractEndDate: text("contract_end_date"),
  // Explicit last working day set by HR when the employee leaves.
  // Payroll proration prefers this over contract-derived termination dates.
  terminationDate: text("termination_date"),
  nationality: text("nationality").notNull(),
  photoUrl: text("photo_url"),
  organizationType: text("organization_type").notNull().default("commercial"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
