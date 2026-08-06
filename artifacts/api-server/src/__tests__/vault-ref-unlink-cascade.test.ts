/**
 * Vault-ref delete cascade tests — verifies that:
 *  1. Deleting a vault ref nulls credentialVaultRefId on every linked profile.
 *  2. An audit row (action="unlink") is written for each affected profile.
 *  3. The delete audit row records the unlinkedProfileIds.
 *  4. The response includes unlinkedProfileCount.
 *  5. Deleting a vault ref with no linked profiles returns unlinkedProfileCount=0.
 *
 * Self-cleaning: all DB rows created here are removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  integrationCredentialVaultRefsTable,
  integrationConnectionProfilesTable,
} from "@workspace/db";
import app from "../app";

const createdVaultRefIds: number[] = [];
const createdProfileIds: number[] = [];

afterAll(async () => {
  // Clean up any vault refs/profiles left behind by failed tests.
  if (createdProfileIds.length) {
    await db
      .delete(integrationConnectionProfilesTable)
      .where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
  if (createdVaultRefIds.length) {
    await db
      .delete(integrationCredentialVaultRefsTable)
      .where(
        inArray(integrationCredentialVaultRefsTable.id, createdVaultRefIds),
      );
  }
});

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createVaultRef(): Promise<number> {
  const res = await request(app)
    .post("/api/integration-governance/credential-vault-refs")
    .send({
      labelEn: `Cascade Test Ref ${uid()}`,
      labelAr: "مرجع اختبار المتتالية",
      credentialType: "ldap",
      vaultKeyRef: `UNLINK_TEST_KEY_${uid()}`,
      status: "active",
    });
  expect(res.status).toBe(201);
  const id: number = res.body.id;
  createdVaultRefIds.push(id);
  return id;
}

async function createProfile(vaultRefId: number): Promise<number> {
  const res = await request(app)
    .post("/api/integration-governance/connection-profiles")
    .send({
      profileName: `Cascade Profile ${uid()}`,
      profileNameAr: "ملف اتصال اختبار",
      integrationType: "ldap",
      environment: "staging",
      connectionParamsJson: "{}",
      credentialVaultRefId: vaultRefId,
    });
  expect(res.status).toBe(201);
  const id: number = res.body.id;
  createdProfileIds.push(id);
  return id;
}

describe("DELETE /credential-vault-refs/:id cascade", () => {
  describe("two profiles linked to a single vault ref", () => {
    let vaultRefId: number;
    let profileId1: number;
    let profileId2: number;

    beforeAll(async () => {
      vaultRefId = await createVaultRef();
      profileId1 = await createProfile(vaultRefId);
      profileId2 = await createProfile(vaultRefId);
    });

    it("responds 200 with success=true and unlinkedProfileCount=2", async () => {
      const res = await request(app).delete(
        `/api/integration-governance/credential-vault-refs/${vaultRefId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.unlinkedProfileCount).toBe(2);
      // Remove from cleanup list since it was deleted.
      createdVaultRefIds.splice(createdVaultRefIds.indexOf(vaultRefId), 1);
    });

    it("nulls credentialVaultRefId on both profiles", async () => {
      const [p1] = await db
        .select()
        .from(integrationConnectionProfilesTable)
        .where(eq(integrationConnectionProfilesTable.id, profileId1));
      const [p2] = await db
        .select()
        .from(integrationConnectionProfilesTable)
        .where(eq(integrationConnectionProfilesTable.id, profileId2));
      expect(p1.credentialVaultRefId).toBeNull();
      expect(p2.credentialVaultRefId).toBeNull();
    });

    it("writes an unlink audit row for each affected profile", async () => {
      const rows = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "unlink"));

      const profileRows = rows.filter(
        (r) =>
          r.entityType === "connection_profile" &&
          (r.entityId === profileId1 || r.entityId === profileId2),
      );
      expect(profileRows.length).toBe(2);

      for (const row of profileRows) {
        const changes = JSON.parse(row.changesJson as string);
        expect(changes.reason).toBe("credential_vault_ref_deleted");
        expect(changes.deletedVaultRefId).toBe(vaultRefId);
        expect(changes.before.credentialVaultRefId).toBe(vaultRefId);
        expect(changes.after.credentialVaultRefId).toBeNull();
      }
    });

    it("writes a delete audit row for the vault ref including unlinkedProfileIds", async () => {
      const rows = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "delete"));

      const refRow = rows.find(
        (r) =>
          r.entityType === "credential_vault_ref" &&
          r.entityId === vaultRefId,
      );
      expect(refRow).toBeDefined();

      const changes = JSON.parse(refRow!.changesJson as string);
      expect(Array.isArray(changes.unlinkedProfileIds)).toBe(true);
      expect(changes.unlinkedProfileIds).toContain(profileId1);
      expect(changes.unlinkedProfileIds).toContain(profileId2);
    });

    it("the vault ref no longer exists in the DB", async () => {
      const [gone] = await db
        .select()
        .from(integrationCredentialVaultRefsTable)
        .where(eq(integrationCredentialVaultRefsTable.id, vaultRefId));
      expect(gone).toBeUndefined();
    });
  });

  describe("vault ref with no linked profiles", () => {
    let vaultRefId: number;

    beforeAll(async () => {
      vaultRefId = await createVaultRef();
    });

    it("responds 200 with success=true and unlinkedProfileCount=0", async () => {
      const res = await request(app).delete(
        `/api/integration-governance/credential-vault-refs/${vaultRefId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.unlinkedProfileCount).toBe(0);
      createdVaultRefIds.splice(createdVaultRefIds.indexOf(vaultRefId), 1);
    });
  });

  describe("deleting a non-existent vault ref", () => {
    it("responds 404", async () => {
      const res = await request(app).delete(
        "/api/integration-governance/credential-vault-refs/999999999",
      );
      expect(res.status).toBe(404);
    });
  });
});
