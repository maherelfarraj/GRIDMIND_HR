import { pgTable, serial, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";
import { leaveRequestsTable } from "./leaveRequests";

export const leaveAttachmentsTable = pgTable("leave_attachments", {
  id: serial("id").primaryKey(),
  leaveRequestId: integer("leave_request_id").notNull().references(() => leaveRequestsTable.id),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 50 }),
  fileSize: integer("file_size"),
  // stored as base64 data-url for air-gap compatibility
  fileUrl: text("file_url"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export type LeaveAttachment = typeof leaveAttachmentsTable.$inferSelect;
