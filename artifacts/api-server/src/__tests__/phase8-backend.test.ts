/**
 * Phase 8 Integration Tests — Setup Wizard, Data Import, System Diagnostics, Pilot Scenarios
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  setupWizardProgressTable,
  dataImportJobsTable,
  dataImportRowsTable,
  importMappingTemplatesTable,
  systemHealthChecksTable,
  environmentReadinessChecksTable,
  softwareUpdatePackagesTable,
  deploymentChecklistItemsTable,
  pilotAccountsTable,
  pilotScenariosTable,
  pilotScenarioProgressTable,
  employeesTable,
} from "@workspace/db";
import app from "../app";

// ─── Cleanup trackers ─────────────────────────────────────────────────────────
const createdImportJobIds: number[] = [];
const createdTemplateIds: number[] = [];
const createdHealthRunIds: string[] = [];
const createdReadinessIds: number[] = [];
const createdUpdatePackageIds: number[] = [];
const createdChecklistCodes: string[] = [];
const createdPilotAccountIds: number[] = [];
const createdScenarioIds: number[] = [];
let wizardCreatedInTest = false;

afterAll(async () => {
  // Cleanup pilot progress
  for (const sid of createdScenarioIds) {
    await db.delete(pilotScenarioProgressTable).where(eq(pilotScenarioProgressTable.scenarioId, sid));
  }
  if (createdScenarioIds.length) {
    await db.delete(pilotScenariosTable).where(inArray(pilotScenariosTable.id, createdScenarioIds));
  }
  if (createdPilotAccountIds.length) {
    await db.delete(pilotAccountsTable).where(inArray(pilotAccountsTable.id, createdPilotAccountIds));
  }

  // Cleanup import jobs + rows
  if (createdImportJobIds.length) {
    await db.delete(dataImportRowsTable).where(inArray(dataImportRowsTable.importJobId, createdImportJobIds));
    // Also remove any employees created via import (those with employeeNumber starting with TEST-)
    // We rely on rollback tests to handle this in test flow
    await db.delete(dataImportJobsTable).where(inArray(dataImportJobsTable.id, createdImportJobIds));
  }
  if (createdTemplateIds.length) {
    await db.delete(importMappingTemplatesTable).where(inArray(importMappingTemplatesTable.id, createdTemplateIds));
  }

  // Cleanup diagnostics
  for (const runId of createdHealthRunIds) {
    await db.delete(systemHealthChecksTable).where(eq(systemHealthChecksTable.runId, runId));
  }
  if (createdReadinessIds.length) {
    await db.delete(environmentReadinessChecksTable).where(inArray(environmentReadinessChecksTable.id, createdReadinessIds));
  }
  if (createdUpdatePackageIds.length) {
    await db.delete(softwareUpdatePackagesTable).where(inArray(softwareUpdatePackagesTable.id, createdUpdatePackageIds));
  }
  for (const code of createdChecklistCodes) {
    await db.delete(deploymentChecklistItemsTable).where(eq(deploymentChecklistItemsTable.itemCode, code));
  }

  // Cleanup wizard if created
  if (wizardCreatedInTest) {
    await db.delete(setupWizardProgressTable).where(eq(setupWizardProgressTable.instanceId, "test_instance"));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETUP WIZARD
// ─────────────────────────────────────────────────────────────────────────────
describe("Setup Wizard", () => {
  it("GET /api/setup/wizard returns wizard progress (or creates one)", async () => {
    const res = await request(app).get("/api/setup/wizard");
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("currentStep");
    expect(res.body).toHaveProperty("isComplete");
    expect(res.body).toHaveProperty("completedSteps");
    expect(Array.isArray(res.body.completedSteps)).toBe(true);
  });

  it("PATCH /api/setup/wizard updates currentStep", async () => {
    const res = await request(app)
      .patch("/api/setup/wizard")
      .send({ currentStep: "branding", completedSteps: ["org_profile"] });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe("branding");
    expect(res.body.completedSteps).toContain("org_profile");
  });

  it("POST /api/setup/wizard/complete marks wizard complete", async () => {
    const res = await request(app).post("/api/setup/wizard/complete");
    expect(res.status).toBe(200);
    expect(res.body.isComplete).toBe(true);
    expect(res.body.currentStep).toBe("complete");
  });

  it("POST /api/setup/wizard/reset resets wizard to initial state", async () => {
    const res = await request(app).post("/api/setup/wizard/reset");
    expect(res.status).toBe(200);
    expect(res.body.isComplete).toBe(false);
    expect(res.body.currentStep).toBe("org_profile");
    expect(res.body.completedSteps).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DATA IMPORT
// ─────────────────────────────────────────────────────────────────────────────
describe("Data Import — Employee Import Lifecycle", () => {
  let jobId: number;

  it("POST /api/imports creates job and validates rows", async () => {
    const res = await request(app)
      .post("/api/imports")
      .send({
        importType: "employees",
        fileFormat: "json",
        rowsJson: [
          { employeeNumber: `TEST-IMP-${Date.now()}`, firstNameEn: "John", lastNameEn: "Doe", email: "john.doe.imp@test.com", hireDate: "2024-01-01", nationality: "SA" },
          { employeeNumber: "", firstNameEn: "Bad", lastNameEn: "Row" }, // missing required fields
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.status).toBe("preview");
    expect(res.body.totalRows).toBe(2);
    expect(res.body.validRows).toBe(1);
    expect(res.body.errorRows).toBe(1);
    jobId = res.body.id;
    createdImportJobIds.push(jobId);
  });

  it("GET /api/imports returns list of jobs", async () => {
    const res = await request(app).get("/api/imports");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET /api/imports/:id returns job with stats", async () => {
    const res = await request(app).get(`/api/imports/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body).toHaveProperty("rowStats");
  });

  it("GET /api/imports/:id/rows returns paginated rows", async () => {
    const res = await request(app).get(`/api/imports/${jobId}/rows?page=1&pageSize=10`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rows");
    expect(res.body).toHaveProperty("total");
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it("GET /api/imports/:id/rows?status=error returns only error rows", async () => {
    const res = await request(app).get(`/api/imports/${jobId}/rows?status=error`);
    expect(res.status).toBe(200);
    const statuses = res.body.rows.map((r: any) => r.status);
    statuses.forEach((s: string) => expect(s).toBe("error"));
  });

  it("POST /api/imports/:id/confirm-preview sets previewConfirmed", async () => {
    const res = await request(app).post(`/api/imports/${jobId}/confirm-preview`);
    expect(res.status).toBe(200);
    expect(res.body.previewConfirmed).toBe(true);
  });

  it("POST /api/imports/:id/execute imports valid rows", async () => {
    const res = await request(app).post(`/api/imports/${jobId}/execute`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("complete");
    expect(res.body.imported).toBe(1);
  });

  it("POST /api/imports/:id/rollback reverses the import", async () => {
    const res = await request(app).post(`/api/imports/${jobId}/rollback`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rolled_back");
    expect(res.body.rolledBack).toBe(1);
  });
});

describe("Data Import — Mapping Templates", () => {
  let templateId: number;

  it("POST /api/import-mapping-templates creates a template", async () => {
    const res = await request(app)
      .post("/api/import-mapping-templates")
      .send({
        name: `TEST_TPL_${Date.now()}`,
        importType: "employees",
        columnMappingJson: { "EmpID": "employeeNumber", "FName": "firstNameEn" },
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    templateId = res.body.id;
    createdTemplateIds.push(templateId);
  });

  it("GET /api/import-mapping-templates?type=employees returns templates", async () => {
    const res = await request(app).get("/api/import-mapping-templates?type=employees");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((t: any) => t.id === templateId)).toBe(true);
  });

  it("DELETE /api/import-mapping-templates/:id deletes template", async () => {
    const res = await request(app).delete(`/api/import-mapping-templates/${templateId}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    createdTemplateIds.splice(createdTemplateIds.indexOf(templateId), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────
describe("System Diagnostics — Health Checks", () => {
  it("POST /api/diagnostics/run returns structured results with summary", async () => {
    const res = await request(app).post("/api/diagnostics/run");
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("checks");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("runId");
    expect(res.body).toHaveProperty("runAt");
    expect(res.body.simulated).toBe(true);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.length).toBeGreaterThanOrEqual(8);
    const { summary } = res.body;
    expect(summary).toHaveProperty("pass");
    expect(summary).toHaveProperty("warn");
    expect(summary).toHaveProperty("fail");
    expect(summary).toHaveProperty("total");
    expect(summary.total).toBe(res.body.checks.length);
    createdHealthRunIds.push(res.body.runId);
  });

  it("GET /api/diagnostics returns latest run results", async () => {
    const res = await request(app).get("/api/diagnostics");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("checks");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("runId");
  });
});

describe("System Diagnostics — Readiness Checks", () => {
  it("GET /api/diagnostics/readiness returns checks (seeds if none)", async () => {
    const res = await request(app).get("/api/diagnostics/readiness");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Track created ones for cleanup
    for (const check of res.body) {
      if (!createdReadinessIds.includes(check.id)) {
        createdReadinessIds.push(check.id);
      }
    }
  });

  it("POST /api/diagnostics/readiness/run re-evaluates checks", async () => {
    const res = await request(app).post("/api/diagnostics/readiness/run");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("results");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.simulated).toBe(true);
  });

  it("PATCH /api/diagnostics/readiness/:id/override overrides a check", async () => {
    const listRes = await request(app).get("/api/diagnostics/readiness");
    const firstCheck = listRes.body[0];

    const res = await request(app)
      .patch(`/api/diagnostics/readiness/${firstCheck.id}/override`)
      .send({ overrideReason: "Manually verified by admin" });
    expect(res.status).toBe(200);
    expect(res.body.isOverridden).toBe(true);
    expect(res.body.overrideReason).toBe("Manually verified by admin");
  });
});

describe("System Diagnostics — Software Updates", () => {
  let updateId: number;

  it("POST /api/diagnostics/updates creates an update package", async () => {
    const res = await request(app)
      .post("/api/diagnostics/updates")
      .send({ version: `9.9.${Date.now() % 1000}-test`, releaseChannel: "test", releaseNotesEn: "Test package" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    updateId = res.body.id;
    createdUpdatePackageIds.push(updateId);
  });

  it("GET /api/diagnostics/updates returns list of packages", async () => {
    const res = await request(app).get("/api/diagnostics/updates");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("PATCH /api/diagnostics/updates/:id verifies signature (simulated)", async () => {
    const res = await request(app)
      .patch(`/api/diagnostics/updates/${updateId}`)
      .send({ verifySignature: true });
    expect(res.status).toBe(200);
    expect(res.body.signatureValid).toBe(true);
    expect(res.body.status).toBe("verified");
    expect(res.body.simulated).toBe(true);
  });
});

describe("System Diagnostics — Deployment Checklist", () => {
  it("GET /api/diagnostics/deployment-checklist returns items (seeds if none)", async () => {
    const res = await request(app).get("/api/diagnostics/deployment-checklist");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(12);
  });

  it("PATCH /api/diagnostics/deployment-checklist/:itemCode updates status", async () => {
    const res = await request(app)
      .patch("/api/diagnostics/deployment-checklist/db_configured")
      .send({ status: "pass", statusNotes: "Verified by test" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pass");
    expect(res.body.statusNotes).toBe("Verified by test");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PILOT SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────
describe("Pilot Scenarios — CRUD", () => {
  let scenarioId: number;
  const scenarioCode = `TEST_SC_${Date.now()}`;

  it("POST /api/pilot/scenarios creates a new scenario", async () => {
    const res = await request(app)
      .post("/api/pilot/scenarios")
      .send({
        scenarioCode,
        titleEn: "Test Scenario",
        titleAr: "سيناريو اختبار",
        category: "general",
        estimatedMinutes: 10,
        stepsJson: [
          { stepNumber: 1, titleEn: "Step 1", titleAr: "خطوة 1", instructions: "Do step 1" },
          { stepNumber: 2, titleEn: "Step 2", titleAr: "خطوة 2", instructions: "Do step 2" },
          { stepNumber: 3, titleEn: "Step 3", titleAr: "خطوة 3", instructions: "Do step 3" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.scenarioCode).toBe(scenarioCode);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps).toHaveLength(3);
    scenarioId = res.body.id;
    createdScenarioIds.push(scenarioId);
  });

  it("GET /api/pilot/scenarios returns active scenarios", async () => {
    const res = await request(app).get("/api/pilot/scenarios");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((s: any) => s.id === scenarioId)).toBe(true);
  });

  it("GET /api/pilot/scenarios/:id returns scenario with steps", async () => {
    const res = await request(app).get(`/api/pilot/scenarios/${scenarioId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(scenarioId);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });
});

describe("Pilot Scenarios — Progress Tracking", () => {
  let scenarioId: number;
  const scenarioCode = `TEST_PROG_${Date.now()}`;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/pilot/scenarios")
      .send({
        scenarioCode,
        titleEn: "Progress Test",
        titleAr: "اختبار التقدم",
        stepsJson: [
          { stepNumber: 1, titleEn: "S1", titleAr: "خ1", instructions: "Step 1" },
          { stepNumber: 2, titleEn: "S2", titleAr: "خ2", instructions: "Step 2" },
          { stepNumber: 3, titleEn: "S3", titleAr: "خ3", instructions: "Step 3" },
        ],
      });
    scenarioId = res.body.id;
    createdScenarioIds.push(scenarioId);
  });

  it("POST /api/pilot/progress/:scenarioId/start creates progress", async () => {
    const res = await request(app).post(`/api/pilot/progress/${scenarioId}/start`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
    expect(res.body.currentStep).toBe(1);
  });

  it("POST /api/pilot/progress/:scenarioId/advance increments step", async () => {
    const res = await request(app).post(`/api/pilot/progress/${scenarioId}/advance`);
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(2);
  });

  it("GET /api/pilot/progress returns user progress", async () => {
    const res = await request(app).get("/api/pilot/progress");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const prog = res.body.find((p: any) => p.scenarioId === scenarioId);
    expect(prog).toBeDefined();
    expect(prog.status).toBe("in_progress");
  });

  it("POST /api/pilot/progress/:scenarioId/complete marks complete", async () => {
    const res = await request(app).post(`/api/pilot/progress/${scenarioId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("complete");
    expect(res.body.completedAt).toBeTruthy();
  });

  it("POST /api/pilot/reset deletes all progress for user", async () => {
    const res = await request(app).post("/api/pilot/reset");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("deleted");
    expect(typeof res.body.deleted).toBe("number");
  });
});

describe("Pilot Accounts", () => {
  it("GET /api/pilot/accounts returns active accounts", async () => {
    const res = await request(app).get("/api/pilot/accounts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/pilot/accounts creates/upserts a pilot account", async () => {
    const persona = `test_persona_${Date.now()}`;
    const res = await request(app)
      .post("/api/pilot/accounts")
      .send({
        persona,
        labelEn: "Test Persona",
        labelAr: "شخصية اختبار",
        systemUsername: `demo.${persona}`,
        roleType: "employee",
      });
    expect(res.status).toBe(201);
    expect(res.body.persona).toBe(persona);
    createdPilotAccountIds.push(res.body.id);
  });
});
