import { pgTable, text, integer, bigint, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent login-throttle state so brute-force lockouts survive an API
 * server restart. One row per throttle key ("user:<name>" or "ip:<addr>").
 * The api-server keeps an in-memory copy as the source of truth and
 * write-throughs changes here; rows are hydrated at process start.
 */
export const loginThrottleTable = pgTable("login_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: bigint("locked_until", { mode: "number" }), // epoch ms, null = not locked
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LoginThrottleRow = typeof loginThrottleTable.$inferSelect;
