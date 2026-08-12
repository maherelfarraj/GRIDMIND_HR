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
 * Request-body schemas are covered too: for every matched table, the
 * `<SchemaName>Input` and `<SchemaName>Update` component schemas (when
 * they exist) must only declare properties that are real columns — most
 * route handlers insert/update req.body wholesale and drizzle silently
 * discards unknown keys, so a stale Input field means what the user typed
 * is silently lost.
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
// Import the schema-only entrypoint. The package root also constructs the
// runtime connection pool and therefore requires DATABASE_URL, even though
// this test is deliberately static and never touches a database.
import * as dbSchema from "@workspace/db/schema";

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
  "PrivilegedSession": ["userName"], // joined from system_users when serializing
  "PayrollExcusedAbsence": ["recalculated"], // computed flag: whether excusal change auto-recalculated runs
  "Department": [
    "parentNameEn",
    "headEmployeeNameEn",
    "employeeCount"
  ],
  "Role": [
    "permissions",
    "userCount"
  ],
  "Employee": [
    "departmentNameEn",
    "departmentNameAr",
    "managerNameEn",
    "roleNameEn"
  ],
  "SystemUser": [
    "roleNameEn",
    "lockedUntil", // computed from in-memory login-throttle state, not a column
    "lastOtpIssuedAt", // computed from user.otp_issued audit events
    "lastOtpIssuedByUserId", // computed from user.otp_issued audit events
    "lastOtpIssuedByName" // joined actor name for the latest OTP issuance
  ],
  "Document": [
    "employeeNameEn",
    "uploadedByUserName"
  ],
  "Approval": [
    "requestedByEmployeeNameEn",
    "assignedToUserName"
  ],
  "AuditLog": [
    "actorUserName"
  ],
  "AttendanceRecord": [
    "employeeNameEn",
    "employeeNameAr",
    "departmentNameEn",
    "deviceName"
  ],
  "AttendanceDevice": [
    "departmentNameEn",
    "lastContactAt",
    "isOnline",
    "isStale"
  ],
  "SecurityAlert": [
    "acknowledgedByUserName"
  ],
  "Shift": [
    "assignedEmployeeCount"
  ],
  "RosterEntry": [
    "firstNameEn",
    "lastNameEn",
    "firstNameAr",
    "lastNameAr",
    "employeeNumber",
    "jobTitleEn",
    "jobTitleAr",
    "shiftCode",
    "shiftNameEn",
    "shiftNameAr",
    "shiftStartTime",
    "shiftEndTime",
    "shiftColor"
  ],
  "OvertimeRule": [
    "deptNameEn",
    "deptNameAr"
  ],
  "PunchEvent": [
    "firstNameEn",
    "lastNameEn",
    "firstNameAr",
    "lastNameAr",
    "employeeNumber",
    "deviceName",
    "deviceLocation"
  ],
  "LeaveBalance": [
    "available",
    "employeeNameEn",
    "employeeNameAr",
    "leaveTypeNameEn",
    "leaveTypeNameAr",
    "leaveTypeColor"
  ],
  "LeaveRequestDetail": [
    "employeeNameEn",
    "employeeNameAr",
    "departmentId",
    "leaveTypeNameEn",
    "leaveTypeNameAr",
    "leaveTypeColor",
    "leaveTypeCategory",
    "coveringEmployeeNameEn",
    "steps",
    "attachments"
  ],
  "LeaveDelegation": [
    "delegatorNameEn",
    "delegateeNameEn"
  ],
  "PayrollRunDetail": [
    "employeeNameEn",
    "employeeNameAr",
    "employeeNumber",
    "jobTitleEn",
    "jobTitleAr",
    "nationalId",
    "periodNameEn",
    "periodNameAr",
    "periodStartDate",
    "periodEndDate",
    "payDate",
    "lines",
    "departmentNameEn",
    "grade"
  ],
  "EmployeePosting": [
    "employeeNameEn",
    "orgUnitNameEn",
    "dutyStationNameEn",
    "rankNameEn"
  ],
  "EmployeeTransfer": [
    "employeeNameEn",
    "fromUnitNameEn",
    "toUnitNameEn"
  ],
  "EmployeeSecondment": [
    "employeeNameEn",
    "hostUnitNameEn"
  ],
  "SecurityClearance": [
    "employeeNameEn",
    "employeeNameAr"
  ],
  "MobilizationStatus": [
    "employeeNameEn",
    "employeeNameAr"
  ],
  "ChainOfCommandEntry": [
    "employeeNameEn",
    "supervisorNameEn"
  ],
  "DualAuthRequest": [
    "initiatedByUserName"
  ],
  "BreakGlassAccess": [
    "userName"
  ],
  "LicenseRecord": [
    "daysUntilExpiry",
    "features"
  ],
  "DevelopmentPlan": [
    "completionPercentage"
  ],
  "PayrollVarianceLog": [
    "periodCode",
    "periodNameEn",
    "startDate"
  ],
  "GatewayRegistration": [
    "connTestTimedOut",  // server-computed from connTestRequestedAt + silence threshold
    "silent",            // server-computed: ACTIVE but no heartbeat within threshold
    "silenceThresholdMs", // server-computed: effective threshold after per-reg override
    "reconcileCommand"   // joined: latest RECONCILE device command for this gateway
  ],
  "IntegrationCredentialVaultRef": [
    "configured", // server-computed: true when process.env[vaultKeyRef] is set; never exposes the value
    "warnings",   // present only on create/update: non-blocking list of unconfigured vault key refs
  ],
  "IntegrationConnectionProfile": [
    "warnings",   // present only on create/update: non-blocking list of unconfigured vault key refs
  ],
};

