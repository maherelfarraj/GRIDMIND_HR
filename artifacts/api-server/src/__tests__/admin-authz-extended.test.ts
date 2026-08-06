/**
 * Extended authorization sweep — batch 2.
 *
 * Covers every admin-only mutating endpoint added in the second pass of the
 * authz sweep (organizations, systemDiagnostics, breakGlass, leaveTypes,
 * publicHolidays, overtimeRules, payComponents, salaryGrades, militaryRanks,
 * mobilizationStatuses, dutyStations, departments, chainOfCommand, orgUnits,
 * restoreTests, goLiveGates, migrationStatus, integrationGovernance,
 * integrationConnectors, devices, deviceMappings, installationReadiness,
 * uatScripts, localAi, privilegedSessions, readinessScorecard,
 * configPackages, dataImport, policyLocalization).
 *
 * Strategy per endpoint:
 *   1. Unauthenticated → 401
 *   2. Non-admin authed → 403
 *   3. Admin authed → NOT 401 / NOT 403 (auth guard cleared; business logic
 *      may return any other status).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUFFIX = `ext-${Date.now()}`;
const ADMIN_USERNAME = `authz-ext-admin-${SUFFIX}`;
const NONADMIN_USERNAME = `authz-ext-nonadmin-${SUFFIX}`;
const PASSWORD = "AuthzExt123!";

let app: Express;
let adminId: number;
let nonAdminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [admin] = await db
    .insert(systemUsersTable)
    .values({
      username: ADMIN_USERNAME,
      email: `${ADMIN_USERNAME}@test.example`,
      fullNameEn: "Ext Authz Admin",
      fullNameAr: "مسؤول",
      roleId: 1, // Super Administrator
      isActive: true,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    })
    .returning();
  adminId = admin.id;

  const [nonAdmin] = await db
    .insert(systemUsersTable)
    .values({
      username: NONADMIN_USERNAME,
      email: `${NONADMIN_USERNAME}@test.example`,
      fullNameEn: "Ext Authz Non Admin",
      fullNameAr: "مستخدم",
      roleId: 5,
      isActive: true,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    })
    .returning();
  nonAdminId = nonAdmin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const id of [adminId, nonAdminId]) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

async function adminAgent() {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").send({ username: ADMIN_USERNAME, password: PASSWORD });
  expect(r.status).toBe(200);
  return agent;
}

async function nonAdminAgent() {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").send({ username: NONADMIN_USERNAME, password: PASSWORD });
  expect(r.status).toBe(200);
  return agent;
}

// ---------------------------------------------------------------------------
// Helper: generates a triple of (unauthenticated, non-admin, admin) tests
// for a single endpoint.  admin expects NOT 401 and NOT 403.
// ---------------------------------------------------------------------------

function authzTriple(
  label: string,
  method: "post" | "patch" | "put" | "delete",
  path: string,
  body?: object,
) {
  const fakeId = 999999;
  const fullPath = path.replace(":id", String(fakeId)).replace(":itemCode", "FAKE_ITEM").replace(":gateCode", "FAKE_GATE").replace(":scenarioId", String(fakeId)).replace(":stepNumber", "1").replace(":employeeId", String(fakeId));

  it(`${label}: unauthenticated → 401`, async () => {
    const r = await (request(app) as any)[method](`/api${fullPath}`).send(body ?? {});
    expect(r.status).toBe(401);
  });

  it(`${label}: non-admin → 403`, async () => {
    const agent = await nonAdminAgent();
    const r = await (agent as any)[method](`/api${fullPath}`).send(body ?? {});
    expect(r.status).toBe(403);
  });

  it(`${label}: admin → auth guard cleared (not 401 / not 403)`, async () => {
    const agent = await adminAgent();
    const r = await (agent as any)[method](`/api${fullPath}`).send(body ?? {});
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });
}

// ============================================================================
// Organizations
// ============================================================================

describe("Organizations — POST /organizations", () => {
  authzTriple("POST /organizations", "post", "/organizations", {
    nameEn: `TestOrg-${SUFFIX}`, nameAr: "منظمة", orgCode: `TORG-${SUFFIX}`,
  });
});

describe("Organizations — POST /organizations/:id/activate", () => {
  authzTriple("POST /organizations/:id/activate", "post", "/organizations/:id/activate");
});

describe("Organizations — PATCH /organizations/:id", () => {
  authzTriple("PATCH /organizations/:id", "patch", "/organizations/:id", { nameEn: "Hacked" });
});

describe("Organizations — DELETE /organizations/:id", () => {
  authzTriple("DELETE /organizations/:id", "delete", "/organizations/:id");
});

// ============================================================================
// System Diagnostics
// ============================================================================

describe("System Diagnostics — POST /diagnostics/run", () => {
  authzTriple("POST /diagnostics/run", "post", "/diagnostics/run");
});

describe("System Diagnostics — POST /diagnostics/readiness/run", () => {
  authzTriple("POST /diagnostics/readiness/run", "post", "/diagnostics/readiness/run");
});

describe("System Diagnostics — PATCH /diagnostics/readiness/:id/override", () => {
  authzTriple("PATCH /diagnostics/readiness/:id/override", "patch", "/diagnostics/readiness/:id/override", { overrideReason: "test" });
});

describe("System Diagnostics — POST /diagnostics/updates", () => {
  authzTriple("POST /diagnostics/updates", "post", "/diagnostics/updates", { version: `9.9.9-${SUFFIX}` });
});

describe("System Diagnostics — PATCH /diagnostics/updates/:id", () => {
  authzTriple("PATCH /diagnostics/updates/:id", "patch", "/diagnostics/updates/:id", { status: "verified" });
});

describe("System Diagnostics — PATCH /diagnostics/deployment-checklist/:itemCode", () => {
  authzTriple("PATCH /diagnostics/deployment-checklist/:itemCode", "patch", "/diagnostics/deployment-checklist/:itemCode", { status: "completed" });
});

// ============================================================================
// Break-Glass
// ============================================================================

describe("Break-Glass — POST /break-glass", () => {
  authzTriple("POST /break-glass", "post", "/break-glass", {
    userId: 1, resourceType: "system", justification: "test",
  });
});

describe("Break-Glass — POST /break-glass/:id/revoke", () => {
  authzTriple("POST /break-glass/:id/revoke", "post", "/break-glass/:id/revoke", { reason: "test" });
});

// ============================================================================
// Leave Types
// ============================================================================

describe("Leave Types — POST /leave-types", () => {
  authzTriple("POST /leave-types", "post", "/leave-types", {
    codeEn: `LT-${SUFFIX}`, nameEn: "Test Leave", nameAr: "إجازة",
  });
});

describe("Leave Types — PATCH /leave-types/:id", () => {
  authzTriple("PATCH /leave-types/:id", "patch", "/leave-types/:id", { nameEn: "Hacked" });
});

describe("Leave Types — DELETE /leave-types/:id", () => {
  authzTriple("DELETE /leave-types/:id", "delete", "/leave-types/:id");
});

// ============================================================================
// Public Holidays
// ============================================================================

describe("Public Holidays — POST /public-holidays", () => {
  authzTriple("POST /public-holidays", "post", "/public-holidays", {
    nameEn: `Holiday-${SUFFIX}`, nameAr: "عطلة", date: "2099-01-01",
  });
});

describe("Public Holidays — PATCH /public-holidays/:id", () => {
  authzTriple("PATCH /public-holidays/:id", "patch", "/public-holidays/:id", { nameEn: "Hacked" });
});

describe("Public Holidays — DELETE /public-holidays/:id", () => {
  authzTriple("DELETE /public-holidays/:id", "delete", "/public-holidays/:id");
});

// ============================================================================
// Overtime Rules
// ============================================================================

describe("Overtime Rules — POST /overtime-rules", () => {
  authzTriple("POST /overtime-rules", "post", "/overtime-rules", {
    nameEn: `OT-${SUFFIX}`, nameAr: "عمل إضافي",
  });
});

describe("Overtime Rules — PATCH /overtime-rules/:id", () => {
  authzTriple("PATCH /overtime-rules/:id", "patch", "/overtime-rules/:id", { nameEn: "Hacked" });
});

describe("Overtime Rules — DELETE /overtime-rules/:id", () => {
  authzTriple("DELETE /overtime-rules/:id", "delete", "/overtime-rules/:id");
});

// ============================================================================
// Pay Components
// ============================================================================

describe("Pay Components — POST /pay-components", () => {
  authzTriple("POST /pay-components", "post", "/pay-components", {
    codeEn: `PC-${SUFFIX}`, nameEn: "Test Component", nameAr: "مكوّن",
  });
});

describe("Pay Components — PATCH /pay-components/:id", () => {
  authzTriple("PATCH /pay-components/:id", "patch", "/pay-components/:id", { nameEn: "Hacked" });
});

describe("Pay Components — DELETE /pay-components/:id", () => {
  authzTriple("DELETE /pay-components/:id", "delete", "/pay-components/:id");
});

// ============================================================================
// Salary Grades
// ============================================================================

describe("Salary Grades — POST /salary-grades", () => {
  authzTriple("POST /salary-grades", "post", "/salary-grades", {
    gradeCode: `SG-${SUFFIX}`, nameEn: "Test Grade", nameAr: "درجة",
  });
});

describe("Salary Grades — PATCH /salary-grades/:id", () => {
  authzTriple("PATCH /salary-grades/:id", "patch", "/salary-grades/:id", { nameEn: "Hacked" });
});

describe("Salary Grades — DELETE /salary-grades/:id", () => {
  authzTriple("DELETE /salary-grades/:id", "delete", "/salary-grades/:id");
});

// ============================================================================
// Military Ranks
// ============================================================================

describe("Military Ranks — POST /military-ranks", () => {
  authzTriple("POST /military-ranks", "post", "/military-ranks", {
    nameEn: `Rank-${SUFFIX}`, nameAr: "رتبة",
  });
});

describe("Military Ranks — PATCH /military-ranks/:id", () => {
  authzTriple("PATCH /military-ranks/:id", "patch", "/military-ranks/:id", { nameEn: "Hacked" });
});

describe("Military Ranks — DELETE /military-ranks/:id", () => {
  authzTriple("DELETE /military-ranks/:id", "delete", "/military-ranks/:id");
});

// ============================================================================
// Mobilization Statuses
// ============================================================================

describe("Mobilization Statuses — POST /mobilization-statuses", () => {
  authzTriple("POST /mobilization-statuses", "post", "/mobilization-statuses", {
    codeEn: `MOB-${SUFFIX}`, nameEn: "Test Status", nameAr: "حالة",
  });
});

describe("Mobilization Statuses — PATCH /mobilization-statuses/:id", () => {
  authzTriple("PATCH /mobilization-statuses/:id", "patch", "/mobilization-statuses/:id", { nameEn: "Hacked" });
});

// ============================================================================
// Duty Stations
// ============================================================================

describe("Duty Stations — POST /duty-stations", () => {
  authzTriple("POST /duty-stations", "post", "/duty-stations", {
    codeEn: `DS-${SUFFIX}`, nameEn: "Test Station", nameAr: "محطة",
  });
});

describe("Duty Stations — PATCH /duty-stations/:id", () => {
  authzTriple("PATCH /duty-stations/:id", "patch", "/duty-stations/:id", { nameEn: "Hacked" });
});

describe("Duty Stations — DELETE /duty-stations/:id", () => {
  authzTriple("DELETE /duty-stations/:id", "delete", "/duty-stations/:id");
});

// ============================================================================
// Departments
// ============================================================================

describe("Departments — POST /departments", () => {
  authzTriple("POST /departments", "post", "/departments", {
    nameEn: `Dept-${SUFFIX}`, nameAr: "قسم", code: `D-${SUFFIX}`,
  });
});

describe("Departments — PATCH /departments/:id", () => {
  authzTriple("PATCH /departments/:id", "patch", "/departments/:id", { nameEn: "Hacked" });
});

describe("Departments — DELETE /departments/:id", () => {
  authzTriple("DELETE /departments/:id", "delete", "/departments/:id");
});

// ============================================================================
// Chain of Command
// ============================================================================

describe("Chain of Command — POST /chain-of-command", () => {
  authzTriple("POST /chain-of-command", "post", "/chain-of-command", { supervisorId: 1, subordinateId: 2 });
});

describe("Chain of Command — PATCH /chain-of-command/:id", () => {
  authzTriple("PATCH /chain-of-command/:id", "patch", "/chain-of-command/:id", { supervisorId: 1 });
});

describe("Chain of Command — DELETE /chain-of-command/:id", () => {
  authzTriple("DELETE /chain-of-command/:id", "delete", "/chain-of-command/:id");
});

// ============================================================================
// Org Units
// ============================================================================

describe("Org Units — POST /org-units", () => {
  authzTriple("POST /org-units", "post", "/org-units", {
    nameEn: `Unit-${SUFFIX}`, nameAr: "وحدة", unitCode: `U-${SUFFIX}`,
  });
});

describe("Org Units — PATCH /org-units/:id", () => {
  authzTriple("PATCH /org-units/:id", "patch", "/org-units/:id", { nameEn: "Hacked" });
});

describe("Org Units — DELETE /org-units/:id", () => {
  authzTriple("DELETE /org-units/:id", "delete", "/org-units/:id");
});

// ============================================================================
// Restore Tests
// ============================================================================

describe("Restore Tests — POST /restore-tests", () => {
  authzTriple("POST /restore-tests", "post", "/restore-tests", { backupRecordId: 999999 });
});

// ============================================================================
// Go-Live Gates
// ============================================================================

describe("Go-Live Gates — POST /go-live-gates/evaluate", () => {
  authzTriple("POST /go-live-gates/evaluate", "post", "/go-live-gates/evaluate");
});

describe("Go-Live Gates — PATCH /go-live-gates/:gateCode", () => {
  authzTriple("PATCH /go-live-gates/:gateCode", "patch", "/go-live-gates/:gateCode", { status: "passed" });
});

describe("Go-Live Gates — POST /go-live-gates/:gateCode/override", () => {
  authzTriple("POST /go-live-gates/:gateCode/override", "post", "/go-live-gates/:gateCode/override", { reason: "test override" });
});

// ============================================================================
// Migration Status
// ============================================================================

describe("Migration Status — POST /migration-status", () => {
  authzTriple("POST /migration-status", "post", "/migration-status", {
    migrationKey: `MIG-${SUFFIX}`, nameEn: "Test Migration", nameAr: "ترحيل",
  });
});

describe("Migration Status — PATCH /migration-status/:id", () => {
  authzTriple("PATCH /migration-status/:id", "patch", "/migration-status/:id", { status: "in_progress" });
});

describe("Migration Status — POST /migration-status/:id/complete", () => {
  authzTriple("POST /migration-status/:id/complete", "post", "/migration-status/:id/complete");
});

// ============================================================================
// Integration Governance — Credential Vault Refs
// ============================================================================

describe("Integration Governance — POST /integration-governance/credential-vault-refs", () => {
  authzTriple(
    "POST /integration-governance/credential-vault-refs", "post",
    "/integration-governance/credential-vault-refs",
    { labelEn: `VaultRef-${SUFFIX}`, labelAr: "مرجع", vaultKeyRef: `TEST_KEY_${SUFFIX}` },
  );
});

describe("Integration Governance — PATCH /integration-governance/credential-vault-refs/:id", () => {
  authzTriple(
    "PATCH /integration-governance/credential-vault-refs/:id", "patch",
    "/integration-governance/credential-vault-refs/:id",
    { labelEn: "Hacked" },
  );
});

describe("Integration Governance — DELETE /integration-governance/credential-vault-refs/:id", () => {
  authzTriple(
    "DELETE /integration-governance/credential-vault-refs/:id", "delete",
    "/integration-governance/credential-vault-refs/:id",
  );
});

// ============================================================================
// Integration Governance — Connection Profiles
// ============================================================================

describe("Integration Governance — POST /integration-governance/connection-profiles", () => {
  authzTriple(
    "POST /integration-governance/connection-profiles", "post",
    "/integration-governance/connection-profiles",
    { profileCode: `CP-${SUFFIX}`, nameEn: "Test Profile", nameAr: "ملف", adapterType: "ldap" },
  );
});

describe("Integration Governance — POST /integration-governance/health-checks/run", () => {
  authzTriple(
    "POST /integration-governance/health-checks/run", "post",
    "/integration-governance/health-checks/run",
  );
});

// ============================================================================
// Integration Governance — Governance Rules
// ============================================================================

describe("Integration Governance — POST /integration-governance/governance-rules", () => {
  authzTriple(
    "POST /integration-governance/governance-rules", "post",
    "/integration-governance/governance-rules",
    { ruleCode: `GR-${SUFFIX}`, nameEn: "Test Rule", nameAr: "قاعدة" },
  );
});

// ============================================================================
// Integration Connectors
// ============================================================================

describe("Integration Connectors — POST /integration-connectors", () => {
  authzTriple("POST /integration-connectors", "post", "/integration-connectors", {
    connectorCode: `IC-${SUFFIX}`, nameEn: "Test Connector", nameAr: "موصّل",
  });
});

describe("Integration Connectors — PATCH /integration-connectors/:id", () => {
  authzTriple("PATCH /integration-connectors/:id", "patch", "/integration-connectors/:id", { nameEn: "Hacked" });
});

describe("Integration Connectors — DELETE /integration-connectors/:id", () => {
  authzTriple("DELETE /integration-connectors/:id", "delete", "/integration-connectors/:id");
});

// ============================================================================
// Devices
// ============================================================================

describe("Devices — POST /devices", () => {
  authzTriple("POST /devices", "post", "/devices", {
    deviceCode: `DEV-${SUFFIX}`, nameEn: "Test Device", nameAr: "جهاز",
  });
});

describe("Devices — PATCH /devices/:id", () => {
  authzTriple("PATCH /devices/:id", "patch", "/devices/:id", { nameEn: "Hacked" });
});

describe("Devices — DELETE /devices/:id", () => {
  authzTriple("DELETE /devices/:id", "delete", "/devices/:id");
});

// ============================================================================
// Device Mappings
// ============================================================================

describe("Device Mappings — POST /devices/:id/mappings", () => {
  authzTriple("POST /devices/:id/mappings", "post", "/devices/:id/mappings", { employeeId: 1 });
});

describe("Device Mappings — DELETE /devices/:id/mappings/:employeeId", () => {
  authzTriple("DELETE /devices/:id/mappings/:employeeId", "delete", "/devices/:id/mappings/:employeeId");
});

// ============================================================================
// Installation Readiness
// ============================================================================

describe("Installation Readiness — POST /installation-readiness/run", () => {
  authzTriple("POST /installation-readiness/run", "post", "/installation-readiness/run");
});

describe("Installation Readiness — PATCH /installation-readiness/:id", () => {
  authzTriple("PATCH /installation-readiness/:id", "patch", "/installation-readiness/:id", { status: "passed" });
});

// ============================================================================
// UAT Scripts
// ============================================================================

describe("UAT Scripts — POST /uat-scripts", () => {
  authzTriple("POST /uat-scripts", "post", "/uat-scripts", {
    scriptCode: `UAT-${SUFFIX}`, nameEn: "Test Script", nameAr: "سيناريو",
  });
});

describe("UAT Scripts — PATCH /uat-scripts/:id", () => {
  authzTriple("PATCH /uat-scripts/:id", "patch", "/uat-scripts/:id", { nameEn: "Hacked" });
});

describe("UAT Scripts — DELETE /uat-scripts/:id", () => {
  authzTriple("DELETE /uat-scripts/:id", "delete", "/uat-scripts/:id");
});

// ============================================================================
// Local AI
// ============================================================================

describe("Local AI — PATCH /ai/config", () => {
  authzTriple("PATCH /ai/config", "patch", "/ai/config", { model: "llama3" });
});

describe("Local AI — POST /ai/policy-search", () => {
  authzTriple("POST /ai/policy-search", "post", "/ai/policy-search", { query: "test" });
});

// ============================================================================
// Privileged Sessions
// ============================================================================

describe("Privileged Sessions — POST /privileged-sessions/:id/review", () => {
  authzTriple("POST /privileged-sessions/:id/review", "post", "/privileged-sessions/:id/review", {
    reviewOutcome: "approved", reviewNotes: "ok",
  });
});

// ============================================================================
// Readiness Scorecard
// ============================================================================

describe("Readiness Scorecard — POST /readiness-scorecard/recalculate", () => {
  authzTriple("POST /readiness-scorecard/recalculate", "post", "/readiness-scorecard/recalculate");
});

// ============================================================================
// Config Packages
// ============================================================================

describe("Config Packages — POST /config-packages", () => {
  authzTriple("POST /config-packages", "post", "/config-packages", {
    packageCode: `CFG-${SUFFIX}`, nameEn: "Test Config", nameAr: "إعدادات",
  });
});


// ============================================================================
// Data Import
// ============================================================================

describe("Data Import — POST /imports", () => {
  authzTriple("POST /imports", "post", "/imports", { importType: "employees", fileName: "test.csv" });
});

describe("Data Import — POST /imports/:id/execute", () => {
  authzTriple("POST /imports/:id/execute", "post", "/imports/:id/execute");
});

// ============================================================================
// Policy Localization
// ============================================================================

describe("Policy Localization — POST /policy-locales", () => {
  authzTriple("POST /policy-locales", "post", "/policy-locales", {
    localeCode: `LC-${SUFFIX}`, nameEn: "Test Locale", nameAr: "لغة",
  });
});

describe("Policy Localization — POST /numbering-schemes", () => {
  authzTriple("POST /numbering-schemes", "post", "/numbering-schemes", {
    schemeCode: `NS-${SUFFIX}`, nameEn: "Test Scheme", nameAr: "نظام",
  });
});

// ============================================================================
// Report Definitions
// ============================================================================

describe("Report Definitions — POST /report-definitions", () => {
  authzTriple("POST /report-definitions", "post", "/report-definitions", {
    nameEn: `Report-${SUFFIX}`, nameAr: "تقرير", reportType: "custom",
  });
});

describe("Report Definitions — PATCH /report-definitions/:id", () => {
  authzTriple("PATCH /report-definitions/:id", "patch", "/report-definitions/:id", { nameEn: "Hacked" });
});

describe("Report Definitions — POST /report-definitions/:id/run", () => {
  authzTriple("POST /report-definitions/:id/run", "post", "/report-definitions/:id/run", { exportFormat: "pdf" });
});
