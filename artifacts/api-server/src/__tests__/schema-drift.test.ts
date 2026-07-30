/**
 * Schema drift check — fails loudly when the live database is missing
 * tables or columns that are declared in the lib/db drizzle schema.
 *
 * This catches the class of failure where a schema edit is committed but
 * never pushed to the database (e.g. integration_connection_profiles once
 * lacked last_test_latency_ms / last_test_simulated), which makes every
 * SELECT on the table 500 with a generic "Failed query" error.
 *
 * Read-only: only queries information_schema; creates no fixtures.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import * as schema from "@workspace/db";
import { sql } from "drizzle-orm";

interface DeclaredTable {
  tableName: string;
  columns: string[];
}

// Collect every pgTable exported from the shared schema package.
const declaredTables: DeclaredTable[] = Object.values(schema)
  .filter((v) => v instanceof PgTable)
  .map((table) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = getTableConfig(table as any);
    return {
      tableName: config.name,
      columns: config.columns.map((c) => c.name),
    };
  })
  .sort((a, b) => a.tableName.localeCompare(b.tableName));

describe("database schema drift", () => {
  it("collects a meaningful set of declared tables", () => {
    // Sanity guard: if schema exports change shape, this test must not
    // silently pass by comparing an empty list.
    expect(declaredTables.length).toBeGreaterThan(50);
  });

  it("live DB has every table and column declared in lib/db schema", async () => {
    const result = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const rows = result.rows as { table_name: string; column_name: string }[];

    const liveTables = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!liveTables.has(row.table_name)) {
        liveTables.set(row.table_name, new Set());
      }
      liveTables.get(row.table_name)!.add(row.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    for (const { tableName, columns } of declaredTables) {
      const live = liveTables.get(tableName);
      if (!live) {
        missingTables.push(tableName);
        continue;
      }
      for (const col of columns) {
        if (!live.has(col)) {
          missingColumns.push(`${tableName}.${col}`);
        }
      }
    }

    const problems: string[] = [];
    if (missingTables.length) {
      problems.push(
        `Tables declared in lib/db schema but missing from the live DB:\n  - ${missingTables.join("\n  - ")}`,
      );
    }
    if (missingColumns.length) {
      problems.push(
        `Columns declared in lib/db schema but missing from the live DB:\n  - ${missingColumns.join("\n  - ")}`,
      );
    }
    if (problems.length) {
      problems.push(
        "Fix: rebuild lib/db (pnpm --filter @workspace/db run build) and push the schema (drizzle-kit push) — see .agents/memory/db-dist-staleness.md.",
      );
    }

    expect(problems, problems.join("\n\n")).toEqual([]);
  });
});