/**
 * Drizzle columns an OpenAPI schema may legitimately omit — sensitive or
 * internal columns the API never returns. Key: OpenAPI schema name.
 */
const ALLOWED_MISSING_COLUMNS: Record<string, string[]> = {
  SystemUser: ["passwordHash"], // never serialized
  GatewayRegistration: ["secretHash"], // secret material — never serialized
};

/**
 * Fields a request-body Input/Update schema may carry that are NOT drizzle
 * columns — fields the route handler explicitly reads and maps to something
 * else (another column, a related table, or a computed value). Every entry
 * must cite the handler that performs the mapping. Key: Input schema name.
 */
const ALLOWED_EXTRA_INPUT_PROPERTIES: Record<string, string[]> = {
  // roles.ts explicitly parses `permissions` and serializes it to roles.permissionsJson
  RoleInput: ["permissions"],
  RoleUpdate: ["permissions"],
  // dualAuth.ts explicitly reads `ttlMinutes` and computes expiresAt from it
  DualAuthRequestInput: ["ttlMinutes"],
  // breakGlass.ts explicitly destructures `ttlMinutes` and computes expiresAt from it
  BreakGlassRequest: ["ttlMinutes"],
};

/** Pre-existing Input-schema drift (shrink target — keep at empty). */
const KNOWN_EXTRA_INPUT_PROPERTIES: Record<string, string[]> = {};

// Pre-existing drift captured as a shrink-only baseline: the test fails on
// any NEW drift, while known discrepancies are burned down over time.
import {
  KNOWN_EXTRA_PROPERTIES,
  KNOWN_MISSING_PROPERTIES,
} from "./openapi-drift-baseline";

/**
 * Request-body schemas whose table cannot be derived by stripping the
 * Input/Update/Patch suffix and matching a table's schema name.
 * Map: request schema name → SQL table name whose columns it must match,
 * or `null` to opt out — ONLY for action/command payloads that the handler
 * reads field-by-field (never inserted wholesale into a row). Every entry
 * must say why.
 */
const REQUEST_SCHEMA_TABLES: Record<string, string | null> = {
  // Base name differs from the response schema name mapped to the table:
  LeaveRequestInput: "leave_requests", // response schema is LeaveRequestDetail
  RosterInput: "rosters", // response schema is RosterEntry
  ChainOfCommandInput: "chain_of_command", // response schema is ChainOfCommandEntry
  PayrollRunPatch: "payroll_runs", // response schema is PayrollRunDetail
  MobilizationStatusInput: "mobilization_statuses", // response schema is MobilizationStatus (override table)
  ApplicationInput: "applications",
  BreakGlassRequest: "break_glass_access", // handler inserts the body's fields as a new access row
  // Action/command payloads — the handler reads each field explicitly and
  // never inserts the body wholesale into a row, so nothing can be dropped
  // silently (unknown fields are simply not part of the command):
  LoginInput: null, // auth.ts login: reads username/password explicitly
  ChangePasswordInput: null, // auth.ts: zod-parsed (ChangeMyPasswordBody), fields read explicitly
  SetPasswordInput: null, // users.ts: zod-parsed (SetUserPasswordBody)
  AlertAcknowledgement: null, // alerts.ts: zod-parsed (AcknowledgeAlertBody)
  ApprovalDecision: null, // approvals.ts decision endpoint: reads decision/comment explicitly
  DualAuthDecision: null, // dualAuth.ts: reads decision fields explicitly
  LeaveDecisionInput: null, // leaveRequests.ts approve/reject: reads decision fields explicitly
  RevokeLeaveInput: null, // leaveRequests.ts revoke: destructures reason/newEndDate/revokedByEmployeeId
  ReturnToDutyInput: null, // leaveRequests.ts return-to-duty: reads fields explicitly
  AnnualLeaveResetInput: null, // leaveBalances.ts annual reset command: reads fields explicitly
  ProvisionLeaveYearInput: null, // leaveBalances.ts provision command: reads fields explicitly
  PayrollApprovalInput: null, // payroll.ts approve step: reads decision fields explicitly
  PrivilegedSessionReview: null, // privilegedSessions.ts review: reads fields explicitly
  LicenseActivationInput: null, // license.ts activate: reads the activation key explicitly
  // gateway/attendanceGateway.ts PATCH handler: validates silenceThresholdMinutes
  // explicitly (range check, null → reset) before a targeted .set(); never
  // inserts the body wholesale, so a stale field cannot be silently dropped.
  GatewayRegistrationUpdate: null,
  // integrationGovernance.ts POST/PATCH handlers: wholesale insert/update into
  // integration_credential_vault_refs. Fields match the drizzle table columns.
  IntegrationCredentialVaultRefInput: "integration_credential_vault_refs",
  IntegrationCredentialVaultRefUpdate: "integration_credential_vault_refs",
};
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

