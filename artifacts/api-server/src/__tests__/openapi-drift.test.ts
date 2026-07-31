/**
 * OpenAPI ↔ drizzle schema drift check — fails when a component schema in
 * lib/api-spec/openapi.yaml describes properties that do not exist as
 * columns on the corresponding drizzle table in lib/db/src/schema, or
 * omits columns that the table does expose.
 *
 * This catches the class of failure where the hand-written spec drifts
 * from the real API (NotificationPreference, Notification, EscalationRule
 * and ApprovalInboxItem once described fields that didn't exist), forcing
 * UI code into raw fetch and `as any` casts.
 *
 * Matching is by convention: each drizzle table's snake_case SQL name is
 * singularized and PascalCased (notification_preferences →
 * NotificationPreference) and looked up in components.schemas. Explicit
 * overrides and per-schema allowlists below handle computed/envelope
 * fields and intentionally unexposed columns.
 *
 * Static only: reads the YAML and the drizzle table definitions; touches
 * neither the DB nor the server.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import * as dbSchema from "@workspace/db";

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Tables whose OpenAPI schema name does not follow the
 * singularize+PascalCase convention. Map: SQL table name → schema name.
 * Use `null` to explicitly opt a table out of the check (no API schema
 * exists for it, e.g. internal bookkeeping tables).
 */
const SCHEMA_NAME_OVERRIDES: Record<string, string | null> = {
  // session: infrastructure table for connect-pg-simple (express-session
  // store) — never exposed through the API, so no OpenAPI schema exists.
  session: null,
  chain_of_command: "ChainOfCommandEntry",
  rosters: "RosterEntry",
  payroll_runs: "PayrollRunDetail",
  leave_requests: "LeaveRequestDetail",
  mobilization_statuses: "MobilizationStatus",
  sync_queue: "SyncQueueEntry",
  // privileged_sessions: rebuilt 2026-07-31 with a real end-to-end flow
  // (break-glass activation opens a session, revocation closes it, security
  // officers review via /privileged-sessions). Maps by convention to
  // "PrivilegedSession".
  employee_onboarding: "EmployeeOnboarding",
  installation_readiness: "InstallationReadiness",
  connection_health_log: "ConnectionHealthLog",
  integration_retry_queue: "IntegrationRetryQueue",
  integration_event_log: "IntegrationEvent",
  ai_config: "AiConfig",
  break_glass_access: "BreakGlassAccess",
  // Audited 2026-07-31: no API route serves this table — it is only read and
  // written by the internal login-throttle library (src/lib/loginThrottle.ts);
  // no route handler returns its rows.
  login_throttle: null,
  payroll_variance_logs: "PayrollVarianceLog",
  analytics_kpi_cache: "AnalyticsKpiCache",
  workforce_snapshots: "WorkforceSnapshot",
  report_builder_configs: "ReportBuilderConfig",
};

/**
 * Properties an OpenAPI schema may carry that are NOT drizzle columns —
 * computed, joined or convenience fields the API adds when serializing.
 * Key: OpenAPI schema name.
 */
const ALLOWED_EXTRA_PROPERTIES: Record<string, string[]> = {
  PrivilegedSession: ["userName"], // joined from system_users when serializing
};

/**
 * Drizzle columns an OpenAPI schema may legitimately omit — sensitive or
 * internal columns the API never returns. Key: OpenAPI schema name.
 */
const ALLOWED_MISSING_COLUMNS: Record<string, string[]> = {
  SystemUser: ["passwordHash"], // never serialized
  GatewayRegistration: ["secretHash"], // secret material — never serialized
};

// Pre-existing drift captured as a shrink-only baseline: the test fails on
// any NEW drift, while known discrepancies are burned down over time.
import {
  KNOWN_EXTRA_PROPERTIES,
  KNOWN_MISSING_PROPERTIES,
} from "./openapi-drift-baseline";

// ─── Convention mapping ─────────────────────────────────────────────────────

