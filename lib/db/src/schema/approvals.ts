import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  titleEn: text("title_en").notNull(),
  titleAr: text("title_ar").notNull(),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  requestedByEmployeeId: integer("requested_by_employee_id").notNull(),
  assignedToUserId: integer("assigned_to_user_id"),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  dueDate: text("due_date"),
  metadata: text("metadata"),
  /** Queryable link to the underlying record (replaces metadata scanning). */
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("approvals_entity_idx").on(t.entityType, t.entityId),
]);

export const insertApprovalSchema = createInsertSchema(approvalsTable).omit({ id: true, createdAt: true, decidedAt: true });
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvalsTable.$inferSelect;
