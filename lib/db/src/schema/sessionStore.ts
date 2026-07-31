import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Express session store table used by connect-pg-simple.
 * Declared here so drizzle-kit push does not drop it as an "extra" table.
 * Shape must match connect-pg-simple's expected table definition.
 */
export const sessionStoreTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);