function singularize(word: string): string {
  if (/(ss|us)$/.test(word)) return word; // status, access, ...
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(ches|shes|xes|sses|zes)$/.test(word)) return word.replace(/es$/, "");
  if (/s$/.test(word)) return word.replace(/s$/, "");
  return word;
}

function tableNameToSchemaName(sqlName: string): string {
  const parts = sqlName.split("_");
  parts[parts.length - 1] = singularize(parts[parts.length - 1]);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

// ─── Collect both sides ─────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../../../../lib/api-spec/openapi.yaml");
const spec = parseYaml(readFileSync(specPath, "utf8")) as {
  components?: { schemas?: Record<string, unknown> };
};
const openapiSchemas: Record<string, { type?: string; properties?: Record<string, unknown> }> =
  (spec.components?.schemas as Record<string, { type?: string; properties?: Record<string, unknown> }>) ?? {};

interface TableEntry {
  sqlName: string;
  /** camelCase TS property keys — what the API actually serializes */
  tsKeys: string[];
}

const tables: TableEntry[] = Object.values(dbSchema)
  .filter((v) => v instanceof PgTable)
  .map((table) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sqlName: getTableConfig(table as any).name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tsKeys: Object.keys(getTableColumns(table as any)),
  }))
  .sort((a, b) => a.sqlName.localeCompare(b.sqlName));

interface MatchedPair {
  sqlName: string;
  schemaName: string;
  tsKeys: string[];
  properties: string[];
}

/** Flatten a schema's properties, resolving allOf and local $refs. */
function collectProperties(schema: unknown, depth = 0): string[] {
  if (!schema || typeof schema !== "object" || depth > 5) return [];
  const s = schema as {
    $ref?: string;
    allOf?: unknown[];
    properties?: Record<string, unknown>;
  };
  if (s.$ref) {
    const name = s.$ref.replace("#/components/schemas/", "");
    return collectProperties(openapiSchemas[name], depth + 1);
  }
  const props: string[] = s.properties ? Object.keys(s.properties) : [];
  for (const part of s.allOf ?? []) {
    props.push(...collectProperties(part, depth + 1));
  }
  return [...new Set(props)];
}

const matched: MatchedPair[] = [];
const unmatchedTables: string[] = [];

for (const t of tables) {
  let schemaName: string | null | undefined = SCHEMA_NAME_OVERRIDES[t.sqlName];
  if (schemaName === null) continue; // explicitly opted out
  if (schemaName === undefined) schemaName = tableNameToSchemaName(t.sqlName);
  const schema = openapiSchemas[schemaName];
  const properties = collectProperties(schema);
  if (!properties.length) {
    unmatchedTables.push(`${t.sqlName} (expected schema "${schemaName}")`);
    continue;
  }
  matched.push({
    sqlName: t.sqlName,
    schemaName,
    tsKeys: t.tsKeys,
    properties,
  });
}

// ─── Drift computation (exported for the ratchet self-tests below) ──────────

/** Discrepancies for one matched pair, before any baseline is applied. */
export function computeDrift(
  m: Pick<MatchedPair, "schemaName" | "tsKeys" | "properties">,
  curatedExtra: Record<string, string[]>,
  curatedMissing: Record<string, string[]>,
): { extra: string[]; missing: string[] } {
  const cols = new Set(m.tsKeys);
  const props = new Set(m.properties);
  const allowedExtra = new Set(curatedExtra[m.schemaName] ?? []);
  const allowedMissing = new Set(curatedMissing[m.schemaName] ?? []);
  return {
    extra: m.properties.filter((p) => !cols.has(p) && !allowedExtra.has(p)),
    missing: m.tsKeys.filter((k) => !props.has(k) && !allowedMissing.has(k)),
  };
}

