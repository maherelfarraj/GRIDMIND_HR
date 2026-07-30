import { pgTable, serial, integer, varchar, boolean, timestamp, text, numeric } from "drizzle-orm/pg-core";

// Training programs, courses, sessions, nominations, attendance and certifications.

export const trainingProgramsTable = pgTable("training_programs", {
  id: serial("id").primaryKey(),
  codeEn: varchar("code_en", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 300 }).notNull(),
  nameAr: varchar("name_ar", { length: 300 }).notNull(),
  descriptionEn: text("description_en"),
  // "technical" | "leadership" | "compliance" | "onboarding" | "safety" | "military" | "language"
  category: varchar("category", { length: 40 }).notNull().default("technical"),
  organizationType: varchar("organization_type", { length: 30 }).notNull().default("commercial"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const trainingCoursesTable = pgTable("training_courses", {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull(),
  codeEn: varchar("code_en", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 300 }).notNull(),
  nameAr: varchar("name_ar", { length: 300 }).notNull(),
  descriptionEn: text("description_en"),
  // "classroom" | "online" | "blended" | "on_the_job" | "simulation"
  deliveryMode: varchar("delivery_mode", { length: 30 }).notNull().default("classroom"),
  durationHours: integer("duration_hours").notNull().default(8),
  maxParticipants: integer("max_participants").notNull().default(20),
  // "internal" | "external"
  providerType: varchar("provider_type", { length: 20 }).notNull().default("internal"),
  providerName: varchar("provider_name", { length: 200 }),
  costPerPerson: numeric("cost_per_person", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
  grantsCertification: boolean("grants_certification").notNull().default(false),
  certificationValidMonths: integer("certification_valid_months"),
  prerequisitesEn: text("prerequisites_en"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const trainingSessionsTable = pgTable("training_sessions", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull(),
  sessionCode: varchar("session_code", { length: 30 }).notNull().unique(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  startTime: varchar("start_time", { length: 8 }),
  endTime: varchar("end_time", { length: 8 }),
  location: varchar("location", { length: 200 }),
  dutyStationId: integer("duty_station_id"),
  trainerName: varchar("trainer_name", { length: 200 }),
  trainerEmployeeId: integer("trainer_employee_id"),
  // "scheduled" | "confirmed" | "in_progress" | "completed" | "cancelled" | "postponed"
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  maxParticipants: integer("max_participants").notNull().default(20),
  enrolledCount: integer("enrolled_count").notNull().default(0),
  attendedCount: integer("attended_count").notNull().default(0),
  passingScore: integer("passing_score"),   // % to pass assessment
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const courseNominationsTable = pgTable("course_nominations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  // "self" | "manager" | "hr" | "mandatory"
  nominationSource: varchar("nomination_source", { length: 20 }).notNull().default("manager"),
  nominatedByEmployeeId: integer("nominated_by_employee_id"),
  // "pending" | "approved" | "waitlisted" | "rejected" | "cancelled" | "enrolled"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  approvedByUserId: integer("approved_by_user_id"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const trainingAttendanceTable = pgTable("training_attendance", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  nominationId: integer("nomination_id"),
  // "present" | "absent" | "partial" | "excused"
  attendanceStatus: varchar("attendance_status", { length: 20 }).notNull().default("present"),
  attendancePct: integer("attendance_pct").notNull().default(100),
  assessmentScore: integer("assessment_score"),    // 0-100
  passed: boolean("passed"),
  completedAt: timestamp("completed_at"),
  certificateIssued: boolean("certificate_issued").notNull().default(false),
  certificateIssuedAt: timestamp("certificate_issued_at"),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const certificationsTable = pgTable("certifications", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  courseId: integer("course_id"),
  sessionId: integer("session_id"),
  // External certs (no session link)
  certificationName: varchar("certification_name", { length: 300 }).notNull(),
  issuingBody: varchar("issuing_body", { length: 200 }),
  certificationNumber: varchar("certification_number", { length: 100 }),
  issuedDate: varchar("issued_date", { length: 10 }).notNull(),
  expiryDate: varchar("expiry_date", { length: 10 }),
  // "active" | "expired" | "revoked" | "pending_renewal"
  status: varchar("status", { length: 30 }).notNull().default("active"),
  renewalReminderSent: boolean("renewal_reminder_sent").notNull().default(false),
  documentId: integer("document_id"),
  // "internal" | "external" | "government" | "military"
  certType: varchar("cert_type", { length: 20 }).notNull().default("internal"),
  verificationUrl: varchar("verification_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const employeeSkillsTable = pgTable("employee_skills", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  skillName: varchar("skill_name", { length: 200 }).notNull(),
  skillCategory: varchar("skill_category", { length: 80 }),  // "technical" | "soft" | "language" | "military"
  // 1=Awareness, 2=Beginner, 3=Proficient, 4=Advanced, 5=Expert
  proficiencyLevel: integer("proficiency_level").notNull().default(1),
  // "self_assessed" | "manager_assessed" | "test_verified" | "certified"
  assessmentMethod: varchar("assessment_method", { length: 30 }).notNull().default("self_assessed"),
  certificationId: integer("certification_id"),
  lastAssessedAt: timestamp("last_assessed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TrainingProgram = typeof trainingProgramsTable.$inferSelect;
export type TrainingCourse = typeof trainingCoursesTable.$inferSelect;
export type TrainingSession = typeof trainingSessionsTable.$inferSelect;
export type CourseNomination = typeof courseNominationsTable.$inferSelect;
export type TrainingAttendance = typeof trainingAttendanceTable.$inferSelect;
export type Certification = typeof certificationsTable.$inferSelect;
export type EmployeeSkill = typeof employeeSkillsTable.$inferSelect;
