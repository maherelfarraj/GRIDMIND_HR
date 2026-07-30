/**
 * Schema drift check — fails loudly when the live database is missing
 * tables or columns that are declared in the lib/db drizzle schema,
 * and when the live DB carries tables/columns that the schema no longer
 * declares (reverse drift), or when basic column types/nullability
 * disagree between the two.
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

interface DeclaredColumn {
  name: string;
  sqlType: string;
  notNull: boolean;
}

interface DeclaredTable {
  tableName: string;
  columns: DeclaredColumn[];
}

// Collect every pgTable exported from the shared schema package.
const declaredTables: DeclaredTable[] = Object.values(schema)
  .filter((v) => v instanceof PgTable)
  .map((table) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = getTableConfig(table as any);
    return {
      tableName: config.name,
      columns: config.columns.map((c) => ({
        name: c.name,
        sqlType: c.getSQLType(),
        notNull: c.notNull,
      })),
    };
  })
  .sort((a, b) => a.tableName.localeCompare(b.tableName));

// Live tables that are legitimately outside the drizzle schema
// (infra/bookkeeping tables managed by other tooling).
const IGNORED_LIVE_TABLES = new Set([
  "__drizzle_migrations",
  "drizzle_migrations",
  "session",
  "sessions",
]);

/**
 * Normalize a type name so drizzle's getSQLType() output and
 * information_schema.data_type can be compared. Returns null when we
 * cannot confidently map the type (in which case comparison is skipped
 * rather than producing false positives).
 */
function normalizeType(raw: string): string | null {
  let t = raw.toLowerCase().trim();
  // Strip length/precision qualifiers: varchar(255) -> varchar
  t = t.replace(/\(.*\)/, "").trim();
  const aliases: Record<string, string> = {
    serial: "integer",
    bigserial: "bigint",
    smallserial: "smallint",
    int: "integer",
    int4: "integer",
    int8: "bigint",
    int2: "smallint",
    varchar: "character varying",
    "character varying": "character varying",
    char: "character",
    bool: "boolean",
    float4: "real",
    float8: "double precision",
    "double precision": "double precision",
    decimal: "numeric",
    timestamptz: "timestamp with time zone",
    "timestamp with time zone": "timestamp with time zone",
    timestamp: "timestamp without time zone",
    "timestamp without time zone": "timestamp without time zone",
    timetz: "time with time zone",
    time: "time without time zone",
    "time without time zone": "time without time zone",
    "time with time zone": "time with time zone",
  };
  if (t.endsWith("[]")) return "array";
  if (t === "array") return "array";
  if (t in aliases) return aliases[t];
  // Common direct matches we trust as-is.
  const passthrough = new Set([
    "integer",
    "bigint",
    "smallint",
    "boolean",
    "text",
    "numeric",
    "real",
    "date",
    "json",
    "jsonb",
    "uuid",
    "character",
    "bytea",
    "interval",
  ]);
  if (passthrough.has(t)) return t;
  // Enums, user-defined types, vectors, etc. — skip comparison.
  return null;
}

