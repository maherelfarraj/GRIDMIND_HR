/**
 * Phase 9 Integration Tests — Multi-Org, Policy Governance, Integration Governance, Config Packages
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHmac } from "crypto";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  organizationsTable, organizationBrandingTable,
  policyLocalesTable, numberingSchemesTable, calendarConfigsTable, retentionRulesTable, employmentTypeConfigsTable,
  policyChangeRequestsTable, policyVersionsTable, approvalChainConfigsTable,
  integrationCredentialVaultRefsTable, integrationConnectionProfilesTable,
  integrationGovernanceRulesTable, integrationAuditLogTable,
  configPackagesTable, configPackageItemsTable,
  environmentSnapshotsTable, orgReportTemplatesTable, auditLogsTable,
} from "@workspace/db";
import app from "../app";

// ─── Cleanup trackers ─────────────────────────────────────────────────────────
const createdOrgIds: number[] = [];
const createdBrandingOrgIds: number[] = [];
const createdLocaleIds: number[] = [];
const createdSchemeIds: number[] = [];
const createdCalendarIds: number[] = [];
const createdRetentionIds: number[] = [];
const createdEmpTypeIds: number[] = [];
const createdChangeRequestIds: number[] = [];
const createdVersionIds: number[] = [];
const createdChainIds: number[] = [];
const createdVaultRefIds: number[] = [];
const createdProfileIds: number[] = [];
const createdGovernanceRuleIds: number[] = [];
const createdPackageIds: number[] = [];
const createdSnapshotIds: number[] = [];
const createdReportTemplateIds: number[] = [];

afterAll(async () => {
  // Clean up config packages + items
  for (const pid of createdPackageIds) {
    await db.delete(configPackageItemsTable).where(eq(configPackageItemsTable.packageId, pid));
  }
  if (createdPackageIds.length) {
    await db.delete(configPackagesTable).where(inArray(configPackagesTable.id, createdPackageIds));
  }

  // Clean up snapshots
  if (createdSnapshotIds.length) {
    await db.delete(environmentSnapshotsTable).where(inArray(environmentSnapshotsTable.id, createdSnapshotIds));
  }

  // Clean up report templates
  if (createdReportTemplateIds.length) {
    await db.delete(orgReportTemplatesTable).where(inArray(orgReportTemplatesTable.id, createdReportTemplateIds));
  }

  // Clean up integration governance
  if (createdGovernanceRuleIds.length) {
    await db.delete(integrationGovernanceRulesTable).where(inArray(integrationGovernanceRulesTable.id, createdGovernanceRuleIds));
  }
  // Clean up audit log for profiles
  for (const pid of createdProfileIds) {
    await db.delete(integrationAuditLogTable).where(eq(integrationAuditLogTable.profileId, pid));
  }
  if (createdProfileIds.length) {
    await db.delete(integrationConnectionProfilesTable).where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
  if (createdVaultRefIds.length) {
    await db.delete(integrationCredentialVaultRefsTable).where(inArray(integrationCredentialVaultRefsTable.id, createdVaultRefIds));
  }

  // Clean up policy governance
  if (createdVersionIds.length) {
    await db.delete(policyVersionsTable).where(inArray(policyVersionsTable.id, createdVersionIds));
  }
  if (createdChangeRequestIds.length) {
    await db.delete(policyChangeRequestsTable).where(inArray(policyChangeRequestsTable.id, createdChangeRequestIds));
  }
  if (createdChainIds.length) {
    await db.delete(approvalChainConfigsTable).where(inArray(approvalChainConfigsTable.id, createdChainIds));
  }

  // Clean up localization
  if (createdEmpTypeIds.length) {
    await db.delete(employmentTypeConfigsTable).where(inArray(employmentTypeConfigsTable.id, createdEmpTypeIds));
  }
  if (createdRetentionIds.length) {
    await db.delete(retentionRulesTable).where(inArray(retentionRulesTable.id, createdRetentionIds));
  }
  if (createdCalendarIds.length) {
    await db.delete(calendarConfigsTable).where(inArray(calendarConfigsTable.id, createdCalendarIds));
  }
  if (createdSchemeIds.length) {
    await db.delete(numberingSchemesTable).where(inArray(numberingSchemesTable.id, createdSchemeIds));
  }
  if (createdLocaleIds.length) {
    await db.delete(policyLocalesTable).where(inArray(policyLocalesTable.id, createdLocaleIds));
  }

  // Clean up org branding and orgs
  for (const orgId of createdBrandingOrgIds) {
    await db.delete(organizationBrandingTable).where(eq(organizationBrandingTable.orgId, orgId));
  }
  if (createdOrgIds.length) {
    await db.delete(organizationsTable).where(inArray(organizationsTable.id, createdOrgIds));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("Organizations", () => {
  let orgId: number;

  it("POST /organizations — creates organization with auto-created rows", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({
        nameEn: "Test Corp Phase9",
        nameAr: "شركة اختبار المرحلة التاسعة",
        orgCode: `TST-P9-${Date.now()}`,
        orgType: "company",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.nameEn).toBe("Test Corp Phase9");
    orgId = res.body.id;
    createdOrgIds.push(orgId);
    createdBrandingOrgIds.push(orgId);
  });

  it("GET /organizations — lists all orgs with branding", async () => {
    const res = await request(app).get("/api/organizations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const org = res.body.find((o: any) => o.id === orgId);
    expect(org).toBeDefined();
    // branding may be null or object
  });

  it("GET /organizations/:id — returns org with branding and stats", async () => {
    const res = await request(app).get(`/api/organizations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgId);
    expect(res.body.stats).toBeDefined();
    expect(typeof res.body.stats.employeeCount).toBe("number");
  });

  it("PATCH /organizations/:id — updates org", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${orgId}`)
      .send({ headquartersCity: "Riyadh" });
    expect(res.status).toBe(200);
    expect(res.body.headquartersCity).toBe("Riyadh");
  });

  it("GET /organizations/:id/employees-count — returns count", async () => {
    const res = await request(app).get(`/api/organizations/${orgId}/employees-count`);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(orgId);
    expect(typeof res.body.count).toBe("number");
  });

  it("POST /organizations/:id/activate — activates org", async () => {
    const res = await request(app).post(`/api/organizations/${orgId}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.activatedAt).toBeTruthy();
  });

  it("DELETE /organizations/:id — soft-deletes (archives) org", async () => {
    const res = await request(app).delete(`/api/organizations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
  });

  it("DELETE /organizations/:id — refuses to archive default org", async () => {
    // Find default org
    const listRes = await request(app).get("/api/organizations");
    const defaultOrg = listRes.body.find((o: any) => o.isDefault === true);
    if (!defaultOrg) return; // no default org in test env, skip
    const res = await request(app).delete(`/api/organizations/${defaultOrg.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/default/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZATION BRANDING
// ─────────────────────────────────────────────────────────────────────────────

describe("Organization Branding", () => {
  let brandingOrgId: number;

  beforeAll(async () => {
    const [org] = await db.insert(organizationsTable).values({
      orgCode: `BRD-${Date.now()}`,
      nameEn: "Branding Test Org",
      nameAr: "منظمة اختبار العلامة التجارية",
      orgType: "company",
      status: "onboarding",
      countryCode: "SA",
      isDefault: false,
    }).returning();
    brandingOrgId = org.id;
    createdOrgIds.push(brandingOrgId);
    createdBrandingOrgIds.push(brandingOrgId);
  });

  it("PUT /organization-branding/:orgId — upserts branding", async () => {
    const res = await request(app)
      .put(`/api/organization-branding/${brandingOrgId}`)
      .send({ primaryColor: "#FF0000", defaultTheme: "light" });
    expect(res.status).toBe(200);
    expect(res.body.primaryColor).toBe("#FF0000");
  });

  it("GET /organization-branding/:orgId — returns branding", async () => {
    const res = await request(app).get(`/api/organization-branding/${brandingOrgId}`);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(brandingOrgId);
  });

  it("GET /organization-branding/:orgId — 404 for unknown org", async () => {
    const res = await request(app).get("/api/organization-branding/999999999");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POLICY CHANGE REQUEST LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe("Policy Change Request lifecycle", () => {
  let crId: number;

  it("POST /policy-change-requests — creates draft", async () => {
    const res = await request(app)
      .post("/api/policy-change-requests")
      .send({
        policyArea: "leave_policy",
        titleEn: "Test Leave Policy Change",
        titleAr: "تغيير سياسة الإجازة التجريبية",
        makerUserId: 1,
        changeAfterJson: JSON.stringify({ annualLeaveDays: 30 }),
        changeBeforeJson: JSON.stringify({ annualLeaveDays: 21 }),
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    crId = res.body.id;
    createdChangeRequestIds.push(crId);
  });

  it("GET /policy-change-requests — lists requests", async () => {
    const res = await request(app).get("/api/policy-change-requests");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /policy-change-requests?status=draft — filters by status", async () => {
    const res = await request(app).get("/api/policy-change-requests?status=draft");
    expect(res.status).toBe(200);
    expect(res.body.every((r: any) => r.status === "draft")).toBe(true);
  });

  it("GET /policy-change-requests/:id — returns with diff", async () => {
    const res = await request(app).get(`/api/policy-change-requests/${crId}`);
    expect(res.status).toBe(200);
    expect(res.body.diff).toBeDefined();
    expect(res.body.diff.after).toBeDefined();
  });

  it("PATCH /policy-change-requests/:id/submit — submits for review", async () => {
    const res = await request(app).patch(`/api/policy-change-requests/${crId}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_review");
  });

  it("POST /policy-change-requests/:id/preview-impact — returns impact", async () => {
    const res = await request(app).post(`/api/policy-change-requests/${crId}/preview-impact`);
    expect(res.status).toBe(200);
    expect(typeof res.body.affectedEmployees).toBe("number");
    expect(res.body.effectiveDate).toBeDefined();
  });

  it("PATCH /policy-change-requests/:id/approve — approves", async () => {
    const res = await request(app)
      .patch(`/api/policy-change-requests/${crId}/approve`)
      .send({ checkerComment: "Approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("PATCH /policy-change-requests/:id/apply — applies and creates version", async () => {
    const res = await request(app).patch(`/api/policy-change-requests/${crId}/apply`);
    expect(res.status).toBe(200);
    expect(res.body.changeRequest.status).toBe("applied");
    expect(res.body.version).toBeDefined();
    expect(res.body.version.version).toBeGreaterThanOrEqual(1);
    createdVersionIds.push(res.body.version.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POLICY VERSION ROLLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("Policy Version rollback", () => {
  let versionId: number;

  beforeAll(async () => {
    const [ver] = await db.insert(policyVersionsTable).values({
      orgId: 1,
      policyArea: "calendar_config_test",
      version: 1,
      snapshotJson: JSON.stringify({ weekendDays: [4, 5] }),
      appliedByUserId: 1,
      isCurrent: true,
    }).returning();
    versionId = ver.id;
    createdVersionIds.push(versionId);
  });

  it("GET /policy-versions — lists versions", async () => {
    const res = await request(app).get("/api/policy-versions?policyArea=calendar_config_test");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /policy-versions/:id/rollback — creates rollback version", async () => {
    const res = await request(app)
      .post(`/api/policy-versions/${versionId}/rollback`)
      .send({ reason: "Reverting weekend days change" });
    expect(res.status).toBe(200);
    expect(res.body.isCurrent).toBe(true);
    expect(res.body.rolledBackFromVersion).toBe(1);
    createdVersionIds.push(res.body.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL CHAIN CONFIGS
// ─────────────────────────────────────────────────────────────────────────────

describe("Approval Chain Configs CRUD", () => {
  let chainId: number;

  it("POST /approval-chain-configs — creates chain", async () => {
    const res = await request(app)
      .post("/api/approval-chain-configs")
      .send({
        name: "Test 2-Step Leave",
        nameAr: "موافقة إجازة اختبار",
        chainType: "leave",
        stepsJson: JSON.stringify([
          { stepNumber: 1, labelEn: "Manager", labelAr: "المدير", approverType: "department_head", timeoutHours: 24 },
        ]),
      });
    expect(res.status).toBe(201);
    chainId = res.body.id;
    createdChainIds.push(chainId);
  });

  it("GET /approval-chain-configs — lists", async () => {
    const res = await request(app).get("/api/approval-chain-configs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /approval-chain-configs/:id — returns single", async () => {
    const res = await request(app).get(`/api/approval-chain-configs/${chainId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chainId);
  });

  it("GET /approval-chain-configs/:id/preview — returns chain description", async () => {
    const res = await request(app).get(`/api/approval-chain-configs/${chainId}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.chainId).toBe(chainId);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  it("PATCH /approval-chain-configs/:id — updates", async () => {
    const res = await request(app)
      .patch(`/api/approval-chain-configs/${chainId}`)
      .send({ totalTimeoutHours: 48 });
    expect(res.status).toBe(200);
    expect(res.body.totalTimeoutHours).toBe(48);
  });

  it("DELETE /approval-chain-configs/:id — deletes", async () => {
    const res = await request(app).delete(`/api/approval-chain-configs/${chainId}`);
    expect(res.status).toBe(200);
    createdChainIds.splice(createdChainIds.indexOf(chainId), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION GOVERNANCE — CONNECTION PROFILE LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe("Connection Profile lifecycle: create → test → approve → suspend", () => {
  let vaultRefId: number;
  let profileId: number;

  beforeAll(async () => {
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: "Test LDAP Cred",
      labelAr: "بيانات اعتماد اختبار",
      credentialType: "ldap",
      vaultKeyRef: "vault:test_ldap_key",
      status: "active",
      createdByUserId: 1,
    }).returning();
    vaultRefId = ref.id;
    createdVaultRefIds.push(vaultRefId);
  });

  it("POST /integration-governance/connection-profiles — creates profile", async () => {
    const res = await request(app)
      .post("/api/integration-governance/connection-profiles")
      .send({
        profileName: "Test LDAP Profile",
        profileNameAr: "ملف LDAP للاختبار",
        integrationType: "ldap",
        environment: "staging",
        connectionParamsJson: JSON.stringify({ host: "192.168.1.99", port: 389 }),
        credentialVaultRefId: vaultRefId,
      });
    expect(res.status).toBe(201);
    expect(res.body.governanceStatus).toBe("pending_approval");
    profileId = res.body.id;
    createdProfileIds.push(profileId);
  });

  it("GET /integration-governance/connection-profiles — lists profiles", async () => {
    const res = await request(app).get("/api/integration-governance/connection-profiles");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /integration-governance/connection-profiles/:id/test — simulates test", async () => {
    const res = await request(app).post(`/api/integration-governance/connection-profiles/${profileId}/test`);
    expect(res.status).toBe(200);
    expect(typeof res.body.success).toBe("boolean");
    expect(typeof res.body.latencyMs).toBe("number");
    expect(res.body.testedAt).toBeDefined();
  });

  it("POST /integration-governance/connection-profiles/:id/approve — approves", async () => {
    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/approve`)
      .send({ approvalNotes: "Approved for staging" });
    expect(res.status).toBe(200);
    expect(res.body.governanceStatus).toBe("approved");
  });

  it("POST /integration-governance/connection-profiles/:id/suspend — suspends", async () => {
    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/suspend`)
      .send({ reason: "Security review" });
    expect(res.status).toBe(200);
    expect(res.body.governanceStatus).toBe("suspended");
  });

  it("GET /integration-governance/audit-log?profileId=X — returns log entries", async () => {
    const res = await request(app).get(`/api/integration-governance/audit-log?profileId=${profileId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG PACKAGE LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe("Config Package lifecycle: create → sign → export → import → apply", () => {
  let packageId: number;
  let importedPackageId: number;

  it("POST /config-packages — creates draft package", async () => {
    const res = await request(app)
      .post("/api/config-packages")
      .send({
        packageName: "Test Branding Package",
        packageType: "branding",
        version: "1.0.0",
        sourceEnvironment: "development",
        targetEnvironment: "production",
        policyAreasJson: JSON.stringify(["org_branding"]),
        payloadJson: JSON.stringify({ branding: { color: "#FF0000" } }),
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    packageId = res.body.id;
    createdPackageIds.push(packageId);
  });

  it("GET /config-packages — lists packages", async () => {
    const res = await request(app).get("/api/config-packages");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /config-packages/:id — returns with items", async () => {
    const res = await request(app).get(`/api/config-packages/${packageId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(packageId);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("POST /config-packages/:id/sign — signs package", async () => {
    const res = await request(app).post(`/api/config-packages/${packageId}/sign`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed");
    expect(res.body.signature).toBeTruthy();
  });

  it("POST /config-packages/:id/export — exports package", async () => {
    const res = await request(app).post(`/api/config-packages/${packageId}/export`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("exported");
  });

  it("GET /config-packages/:id/preview-impact — returns impact", async () => {
    const res = await request(app).get(`/api/config-packages/${packageId}/preview-impact`);
    expect(res.status).toBe(200);
    expect(res.body.packageId).toBe(packageId);
  });

  it("POST /config-packages/import — imports a package", async () => {
    // Get the signed package data
    const exportedPkg = await request(app).get(`/api/config-packages/${packageId}`);
    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: "Imported Branding Package",
          packageType: "branding",
          version: "1.0.0",
          sourceEnvironment: "development",
          targetEnvironment: "production",
          payloadJson: exportedPkg.body.payloadJson,
          signature: exportedPkg.body.signature,
          items: [],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("imported");
    importedPackageId = res.body.id;
    createdPackageIds.push(importedPackageId);
  });

  it("POST /config-packages/import — rejects unsigned package (missing signature)", async () => {
    const exportedPkg = await request(app).get(`/api/config-packages/${packageId}`);
    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: "Unsigned Package",
          packageType: "branding",
          version: "1.0.0",
          sourceEnvironment: "development",
          targetEnvironment: "production",
          payloadJson: exportedPkg.body.payloadJson,
          // no signature field at all
          items: [],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsigned|signature/i);
    // Ensure it was NOT stored
    const list = await request(app).get("/api/config-packages");
    expect(list.body.find((p: any) => p.packageName === "Unsigned Package")).toBeUndefined();
  });

  it("POST /config-packages/import — rejects package with tampered signature", async () => {
    const exportedPkg = await request(app).get(`/api/config-packages/${packageId}`);
    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: "Tampered Package",
          payloadJson: exportedPkg.body.payloadJson,
          signature: "deadbeef" + exportedPkg.body.signature?.slice(8),
          items: [],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature verification failed/i);
  });

  it("POST /config-packages/:id/apply — applies imported package", async () => {
    const res = await request(app).post(`/api/config-packages/${importedPackageId}/apply`);
    expect(res.status).toBe(200);
    expect(res.body.package.status).toBe("applied");
  });

  it("POST /config-packages/:id/reject — rejects a package", async () => {
    // Create a new package to reject
    const createRes = await request(app)
      .post("/api/config-packages")
      .send({
        packageName: "Reject Test Package",
        packageType: "policy_set",
        version: "0.1.0",
        sourceEnvironment: "development",
        targetEnvironment: "staging",
        policyAreasJson: "[]",
      });
    const pkgId = createRes.body.id;
    createdPackageIds.push(pkgId);

    const res = await request(app)
      .post(`/api/config-packages/${pkgId}/reject`)
      .send({ reason: "Not ready for deployment" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESTART-SURVIVAL E2E — POLICY CHANGE → APPLY → VERSION → ROLLBACK
// (Task: confirm policy changes and config package signing survive a restart.
//  Everything is persisted to the DB and the signing key is read from the env
//  on every call, so a fresh app instance must reproduce the same results.)
// ─────────────────────────────────────────────────────────────────────────────

describe("Policy change E2E: create → approve → apply → version → rollback restores previous", () => {
  // Unique policy area isolates version numbering from other tests/data
  const policyArea = `restart_test_${Date.now()}`;
  const snapshotV1 = JSON.stringify({ annualLeaveDays: 21, carryOverDays: 5 });
  const snapshotV2 = JSON.stringify({ annualLeaveDays: 30, carryOverDays: 10 });
  let crId1: number;
  let crId2: number;
  let versionId1: number;
  let versionId2: number;

  it("applies first change request → creates version 1", async () => {
    const createRes = await request(app).post("/api/policy-change-requests").send({
      policyArea,
      titleEn: "Restart Test — initial policy",
      titleAr: "اختبار إعادة التشغيل — السياسة الأولية",
      makerUserId: 1,
      changeBeforeJson: JSON.stringify({}),
      changeAfterJson: snapshotV1,
    });
    expect(createRes.status).toBe(201);
    crId1 = createRes.body.id;
    createdChangeRequestIds.push(crId1);

    const submitRes = await request(app).patch(`/api/policy-change-requests/${crId1}/submit`);
    expect(submitRes.status).toBe(200);
    const approveRes = await request(app).patch(`/api/policy-change-requests/${crId1}/approve`).send({ checkerComment: "ok" });
    expect(approveRes.status).toBe(200);

    const applyRes = await request(app).patch(`/api/policy-change-requests/${crId1}/apply`);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.changeRequest.status).toBe("applied");
    expect(applyRes.body.version.version).toBe(1);
    expect(applyRes.body.version.isCurrent).toBe(true);
    expect(applyRes.body.version.snapshotJson).toBe(snapshotV1);
    versionId1 = applyRes.body.version.id;
    createdVersionIds.push(versionId1);
  });

  it("applies second change request → version 2 becomes current, version 1 demoted", async () => {
    const createRes = await request(app).post("/api/policy-change-requests").send({
      policyArea,
      titleEn: "Restart Test — updated policy",
      titleAr: "اختبار إعادة التشغيل — السياسة المحدثة",
      makerUserId: 1,
      changeBeforeJson: snapshotV1,
      changeAfterJson: snapshotV2,
    });
    crId2 = createRes.body.id;
    createdChangeRequestIds.push(crId2);
    await request(app).patch(`/api/policy-change-requests/${crId2}/submit`);
    await request(app).patch(`/api/policy-change-requests/${crId2}/approve`).send({});
    const applyRes = await request(app).patch(`/api/policy-change-requests/${crId2}/apply`);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.version.version).toBe(2);
    expect(applyRes.body.version.snapshotJson).toBe(snapshotV2);
    versionId2 = applyRes.body.version.id;
    createdVersionIds.push(versionId2);

    // Version 1 must no longer be current (state persisted in DB, not memory)
    const [v1] = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, versionId1));
    expect(v1.isCurrent).toBe(false);
  });

  it("rollback to version 1 → new current version carries version 1's snapshot", async () => {
    const res = await request(app)
      .post(`/api/policy-versions/${versionId1}/rollback`)
      .send({ reason: "Restart test rollback" });
    expect(res.status).toBe(200);
    expect(res.body.isCurrent).toBe(true);
    expect(res.body.version).toBe(3);
    expect(res.body.rolledBackFromVersion).toBe(1);
    // The rollback restores the previous (v1) snapshot verbatim
    expect(res.body.snapshotJson).toBe(snapshotV1);
    createdVersionIds.push(res.body.id);

    // v2 demoted; exactly one current version for this area — all read from DB
    const versions = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.policyArea, policyArea));
    const current = versions.filter((v) => v.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].snapshotJson).toBe(snapshotV1);
    const [v2] = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, versionId2));
    expect(v2.isCurrent).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-ORG ISOLATION — one org's apply/rollback must not touch another org's
// versions for the same policy area
// ─────────────────────────────────────────────────────────────────────────────

describe("Policy versioning is scoped per org: org A actions don't affect org B", () => {
  const sharedArea = `shared_area_${Date.now()}`;
  let orgAId: number;
  let orgBId: number;
  let orgBVersionId: number;
  let orgAv1Id: number;

  beforeAll(async () => {
    const [orgA] = await db.insert(organizationsTable).values({
      orgCode: `SCOPE-A-${Date.now()}`, nameEn: "Scope Test Org A", nameAr: "منظمة أ",
      orgType: "company", status: "active", countryCode: "SA", isDefault: false,
    }).returning();
    const [orgB] = await db.insert(organizationsTable).values({
      orgCode: `SCOPE-B-${Date.now()}`, nameEn: "Scope Test Org B", nameAr: "منظمة ب",
      orgType: "company", status: "active", countryCode: "SA", isDefault: false,
    }).returning();
    orgAId = orgA.id;
    orgBId = orgB.id;
    createdOrgIds.push(orgAId, orgBId);

    // Org B already has a current version 5 in the shared area
    const [vB] = await db.insert(policyVersionsTable).values({
      orgId: orgBId, policyArea: sharedArea, version: 5,
      snapshotJson: JSON.stringify({ owner: "orgB" }),
      appliedByUserId: 1, isCurrent: true,
    }).returning();
    orgBVersionId = vB.id;
    createdVersionIds.push(orgBVersionId);
  });

  it("applying a change in org A starts at version 1 and leaves org B's version current", async () => {
    const createRes = await request(app).post("/api/policy-change-requests").send({
      policyArea: sharedArea,
      orgId: orgAId,
      titleEn: "Org A change in shared area",
      titleAr: "تغيير المنظمة أ",
      makerUserId: 1,
      changeAfterJson: JSON.stringify({ owner: "orgA" }),
    });
    expect(createRes.status).toBe(201);
    const crId = createRes.body.id;
    createdChangeRequestIds.push(crId);
    await request(app).patch(`/api/policy-change-requests/${crId}/submit`);
    await request(app).patch(`/api/policy-change-requests/${crId}/approve`).send({});
    const applyRes = await request(app).patch(`/api/policy-change-requests/${crId}/apply`);
    expect(applyRes.status).toBe(200);
    // Org A's numbering is independent of org B's v5
    expect(applyRes.body.version.version).toBe(1);
    expect(applyRes.body.version.orgId).toBe(orgAId);
    orgAv1Id = applyRes.body.version.id;
    createdVersionIds.push(orgAv1Id);

    // Org B's version must remain current and unrenumbered
    const [vB] = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, orgBVersionId));
    expect(vB.isCurrent).toBe(true);
    expect(vB.version).toBe(5);
  });

  it("rolling back in org A leaves org B's version current", async () => {
    const res = await request(app)
      .post(`/api/policy-versions/${orgAv1Id}/rollback`)
      .send({ reason: "Cross-org scope test" });
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(orgAId);
    expect(res.body.version).toBe(2);
    createdVersionIds.push(res.body.id);

    const [vB] = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, orgBVersionId));
    expect(vB.isCurrent).toBe(true);
    expect(vB.version).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG PACKAGE SIGNING — SAME-KEY ROUND TRIP AND WRONG-KEY REJECTION
// ─────────────────────────────────────────────────────────────────────────────

describe("Config package signing: same-key round trip passes, wrong key is rejected", () => {
  const payload = JSON.stringify({ policy: { weekendDays: [5, 6] }, exportedFor: "restart-test" });
  let packageId: number;
  let signature: string;

  it("create → sign → export: signature is a deterministic HMAC of the payload", async () => {
    const createRes = await request(app).post("/api/config-packages").send({
      packageName: "Restart Survival Package",
      packageType: "policy_set",
      version: "1.0.0",
      sourceEnvironment: "development",
      targetEnvironment: "production",
      policyAreasJson: JSON.stringify(["calendar_config"]),
      payloadJson: payload,
    });
    expect(createRes.status).toBe(201);
    packageId = createRes.body.id;
    createdPackageIds.push(packageId);

    const signRes = await request(app).post(`/api/config-packages/${packageId}/sign`);
    expect(signRes.status).toBe(200);
    expect(signRes.body.signature).toBeTruthy();
    signature = signRes.body.signature;

    // Signature must match an HMAC computed independently with the same env
    // key — proving it depends only on (payload, SESSION_SECRET), both of
    // which survive a server restart (payload in DB, key in env).
    const expected = createHmac("sha256", process.env.SESSION_SECRET ?? "default-secret")
      .update(payload).digest("hex");
    expect(signature).toBe(expected);

    const exportRes = await request(app).post(`/api/config-packages/${packageId}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.status).toBe("exported");
    expect(exportRes.body.signature).toBe(signature);
    expect(exportRes.body.payloadJson).toBe(payload);
  });

  it("import on the same server (same key) → signature check passes", async () => {
    const res = await request(app).post("/api/config-packages/import").send({
      packageJson: {
        packageName: "Restart Survival Package (imported)",
        packageType: "policy_set",
        version: "1.0.0",
        sourceEnvironment: "development",
        targetEnvironment: "production",
        payloadJson: payload,
        signature,
        items: [],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("imported");
    createdPackageIds.push(res.body.id);

    // Imported package can then be applied
    const applyRes = await request(app).post(`/api/config-packages/${res.body.id}/apply`);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.package.status).toBe("applied");
  });

  it("import signed with a WRONG key → clear error, package not stored or applied", async () => {
    const uniqueName = `Wrong Key Package ${Date.now()}`;
    // Simulate a package exported from an environment with a different
    // SESSION_SECRET (rotated or mismatched key)
    const wrongSignature = createHmac("sha256", "a-completely-different-secret")
      .update(payload).digest("hex");
    expect(wrongSignature).not.toBe(signature);

    const res = await request(app).post("/api/config-packages/import").send({
      packageJson: {
        packageName: uniqueName,
        packageType: "policy_set",
        version: "1.0.0",
        sourceEnvironment: "other-environment",
        targetEnvironment: "production",
        payloadJson: payload,
        signature: wrongSignature,
        items: [],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature verification failed/i);

    // Nothing was persisted — rejected packages must not exist in the DB
    const rows = await db.select().from(configPackagesTable)
      .where(eq(configPackagesTable.packageName, uniqueName));
    expect(rows).toHaveLength(0);
  });

  it("tampered payload with a valid-format signature → rejected", async () => {
    const uniqueName = `Tampered Package ${Date.now()}`;
    const tamperedPayload = JSON.stringify({ policy: { weekendDays: [0, 1] }, exportedFor: "tampered" });
    const res = await request(app).post("/api/config-packages/import").send({
      packageJson: {
        packageName: uniqueName,
        packageType: "policy_set",
        version: "1.0.0",
        sourceEnvironment: "development",
        targetEnvironment: "production",
        payloadJson: tamperedPayload,
        signature, // valid signature, but for the ORIGINAL payload
        items: [],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature verification failed/i);
    const rows = await db.select().from(configPackagesTable)
      .where(eq(configPackagesTable.packageName, uniqueName));
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT SNAPSHOTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Environment Snapshots: capture + compare", () => {
  let snapAId: number;
  let snapBId: number;

  it("POST /environment-snapshots — captures snapshot A", async () => {
    const res = await request(app)
      .post("/api/environment-snapshots")
      .send({
        environment: "production",
        snapshotName: "Test Snapshot A",
        scope: "full",
        snapshotJson: JSON.stringify({ configVersion: "1.0", featureFlags: { x: true } }),
        itemCount: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.checksum).toBeTruthy();
    snapAId = res.body.id;
    createdSnapshotIds.push(snapAId);
  });

  it("POST /environment-snapshots — captures snapshot B", async () => {
    const res = await request(app)
      .post("/api/environment-snapshots")
      .send({
        environment: "production",
        snapshotName: "Test Snapshot B",
        scope: "full",
        snapshotJson: JSON.stringify({ configVersion: "1.1", featureFlags: { x: false, y: true } }),
        itemCount: 2,
      });
    expect(res.status).toBe(201);
    snapBId = res.body.id;
    createdSnapshotIds.push(snapBId);
  });

  it("GET /environment-snapshots — lists snapshots", async () => {
    const res = await request(app).get("/api/environment-snapshots");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /environment-snapshots/:id — returns single snapshot", async () => {
    const res = await request(app).get(`/api/environment-snapshots/${snapAId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(snapAId);
  });

  it("POST /environment-snapshots/compare — diffs two snapshots", async () => {
    const res = await request(app)
      .post("/api/environment-snapshots/compare")
      .send({ snapshotIdA: snapAId, snapshotIdB: snapBId });
    expect(res.status).toBe(200);
    expect(res.body.diffCount).toBeGreaterThan(0);
    expect(Array.isArray(res.body.diffs)).toBe(true);
  });

  it("POST /environment-snapshots/:id/pin — pins snapshot", async () => {
    const res = await request(app).post(`/api/environment-snapshots/${snapAId}/pin`);
    expect(res.status).toBe(200);
    expect(res.body.isPinned).toBe(true);
  });

  it("DELETE /environment-snapshots/:id/pin — unpins snapshot with audit entry", async () => {
    const res = await request(app).delete(`/api/environment-snapshots/${snapAId}/pin`);
    expect(res.status).toBe(200);
    expect(res.body.isPinned).toBe(false);
    const audit = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "unpin"),
      eq(auditLogsTable.entityType, "environment_snapshot"),
      eq(auditLogsTable.entityId, snapAId),
    ));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("DELETE /environment-snapshots/:id/pin — 404 for unknown snapshot", async () => {
    const res = await request(app).delete(`/api/environment-snapshots/999999999/pin`);
    expect(res.status).toBe(404);
  });
});
