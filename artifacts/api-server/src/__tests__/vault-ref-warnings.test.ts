/**
 * Vault-ref warning tests — verifies that:
 *  1. Profile create/update with a missing env var yields a warning but still saves.
 *  2. Profile create/update with a configured env var yields no warning.
 *  3. Vault-ref list and get endpoints report configured/missing status per ref.
 *  4. Secret values never appear in any response.
 *
 * Self-cleaning: all DB rows created here are deleted in afterAll.
 * Env vars are saved/restored so other suites aren't affected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  integrationCredentialVaultRefsTable,
  integrationConnectionProfilesTable,
  integrationAuditLogTable,
} from "@workspace/db";
import app from "../app";

// ─── Env save/restore ─────────────────────────────────────────────────────────

const TEST_KEY = "VAULT_WARN_TEST_KEY_UNIQUE_XYZZY";
const TEST_SECRET = "VAULT_WARN_TEST_SECRET_UNIQUE_XYZZY";
let savedKey: string | undefined;
let savedSecret: string | undefined;

beforeAll(() => {
  savedKey = process.env[TEST_KEY];
  savedSecret = process.env[TEST_SECRET];
  // Start both unset so we control them per-test
  delete process.env[TEST_KEY];
  delete process.env[TEST_SECRET];
});

afterAll(() => {
  if (savedKey === undefined) delete process.env[TEST_KEY];
  else process.env[TEST_KEY] = savedKey;
  if (savedSecret === undefined) delete process.env[TEST_SECRET];
  else process.env[TEST_SECRET] = savedSecret;
});

// ─── DB cleanup ───────────────────────────────────────────────────────────────

const createdVaultRefIds: number[] = [];
const createdProfileIds: number[] = [];

afterAll(async () => {
  if (createdProfileIds.length) {
    await db.delete(integrationAuditLogTable)
      .where(inArray(integrationAuditLogTable.profileId, createdProfileIds));
    await db.delete(integrationConnectionProfilesTable)
      .where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
  if (createdVaultRefIds.length) {
    await db.delete(integrationCredentialVaultRefsTable)
      .where(inArray(integrationCredentialVaultRefsTable.id, createdVaultRefIds));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uniqueLabel(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
}

async function createVaultRefViaApi(
  vaultKeyRef: string,
  vaultSecretRef?: string,
): Promise<{ status: number; body: any }> {
  const res = await request(app)
    .post("/api/integration-governance/credential-vault-refs")
    .send({
      labelEn: uniqueLabel("Warn Test Cred"),
      labelAr: "بيانات اعتماد اختبار التحذير",
      credentialType: "ldap",
      vaultKeyRef,
      ...(vaultSecretRef ? { vaultSecretRef } : {}),
      status: "active",
    });
  if (res.body?.id) createdVaultRefIds.push(res.body.id);
  return { status: res.status, body: res.body };
}

async function createProfileViaApi(
  vaultRefId: number | null,
): Promise<{ status: number; body: any }> {
  const res = await request(app)
    .post("/api/integration-governance/connection-profiles")
    .send({
      profileName: uniqueLabel("Warn Test Profile"),
      profileNameAr: "ملف اختبار التحذير",
      integrationType: "ldap",
      environment: "staging",
      connectionParamsJson: "{}",
      ...(vaultRefId !== null ? { credentialVaultRefId: vaultRefId } : {}),
    });
  if (res.body?.id) createdProfileIds.push(res.body.id);
  return { status: res.status, body: res.body };
}

// ─── Vault-ref create: missing env var ───────────────────────────────────────

describe("Vault-ref create: missing env var", () => {
  it("saves successfully (201) even when vaultKeyRef env var is not set", async () => {
    delete process.env[TEST_KEY];
    const { status, body } = await createVaultRefViaApi(TEST_KEY);
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.vaultKeyRef).toBe(TEST_KEY);
  });

  it("returns a warnings array mentioning the unconfigured key", async () => {
    delete process.env[TEST_KEY];
    const { body } = await createVaultRefViaApi(TEST_KEY);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0]).toContain(TEST_KEY);
  });

  it("returns configured: false when env var is absent", async () => {
    delete process.env[TEST_KEY];
    const { body } = await createVaultRefViaApi(TEST_KEY);
    expect(body.configured).toBe(false);
  });

  it("warns about vaultSecretRef too when it is also unset", async () => {
    delete process.env[TEST_KEY];
    delete process.env[TEST_SECRET];
    const { body } = await createVaultRefViaApi(TEST_KEY, TEST_SECRET);
    const msgs: string[] = body.warnings;
    expect(msgs.some((w) => w.includes(TEST_KEY))).toBe(true);
    expect(msgs.some((w) => w.includes(TEST_SECRET))).toBe(true);
  });

  it("does NOT expose the secret value or any partial of it", async () => {
    process.env[TEST_KEY] = "super-secret-value-abc123";
    const { body } = await createVaultRefViaApi(TEST_KEY);
    const payload = JSON.stringify(body);
    expect(payload).not.toContain("super-secret-value-abc123");
    delete process.env[TEST_KEY];
  });
});

// ─── Vault-ref create: env var IS set ────────────────────────────────────────

describe("Vault-ref create: env var is configured", () => {
  it("saves successfully with no warnings when env var is present", async () => {
    process.env[TEST_KEY] = "some-secret-value";
    const { status, body } = await createVaultRefViaApi(TEST_KEY);
    expect(status).toBe(201);
    expect(body.warnings).toEqual([]);
    delete process.env[TEST_KEY];
  });

  it("returns configured: true when env var is present", async () => {
    process.env[TEST_KEY] = "some-secret-value";
    const { body } = await createVaultRefViaApi(TEST_KEY);
    expect(body.configured).toBe(true);
    delete process.env[TEST_KEY];
  });

  it("warns only for vaultSecretRef when primaryKey is set but secondary is missing", async () => {
    process.env[TEST_KEY] = "primary-ok";
    delete process.env[TEST_SECRET];
    const { body } = await createVaultRefViaApi(TEST_KEY, TEST_SECRET);
    const msgs: string[] = body.warnings;
    expect(msgs.some((w) => w.includes(TEST_KEY))).toBe(false);
    expect(msgs.some((w) => w.includes(TEST_SECRET))).toBe(true);
    delete process.env[TEST_KEY];
  });
});

// ─── Vault-ref patch (update) ─────────────────────────────────────────────────

describe("Vault-ref PATCH: warnings on update", () => {
  let refId: number;

  beforeAll(async () => {
    // Create a ref we'll patch in each test
    process.env[TEST_KEY] = "initially-set";
    const res = await request(app)
      .post("/api/integration-governance/credential-vault-refs")
      .send({
        labelEn: uniqueLabel("Patch Test Cred"),
        labelAr: "بيانات اعتماد اختبار التصحيح",
        credentialType: "smtp",
        vaultKeyRef: TEST_KEY,
        status: "active",
      });
    refId = res.body.id;
    createdVaultRefIds.push(refId);
    delete process.env[TEST_KEY];
  });

  it("patch with missing env var returns 200 + warnings, save succeeds", async () => {
    delete process.env[TEST_KEY];
    const res = await request(app)
      .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
      .send({ labelEn: uniqueLabel("Patch Test Cred Updated") });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes(TEST_KEY))).toBe(true);
    expect(res.body.configured).toBe(false);
  });

  it("patch with configured env var returns 200 + empty warnings", async () => {
    process.env[TEST_KEY] = "configured-now";
    const res = await request(app)
      .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
      .send({ labelEn: uniqueLabel("Patch Test Cred Configured") });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.configured).toBe(true);
    delete process.env[TEST_KEY];
  });
});

// ─── Vault-ref list: configured/missing status ────────────────────────────────

describe("Vault-ref list: configured status per ref", () => {
  let missingRefId: number;
  let configuredRefId: number;

  beforeAll(async () => {
    delete process.env[TEST_KEY];
    // Create one ref whose env var will be missing
    const res1 = await request(app)
      .post("/api/integration-governance/credential-vault-refs")
      .send({
        labelEn: uniqueLabel("Missing List Test"),
        labelAr: "بيانات اعتماد مفقودة في القائمة",
        credentialType: "ldap",
        vaultKeyRef: TEST_KEY,
        status: "active",
      });
    missingRefId = res1.body.id;
    createdVaultRefIds.push(missingRefId);

    // Create one ref whose env var IS set
    process.env[TEST_KEY] = "list-test-value";
    const res2 = await request(app)
      .post("/api/integration-governance/credential-vault-refs")
      .send({
        labelEn: uniqueLabel("Configured List Test"),
        labelAr: "بيانات اعتماد مكونة في القائمة",
        credentialType: "ldap",
        vaultKeyRef: TEST_KEY,
        status: "active",
      });
    configuredRefId = res2.body.id;
    createdVaultRefIds.push(configuredRefId);
    delete process.env[TEST_KEY];
  });

  it("list endpoint returns configured:false for ref whose env var is now unset", async () => {
    delete process.env[TEST_KEY];
    const res = await request(app).get("/api/integration-governance/credential-vault-refs");
    expect(res.status).toBe(200);
    const row = res.body.find((r: any) => r.id === missingRefId);
    expect(row).toBeDefined();
    expect(row.configured).toBe(false);
  });

  it("list endpoint returns configured:true for ref whose env var IS set", async () => {
    process.env[TEST_KEY] = "live-value";
    const res = await request(app).get("/api/integration-governance/credential-vault-refs");
    expect(res.status).toBe(200);
    const row = res.body.find((r: any) => r.id === configuredRefId);
    expect(row).toBeDefined();
    expect(row.configured).toBe(true);
    delete process.env[TEST_KEY];
  });

  it("single-ref GET also returns configured status", async () => {
    delete process.env[TEST_KEY];
    const res = await request(app)
      .get(`/api/integration-governance/credential-vault-refs/${missingRefId}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(typeof res.body.configured).toBe("boolean");
  });

  it("list response never exposes secret values", async () => {
    process.env[TEST_KEY] = "should-not-appear-in-response";
    const res = await request(app).get("/api/integration-governance/credential-vault-refs");
    expect(res.status).toBe(200);
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain("should-not-appear-in-response");
    delete process.env[TEST_KEY];
  });
});

// ─── Connection-profile create/update: warnings via linked vault ref ──────────

describe("Connection profile create: vault ref warnings", () => {
  let vaultRefId: number;

  beforeAll(async () => {
    // Create a vault ref that we'll attach to profiles
    delete process.env[TEST_KEY];
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: uniqueLabel("Profile Warn Test Cred"),
      labelAr: "بيانات اعتماد اختبار الملف",
      credentialType: "ldap",
      vaultKeyRef: TEST_KEY,
      status: "active",
      createdByUserId: 1,
    }).returning();
    vaultRefId = ref.id;
    createdVaultRefIds.push(vaultRefId);
  });

  it("save succeeds (201) even when linked vault key is not configured", async () => {
    delete process.env[TEST_KEY];
    const { status, body } = await createProfileViaApi(vaultRefId);
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
  });

  it("returns a warnings array when the linked vault key env var is missing", async () => {
    delete process.env[TEST_KEY];
    const { body } = await createProfileViaApi(vaultRefId);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings[0]).toContain(TEST_KEY);
  });

  it("returns empty warnings when the linked vault key IS set", async () => {
    process.env[TEST_KEY] = "profile-test-secret";
    const { status, body } = await createProfileViaApi(vaultRefId);
    expect(status).toBe(201);
    expect(body.warnings).toEqual([]);
    delete process.env[TEST_KEY];
  });

  it("returns empty warnings when profile has no vault ref (no credentialVaultRefId)", async () => {
    const { status, body } = await createProfileViaApi(null);
    expect(status).toBe(201);
    expect(body.warnings).toEqual([]);
  });

  it("response never contains the secret value", async () => {
    process.env[TEST_KEY] = "secret-never-exposed-value-zzz";
    const { body } = await createProfileViaApi(vaultRefId);
    const payload = JSON.stringify(body);
    expect(payload).not.toContain("secret-never-exposed-value-zzz");
    delete process.env[TEST_KEY];
  });
});

describe("Connection profile PATCH: vault ref warnings on update", () => {
  let vaultRefId: number;
  let profileId: number;

  beforeAll(async () => {
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: uniqueLabel("Profile Patch Warn Cred"),
      labelAr: "بيانات اعتماد اختبار التصحيح",
      credentialType: "smtp",
      vaultKeyRef: TEST_KEY,
      status: "active",
      createdByUserId: 1,
    }).returning();
    vaultRefId = ref.id;
    createdVaultRefIds.push(vaultRefId);

    const [profile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: uniqueLabel("Profile Patch Warn Test"),
      profileNameAr: "ملف اختبار التصحيح",
      integrationType: "smtp",
      environment: "staging",
      connectionParamsJson: "{}",
      credentialVaultRefId: vaultRefId,
      createdByUserId: 1,
    }).returning();
    profileId = profile.id;
    createdProfileIds.push(profileId);
  });

  it("PATCH succeeds and yields warning when vault key env var is missing", async () => {
    delete process.env[TEST_KEY];
    const res = await request(app)
      .patch(`/api/integration-governance/connection-profiles/${profileId}`)
      .send({ environment: "production" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes(TEST_KEY))).toBe(true);
  });

  it("PATCH yields empty warnings when vault key env var IS set", async () => {
    process.env[TEST_KEY] = "patch-test-value";
    const res = await request(app)
      .patch(`/api/integration-governance/connection-profiles/${profileId}`)
      .send({ environment: "staging" });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    delete process.env[TEST_KEY];
  });

  it("PATCH response never exposes the secret value", async () => {
    process.env[TEST_KEY] = "patch-secret-never-exposed-xyz";
    const res = await request(app)
      .patch(`/api/integration-governance/connection-profiles/${profileId}`)
      .send({ environment: "staging" });
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain("patch-secret-never-exposed-xyz");
    delete process.env[TEST_KEY];
  });
});