/**
 * Shrink-only ratchet: the regenerated baseline is the INTERSECTION of the
 * current discrepancies with the previously committed baseline. Entries can
 * disappear (drift fixed) but a NEW discrepancy can never enter the
 * baseline — even through the supported regeneration path it stays outside
 * and keeps failing the tests until the spec/schema is fixed.
 */
export function shrinkBaseline(
  current: Record<string, string[]>,
  previous: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [schemaName, fields] of Object.entries(current)) {
    const prev = new Set(previous[schemaName] ?? []);
    const kept = fields.filter((f) => prev.has(f));
    if (kept.length) out[schemaName] = kept;
  }
  return out;
}

/**
 * Entries present in `current` but absent from `committed` — i.e. baseline
 * growth. Used by the git-ratchet test to reject a manually widened
 * baseline file.
 */
export function baselineAdditions(
  current: Record<string, string[]>,
  committed: Record<string, string[]>,
): string[] {
  const added: string[] = [];
  for (const [schemaName, fields] of Object.entries(current)) {
    const prev = new Set(committed[schemaName] ?? []);
    for (const f of fields) {
      if (!prev.has(f)) added.push(`${schemaName}.${f}`);
    }
  }
  return added.sort();
}

/** Parse the two baseline maps out of the auto-generated baseline source. */
export function parseBaselineSource(src: string): {
  extra: Record<string, string[]>;
  missing: Record<string, string[]>;
} {
  const grab = (name: string): Record<string, string[]> => {
    const m = src.match(
      new RegExp(`${name}: Record<string, string\\[\\]> = (\\{[\\s\\S]*?\\});`),
    );
    return m ? (JSON.parse(m[1]) as Record<string, string[]>) : {};
  };
  return {
    extra: grab("KNOWN_EXTRA_PROPERTIES"),
    missing: grab("KNOWN_MISSING_PROPERTIES"),
  };
}