/**
 * Every component schema name referenced (directly or via items/allOf/…)
 * by any operation's requestBody. Exported for the self-tests below.
 */
export function collectRequestBodySchemaNames(specDoc: unknown): string[] {
  const names = new Set<string>();
  const walk = (s: unknown, depth = 0): void => {
    if (!s || typeof s !== "object" || depth > 6) return;
    const o = s as Record<string, unknown> & { $ref?: string };
    if (o.$ref) {
      names.add(o.$ref.replace("#/components/schemas/", ""));
      return;
    }
    for (const key of ["items", "allOf", "oneOf", "anyOf"]) {
      const v = o[key];
      if (v) (Array.isArray(v) ? v : [v]).forEach((x) => walk(x, depth + 1));
    }
    if (o.properties && typeof o.properties === "object") {
      Object.values(o.properties).forEach((x) => walk(x, depth + 1));
    }
  };
  const paths = (specDoc as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
  for (const pathItem of Object.values(paths)) {
    for (const op of Object.values(pathItem)) {
      const body = (op as { requestBody?: { content?: Record<string, { schema?: unknown }> } })
        ?.requestBody;
      const schema = body?.content?.["application/json"]?.schema;
      if (schema) walk(schema);
    }
  }
  return [...names].sort();
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
 * Stale fields in one request-body Input/Update schema: properties that are
 * neither real columns nor explicitly allowlisted handler-mapped fields.
 * Exported for the self-tests below.
 */
export function computeInputDrift(
  inputName: string,
  inputProperties: string[],
  tsKeys: string[],
  curatedExtra: Record<string, string[]>,
  baselineExtra: Record<string, string[]>,
): string[] {
  const cols = new Set(tsKeys);
  const allowed = new Set([
    ...(curatedExtra[inputName] ?? []),
    ...(baselineExtra[inputName] ?? []),
  ]);
  return inputProperties.filter((p) => !cols.has(p) && !allowed.has(p));
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
  const missing: Record<string, string[]> = {};
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
        ...(ALLOWED_EXTRA_PROPERTIES[m.schemaName] ?? []),
        ...(KNOWN_EXTRA_PROPERTIES[m.schemaName] ?? []),
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
      if (missing.length) {
        problems.push(`${m.schemaName} (table ${m.sqlName}): ${missing.join(", ")}`);
      }
    }
    expect(
      problems,
      `Drizzle columns absent from the OpenAPI schema — the spec has drifted from the real API. Fix the spec, or if the column is genuinely never returned, add it to ALLOWED_MISSING_COLUMNS in this test:\n  - ${problems.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("every request-body schema referenced by an operation is drift-checked against its table (or deliberately opted out)", () => {
    // A stale field in a request-body schema means the client sends data the
    // server's wholesale insert/update silently drops — the user's input is
    // lost without any error. Coverage is derived from the operations
    // themselves: every schema referenced by any requestBody must resolve to
    // a table (by convention, or via REQUEST_SCHEMA_TABLES), be explicitly
    // opted out as an action payload, or the test fails.
    const requestSchemaNames = collectRequestBodySchemaNames(spec);
    // Guard against the check passing vacuously if the walker breaks.
    expect(
      requestSchemaNames.length,
      "expected to find a meaningful number of request-body schemas",
    ).toBeGreaterThan(80);

    const tableBySchemaName = new Map(matched.map((m) => [m.schemaName, m]));
    const tableBySqlName = new Map(tables.map((t) => [t.sqlName, t]));

    const unmapped: string[] = [];
    const problems: string[] = [];
    let checked = 0;
    for (const name of requestSchemaNames) {
      let tsKeys: string[] | undefined;
      let tableName: string | undefined;
      if (name in REQUEST_SCHEMA_TABLES) {
        const sqlName = REQUEST_SCHEMA_TABLES[name];
        if (sqlName === null) continue; // documented action payload — opted out
        const t = tableBySqlName.get(sqlName);
        if (!t) {
          unmapped.push(`${name} (REQUEST_SCHEMA_TABLES points at unknown table "${sqlName}")`);
          continue;
        }
        tsKeys = t.tsKeys;
        tableName = t.sqlName;
      } else {
        const base = name.replace(/(Input|Update|Patch)$/, "");
        const m = tableBySchemaName.get(base);
        if (!m) {
          unmapped.push(name);
          continue;
        }
        tsKeys = m.tsKeys;
        tableName = m.sqlName;
      }
      checked++;
      const props = collectProperties(openapiSchemas[name]);
      const extras = computeInputDrift(
        name,
        props,
        tsKeys,
        ALLOWED_EXTRA_INPUT_PROPERTIES,
        KNOWN_EXTRA_INPUT_PROPERTIES,
      );
      if (extras.length) {
        problems.push(`${name} (table ${tableName}): ${extras.join(", ")}`);
      }
    }

    expect(checked, "expected to drift-check a meaningful number of request-body schemas").toBeGreaterThan(80);
    expect(
      unmapped,
      `Request-body schemas that could not be mapped to a drizzle table — map them in REQUEST_SCHEMA_TABLES (or opt out action payloads with null + a comment saying which handler reads them field-by-field):\n  - ${unmapped.join("\n  - ")}`,
    ).toEqual([]);
    expect(
      problems,
      `Request-body schemas carry fields with no corresponding drizzle column — the server would silently drop what the user typed. Rename the field to the real column in lib/api-spec/openapi.yaml (and update the web form), or if the handler explicitly maps the field, add it to ALLOWED_EXTRA_INPUT_PROPERTIES in this test with a comment citing the handler:\n  - ${problems.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("non-conventional request schemas are validated via REQUEST_SCHEMA_TABLES, not skipped (self-test)", () => {
    // LeaveRequestInput's base name ("LeaveRequest") matches no response
    // schema (the table maps to "LeaveRequestDetail"), so only the explicit
    // REQUEST_SCHEMA_TABLES mapping covers it. Prove the mapping resolves to
    // real columns and that a stale field on such a schema would be flagged.
    const t = tables.find((x) => x.sqlName === REQUEST_SCHEMA_TABLES["LeaveRequestInput"]);
    expect(t, "REQUEST_SCHEMA_TABLES.LeaveRequestInput must point at a real table").toBeTruthy();
    const props = collectProperties(openapiSchemas["LeaveRequestInput"]);
    expect(props.length).toBeGreaterThan(0);
    // A hypothetical stale field on this non-conventionally-named schema is caught:
    expect(
      computeInputDrift("LeaveRequestInput", [...props, "staleLegacyField"], t!.tsKeys, ALLOWED_EXTRA_INPUT_PROPERTIES, KNOWN_EXTRA_INPUT_PROPERTIES),
    ).toContain("staleLegacyField");
    // And every action-payload opt-out must be an explicit, commented null — never an unknown table.
    for (const [name, sqlName] of Object.entries(REQUEST_SCHEMA_TABLES)) {
      if (sqlName !== null) {
        expect(tables.some((x) => x.sqlName === sqlName), `${name} → ${sqlName} must be a real table`).toBe(true);
      }
    }
  });

  it("computeInputDrift flags a stale Input field but honors mapped exceptions (self-test)", () => {
    // Stale field with no column and no allowlist entry → flagged.
    expect(
      computeInputDrift("SelfTestInput", ["realCol", "staleField"], ["realCol"], {}, {}),
    ).toEqual(["staleField"]);
    // Handler-mapped field allowlisted → not flagged.
    expect(
      computeInputDrift(
        "SelfTestInput",
        ["realCol", "mappedField"],
        ["realCol"],
        { SelfTestInput: ["mappedField"] },
        {},
      ),
    ).toEqual([]);
  });

  it("computeDrift flags a column missing from the spec (self-test)", () => {
    const m = {
      schemaName: "SelfTestSchema",
      tsKeys: ["id", "name", "newColumn"],
      properties: ["id", "name"],
    };
    const d = computeDrift(m, {}, {});
    expect(d.extra).toEqual([]);
    expect(d.missing).toEqual(["newColumn"]);
  });

  it("regeneration cannot absorb new drift into the baseline (shrink-only)", () => {
    const previous = { Employee: ["fixedDrift", "stillDrifted"] };
    const current = { Employee: ["stillDrifted"] };
    // The new discrepancy never enters the baseline — only known entries survive.
    expect(shrinkBaseline(current, previous)).toEqual({
      Employee: ["stillDrifted"],
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
      execFileSync("git", args, { cwd: here, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

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
