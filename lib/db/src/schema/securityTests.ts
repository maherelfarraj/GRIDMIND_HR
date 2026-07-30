import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Security test scenarios — structured test cases for each attack vector.
 * Scenarios are executed against the running system; results feed the security gate.
 *
 * Attack vectors covered:
 * - privilege_escalation: attempting to access higher-privilege endpoints
 * - cross_org_access: cross-organization data leakage
 * - api_bypass: bypassing UI to hit API directly without auth
 * - replay_attack: replaying old attendance punch events
 * - duplicate_payroll: submitting duplicate payroll close/approve actions
 * - unauthorized_export: exporting data without permission
 * - break_glass_abuse: misusing emergency access outside approved scenarios
 * - tampered_package: importing a config package with invalid/modified signature
 * - failed_sync: behavior when attendance device sync fails mid-way
 * - session_fixation: using a stolen/fixed session token
 * - mass_assignment: sending extra fields to bypass business logic
 */
export const securityTestScenariosTable = pgTable("security_test_scenarios", {
  id: serial("id").primaryKey(),
  scenarioCode: varchar("scenario_code", { length: 50 }).notNull().unique(),
  // "privilege_escalation" | "cross_org_access" | "api_bypass" | "replay_attack"
  // | "duplicate_payroll" | "unauthorized_export" | "break_glass_abuse"
  // | "tampered_package" | "failed_sync" | "session_fixation" | "mass_assignment"
  attackVector: varchar("attack_vector", { length: 30 }).notNull(),
  titleEn: varchar("title_en", { length: 250 }).notNull(),
  titleAr: varchar("title_ar", { length: 250 }).notNull(),
  descriptionEn: text("description_en"),
  // "critical" | "high" | "medium" | "low"
  severity: varchar("severity", { length: 10 }).notNull().default("high"),
  // STRIDE category: Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation
  strideCategory: varchar("stride_category", { length: 30 }),
  // The HTTP endpoint/action being tested
  targetEndpoint: varchar("target_endpoint", { length: 200 }),
  targetMethod: varchar("target_method", { length: 10 }),
  // Request payload template (JSON with placeholder values)
  requestTemplateJson: text("request_template_json"),
  // What the test asserts the system should do (reject/audit/alert)
  expectedBehaviorEn: text("expected_behavior_en"),
  expectedBehaviorAr: text("expected_behavior_ar"),
  // Expected HTTP status code range when the attack is correctly rejected
  expectedStatusCode: integer("expected_status_code").notNull().default(403),
  // Whether the attempt must be logged in audit_logs
  requiresAuditLog: boolean("requires_audit_log").notNull().default(true),
  // Whether the attempt should trigger a security alert
  requiresSecurityAlert: boolean("requires_security_alert").notNull().default(false),
  // "automated" — can be run via API test runner
  // "manual" — requires human execution
  executionType: varchar("execution_type", { length: 15 }).notNull().default("automated"),
  // Which go-live gate this feeds
  relatedGateCode: varchar("related_gate_code", { length: 60 }),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SecurityTestScenario = typeof securityTestScenariosTable.$inferSelect;

/**
 * Security test runs — each batch execution of security scenarios.
 */
export const securityTestRunsTable = pgTable("security_test_runs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  runLabel: varchar("run_label", { length: 100 }),
  // "automated" | "manual" | "mixed"
  runType: varchar("run_type", { length: 15 }).notNull().default("automated"),
  // "running" | "complete" | "failed"
  status: varchar("status", { length: 15 }).notNull().default("running"),
  totalScenarios: integer("total_scenarios").notNull().default(0),
  passedScenarios: integer("passed_scenarios").notNull().default(0),
  failedScenarios: integer("failed_scenarios").notNull().default(0),
  skippedScenarios: integer("skipped_scenarios").notNull().default(0),
  // Overall security posture: "secure" | "at_risk" | "critical_failure"
  overallPosture: varchar("overall_posture", { length: 20 }),
  triggeredByUserId: integer("triggered_by_user_id"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  summaryJson: text("summary_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SecurityTestRun = typeof securityTestRunsTable.$inferSelect;

/**
 * Security test findings — result of each scenario within a run.
 */
export const securityTestFindingsTable = pgTable("security_test_findings", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  scenarioId: integer("scenario_id").notNull(),
  // "pass" — system correctly rejected the attack
  // "fail" — system did NOT correctly reject the attack (vulnerability found)
  // "warn" — system rejected but without proper audit trail or alert
  // "skip" — not applicable in this environment
  result: varchar("result", { length: 10 }).notNull(),
  // Actual HTTP status code received
  actualStatusCode: integer("actual_status_code"),
  // Whether an audit log entry was found for this attempt
  auditLogFound: boolean("audit_log_found"),
  // Whether a security alert was triggered
  alertTriggered: boolean("alert_triggered"),
  // The actual response body (truncated for large responses)
  actualResponseSnippet: text("actual_response_snippet"),
  // Detailed finding (especially for failures)
  findingDescriptionEn: text("finding_description_en"),
  // Recommended fix for any failure
  remediationEn: text("remediation_en"),
  // CVSS-like risk score (0.0–10.0)
  riskScore: varchar("risk_score", { length: 5 }),
  // Whether this finding blocks the go-live gate
  isGoLiveBlocker: boolean("is_go_live_blocker").notNull().default(false),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SecurityTestFinding = typeof securityTestFindingsTable.$inferSelect;