// ─── Baseline regeneration ──────────────────────────────────────────────────
// Run with UPDATE_OPENAPI_DRIFT_BASELINE=1 to prune fixed entries from the
// baseline file. Regeneration intersects with the committed baseline, so it
// can only SHRINK it — newly introduced drift is never absorbed and keeps
// failing the tests until the spec (or schema) is fixed.
if (process.env.UPDATE_OPENAPI_DRIFT_BASELINE === "1") {
  const extra: Record<string, string[]> = {};
      const missing = m.tsKeys.filter((k) => !props.has(k) && !allowed.has(k));

    const m = {
      schemaName: "SelfTestSchema",
      tsKeys: ["id", "name", "newColumn"],
      properties: ["id", "name"],
    };

    const m = {
      schemaName: "SelfTestSchema",
      tsKeys: ["id", "name", "newColumn"],
      properties: ["id", "name"],
    };
  for (const m of matched) {
      const d = computeDrift(m, ALLOWED_EXTRA_PROPERTIES, ALLOWED_MISSING_COLUMNS);
    if (d.extra.length) extra[m.schemaName] = d.extra;
    if (d.missing.length) missing[m.schemaName] = d.missing;
  }
  // Shrink-only: intersect with the committed baseline unless this is the
  // very first capture (both maps empty = stub).
  const isFirstCapture =
    Object.keys(KNOWN_EXTRA_PROPERTIES).length === 0 &&
    Object.keys(KNOWN_MISSING_PROPERTIES).length === 0 &&
    process.env.OPENAPI_DRIFT_BASELINE_INIT === "1";
  const nextExtra = isFirstCapture ? extra : shrinkBaseline(extra, KNOWN_EXTRA_PROPERTIES);
  const nextMissing = isFirstCapture ? missing : shrinkBaseline(missing, KNOWN_MISSING_PROPERTIES);
  const body = `/**
 * AUTO-GENERATED baseline of pre-existing drift between
 * lib/api-spec/openapi.yaml and lib/db/src/schema, captured when the
 * openapi-drift guard test was introduced. This list can only SHRINK:
 * regeneration intersects with the committed baseline, so new drift can
 * never be added here — fix the spec, or use the curated allowlists in
 * openapi-drift.test.ts for genuinely computed/omitted fields.
 *
 * Prune fixed entries with:
 *   UPDATE_OPENAPI_DRIFT_BASELINE=1 npx vitest run src/__tests__/openapi-drift.test.ts
 */

/** OpenAPI properties with no corresponding drizzle column. */
export const KNOWN_EXTRA_PROPERTIES: Record<string, string[]> = ${JSON.stringify(nextExtra, null, 2)};

/** Drizzle columns absent from the OpenAPI schema. */
export const KNOWN_MISSING_PROPERTIES: Record<string, string[]> = ${JSON.stringify(nextMissing, null, 2)};
`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(resolve(here, "openapi-drift-baseline.ts"), body);
  // eslint-disable-next-line no-console
  console.log("openapi-drift baseline regenerated (shrink-only)");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("OpenAPI ↔ drizzle schema drift", () => {
  it("matches a meaningful number of tables to OpenAPI schemas", () => {
    // If the convention mapping breaks, this must not pass vacuously.
    expect(matched.length).toBeGreaterThan(60);
  });

  it("covers the schemas that drifted in the past", () => {
    const names = new Set(matched.map((m) => m.schemaName));
    for (const critical of [
      "Notification",
      "NotificationPreference",
      "EscalationRule",
      "ApprovalInboxItem",
      "Employee",
      "AttendanceRecord",
    ]) {
      expect(names, `expected "${critical}" to be matched to a table`).toContain(critical);
    }
  });

  it("every drizzle table maps to an OpenAPI schema or is explicitly opted out", () => {
    expect(
      unmatchedTables,
      `Tables with no matching OpenAPI component schema. Either add the schema to lib/api-spec/openapi.yaml, or add an entry to SCHEMA_NAME_OVERRIDES in this test (a name override, or null to opt out with a comment saying why):\n  - ${unmatchedTables.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("OpenAPI schemas declare no properties that do not exist on the drizzle table", () => {
    const problems: string[] = [];
    for (const m of matched) {
      const allowed = new Set([
        ...(ALLOWED_MISSING_COLUMNS[m.schemaName] ?? []),
        ...(KNOWN_MISSING_PROPERTIES[m.schemaName] ?? []),
      ]);
      const cols = new Set(m.tsKeys);
      const extras = m.properties.filter((p) => !cols.has(p) && !allowed.has(p));
      if (extras.length) {
        problems.push(`${m.schemaName} (table ${m.sqlName}): ${extras.join(", ")}`);
      }
    }
    expect(
      problems,
      `OpenAPI properties with no corresponding drizzle column — the spec has drifted from the real API. Fix the spec, or if the field is a computed/joined value the API genuinely returns, add it to ALLOWED_EXTRA_PROPERTIES in this test:\n  - ${problems.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("OpenAPI schemas omit no drizzle columns", () => {
    const problems: string[] = [];
    for (const m of matched) {
      const allowed = new Set([
        ...(ALLOWED_MISSING_COLUMNS[m.schemaName] ?? []),
        ...(KNOWN_MISSING_PROPERTIES[m.schemaName] ?? []),
      ]);
      const props = new Set(m.properties);
      const missing = m.tsKeys.filter((k) => !props.has(k) && !allowed.has(k));

    const m = {
      schemaName: "SelfTestSchema",
      tsKeys: ["id", "name", "newColumn"],
      properties: ["id", "name"],
    };

    const m = {
      schemaName: "SelfTestSchema",
      tsKeys: ["id", "name", "newColumn"],
      properties: ["id", "name"],
    };
  for (const m of matched) {
      const d = computeDrift(m, ALLOWED_EXTRA_PROPERTIES, ALLOWED_MISSING_COLUMNS);
      const d = computeDrift(m, ALLOWED_EXTRA_PROPERTIES, ALLOWED_MISSING_COLUMNS);
    expect(d.extra).toEqual([]);
    expect(d.missing).toEqual(["newColumn"]);
  });

  it("regeneration cannot absorb new drift into the baseline (shrink-only)", () => {
    const previous = { Employee: ["fixedDrift", "stillDrifted"] };
    const current = { Employee: ["stillDrifted"] };
    expect(shrinkBaseline(current, previous)).toEqual({
      Employee: ["oldKnownDrift"],
    });
  });

  it("a manually widened baseline is detected as growth", () => {
    // Widening = adding a field to a known schema, or a whole new schema key.
    expect(
      baselineAdditions(
        { Employee: ["known", "sneakyNewEntry"], Notification: ["newSchemaDrift"] },
        { Employee: ["known"] },
      ),
    ).toEqual(["Employee.sneakyNewEntry", "Notification.newSchemaDrift"]);
    // Shrinking or unchanged = no additions.
    expect(baselineAdditions({ Employee: ["known"] }, { Employee: ["known", "fixed"] })).toEqual([]);
  });

  it("the committed baseline has not grown relative to the merge base (git ratchet)", async () => {
    const { execFileSync } = await import("node:child_process");
    const baselineRepoPath = "artifacts/api-server/src/__tests__/openapi-drift-baseline.ts";
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: here, encoding: "utf8" }).trim();

    // Prefer the branch point against the upstream main; fall back to the
    // previous commit so the ratchet still bites in a plain checkout.
    let baseRef: string | null = null;
    for (const candidate of ["main-repl/main", "origin/main"]) {
      try {
        baseRef = git("merge-base", "HEAD", candidate);
        break;
      } catch {
        /* ref not present */
      }
    }
    if (!baseRef) {
      try {
        baseRef = git("rev-parse", "HEAD~1");
      } catch {
        return; // brand-new repo — nothing to ratchet against
      }
    }

    let committedSrc: string;
    try {
      committedSrc = git("show", `${baseRef}:${baselineRepoPath}`);
    } catch {
      return; // baseline did not exist at the base — initial introduction
    }

    const committed = parseBaselineSource(committedSrc);
    const grewExtra = baselineAdditions(KNOWN_EXTRA_PROPERTIES, committed.extra);
    const grewMissing = baselineAdditions(KNOWN_MISSING_PROPERTIES, committed.missing);
    const grew = [...grewExtra, ...grewMissing];
    expect(
      grew,
      `The openapi-drift baseline GREW relative to ${baseRef.slice(0, 12)} — the baseline is shrink-only and may never absorb new drift. Remove these entries and fix the spec/schema instead (or, for genuinely computed/omitted fields, use the curated allowlists in this test):\n  - ${grew.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("regeneration drops entries whose drift was fixed", () => {
    const previous = { Employee: ["fixedDrift", "stillDrifted"] };
    const current = { Employee: ["stillDrifted"] };
    expect(shrinkBaseline(current, previous)).toEqual({
      Employee: ["stillDrifted"],
    });
  });

  it("the committed baseline is already minimal (regeneration would not change it)", () => {
    // If an entry sits in the baseline but the drift no longer exists, it
    // should be pruned — keeps the burn-down honest.
    const currentExtra: Record<string, string[]> = {};
    const currentMissing: Record<string, string[]> = {};
    for (const m of matched) {
      const d = computeDrift(m, ALLOWED_EXTRA_PROPERTIES, ALLOWED_MISSING_COLUMNS);
      if (d.extra.length) currentExtra[m.schemaName] = d.extra;
      if (d.missing.length) currentMissing[m.schemaName] = d.missing;
    }
    expect(shrinkBaseline(currentExtra, KNOWN_EXTRA_PROPERTIES)).toEqual(KNOWN_EXTRA_PROPERTIES);
    expect(shrinkBaseline(currentMissing, KNOWN_MISSING_PROPERTIES)).toEqual(KNOWN_MISSING_PROPERTIES);
  });
});