describe("database schema drift", () => {
  it("collects a meaningful set of declared tables", () => {
    // Sanity guard: if schema exports change shape, this test must not
    // silently pass by comparing an empty list.
    expect(declaredTables.length).toBeGreaterThan(50);
  });

  interface LiveColumn {
    dataType: string;
    isNullable: boolean;
  }

  async function fetchLiveTables(): Promise<Map<string, Map<string, LiveColumn>>> {
    const result = await db.execute(sql`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const rows = result.rows as {
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }[];

    const liveTables = new Map<string, Map<string, LiveColumn>>();
    for (const row of rows) {
      if (!liveTables.has(row.table_name)) {
        liveTables.set(row.table_name, new Map());
      }
      liveTables.get(row.table_name)!.set(row.column_name, {
        dataType: row.data_type,
        isNullable: row.is_nullable === "YES",
      });
    }
    return liveTables;
  }

  it("live DB has every table and column declared in lib/db schema", async () => {
    const liveTables = await fetchLiveTables();

    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    for (const { tableName, columns } of declaredTables) {
      const live = liveTables.get(tableName);
      if (!live) {
        missingTables.push(tableName);
        continue;
      }
      for (const col of columns) {
        if (!live.has(col.name)) {
          missingColumns.push(`${tableName}.${col.name}`);
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

  it("live DB has no tables or columns absent from the lib/db schema (reverse drift)", async () => {
    const liveTables = await fetchLiveTables();

    const declaredByName = new Map(
      declaredTables.map((t) => [
        t.tableName,
        new Set(t.columns.map((c) => c.name)),
      ]),
    );

    const extraTables: string[] = [];
    const extraColumns: string[] = [];

    for (const [tableName, liveCols] of liveTables) {
      if (IGNORED_LIVE_TABLES.has(tableName)) continue;
      const declared = declaredByName.get(tableName);
      if (!declared) {
        extraTables.push(tableName);
        continue;
      }
      for (const colName of liveCols.keys()) {
        if (!declared.has(colName)) {
          extraColumns.push(`${tableName}.${colName}`);
        }
      }
    }

    const problems: string[] = [];
    if (extraTables.length) {
      problems.push(
        `Tables present in the live DB but not declared in lib/db schema (dead data or a dropped table never cleaned up):\n  - ${extraTables.sort().join("\n  - ")}`,
      );
    }
    if (extraColumns.length) {
      problems.push(
        `Columns present in the live DB but not declared in lib/db schema:\n  - ${extraColumns.sort().join("\n  - ")}`,
      );
    }
    if (problems.length) {
      problems.push(
        "Fix: either restore the declaration in lib/db/src/schema/, or drop the stale table/column from the DB (drizzle-kit push after removing it from the schema). If the table is intentionally managed outside drizzle, add it to IGNORED_LIVE_TABLES in this test.",
      );
    }

    expect(problems, problems.join("\n\n")).toEqual([]);
  });

  it("declared column types and nullability match the live DB", async () => {
    const liveTables = await fetchLiveTables();

    const typeMismatches: string[] = [];
    const nullabilityMismatches: string[] = [];
    let compared = 0;

    for (const { tableName, columns } of declaredTables) {
      const live = liveTables.get(tableName);
      if (!live) continue; // reported by the missing-tables test
      for (const col of columns) {
        const liveCol = live.get(col.name);
        if (!liveCol) continue; // reported by the missing-columns test

        const declaredType = normalizeType(col.sqlType);
        const liveType = normalizeType(liveCol.dataType);
        if (declaredType && liveType) {
          compared++;
          if (declaredType !== liveType) {
            typeMismatches.push(
              `${tableName}.${col.name}: schema declares "${col.sqlType}" but DB has "${liveCol.dataType}"`,
            );
          }
        }

        if (col.notNull === liveCol.isNullable) {
          // notNull=true with isNullable=true, or notNull=false with isNullable=false
          nullabilityMismatches.push(
            `${tableName}.${col.name}: schema says ${col.notNull ? "NOT NULL" : "nullable"} but DB says ${liveCol.isNullable ? "nullable" : "NOT NULL"}`,
          );
        }
      }
    }

    // Sanity guard: the type comparison must actually cover a meaningful
    // number of columns, otherwise normalization broke and the test would
    // pass vacuously.
    expect(compared).toBeGreaterThan(100);

    const problems: string[] = [];
    if (typeMismatches.length) {
      problems.push(
        `Column type mismatches between lib/db schema and the live DB:\n  - ${typeMismatches.join("\n  - ")}`,
      );
    }
    if (nullabilityMismatches.length) {
      problems.push(
        `Nullability mismatches between lib/db schema and the live DB:\n  - ${nullabilityMismatches.join("\n  - ")}`,
      );
    }
    if (problems.length) {
      problems.push(
        "Fix: align lib/db/src/schema/ with the DB (or push the schema with drizzle-kit push) — see .agents/memory/db-dist-staleness.md.",
      );
    }

    expect(problems, problems.join("\n\n")).toEqual([]);
  });
});
