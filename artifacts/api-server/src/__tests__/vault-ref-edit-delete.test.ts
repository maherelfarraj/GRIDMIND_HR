/**
 * Vault-ref PATCH and DELETE regression tests — verifies that:
 *  1. PATCH returns 200 + updated row when the id exists.
 *  2. PATCH includes warnings[] when the vaultKeyRef env var is not set.
 *  3. PATCH returns 404 when the id does not exist.
 *  4. DELETE returns 200 + { success: true } when the id exists.
 *  5. DELETE returns 404 when the id does not exist.
 *
 * Self-cleaning: all DB rows created here are deleted in afterAll.
 * Env vars set during tests are restored so other suites aren't affected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  integrationCredentialVaultRefsTable,
} from "@workspace/db";
import app from "../app";

// ─── Env save/restore ─────────────────────────────────────────────────────────

const TEST_KEY = "VAULT_EDIT_DEL_TEST_KEY_XYZZY_UNIQUE";
let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env[TEST_KEY];
  delete process.env[TEST_KEY];
});

afterAll(() => {
  if (savedKey === undefined) delete process.env[TEST_KEY];
  else process.env[TEST_KEY] = savedKey;
});

// ─── DB cleanup ───────────────────────────────────────────────────────────────

const createdVaultRefIds: number[] = [];

afterAll(async () => {
  if (createdVaultRefIds.length) {
    await db
      .delete(integrationCredentialVaultRefsTable)
      .where(inArray(integrationCredentialVaultRefsTable.id, createdVaultRefIds));
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createVaultRef(vaultKeyRef: string): Promise<number> {
  const res = await request(app)
    .post("/api/integration-governance/credential-vault-refs")
    .send({
      labelEn: `Edit/Del Test Ref ${uid()}`,
      labelAr: "مرجع اختبار التعديل والحذف",
      credentialType: "ldap",
      vaultKeyRef,
      status: "active",
    });
  expect(res.status).toBe(201);
  const id: number = res.body.id;
  createdVaultRefIds.push(id);
  return id;
}

// ─── PATCH /credential-vault-refs/:id ────────────────────────────────────────

describe("PATCH /integration-governance/credential-vault-refs/:id", () => {
  describe("existing id", () => {
    let refId: number;

    beforeAll(async () => {
      delete process.env[TEST_KEY];
      refId = await createVaultRef(TEST_KEY);
    });

    it("returns 200 with the updated row", async () => {
      const newLabel = `Updated Label ${uid()}`;
      const res = await request(app)
        .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
        .send({ labelEn: newLabel });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(refId);
      expect(res.body.labelEn).toBe(newLabel);
    });

    it("includes warnings[] when the vaultKeyRef env var is not set", async () => {
      delete process.env[TEST_KEY];
      const res = await request(app)
        .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
        .send({ labelEn: `Warn Check ${uid()}` });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.warnings)).toBe(true);
      expect(res.body.warnings.length).toBeGreaterThan(0);
      expect(res.body.warnings.some((w: string) => w.includes(TEST_KEY))).toBe(true);
    });

    it("returns empty warnings[] when the vaultKeyRef env var IS set", async () => {
      process.env[TEST_KEY] = "configured-value";
      const res = await request(app)
        .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
        .send({ labelEn: `No Warn Check ${uid()}` });
      expect(res.status).toBe(200);
      expect(res.body.warnings).toEqual([]);
      delete process.env[TEST_KEY];
    });

    it("returns configured: false when vaultKeyRef env var is absent", async () => {
      delete process.env[TEST_KEY];
      const res = await request(app)
        .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
        .send({ labelEn: `Configured False ${uid()}` });
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
    });

    it("returns configured: true when vaultKeyRef env var is present", async () => {
      process.env[TEST_KEY] = "live-value";
      const res = await request(app)
        .patch(`/api/integration-governance/credential-vault-refs/${refId}`)
        .send({ labelEn: `Configured True ${uid()}` });
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      delete process.env[TEST_KEY];
    });
  });

  describe("non-existent id", () => {
    it("returns 404", async () => {
      const res = await request(app)
        .patch("/api/integration-governance/credential-vault-refs/999999999")
        .send({ labelEn: "Should not exist" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });
});

// ─── DELETE /credential-vault-refs/:id ───────────────────────────────────────

describe("DELETE /integration-governance/credential-vault-refs/:id", () => {
  describe("existing id", () => {
    let refId: number;

    beforeAll(async () => {
      refId = await createVaultRef(`VAULT_EDIT_DEL_DEL_KEY_${uid()}`);
    });

    it("returns 200 with success: true", async () => {
      const res = await request(app).delete(
        `/api/integration-governance/credential-vault-refs/${refId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Remove from cleanup list — already deleted by the endpoint.
      createdVaultRefIds.splice(createdVaultRefIds.indexOf(refId), 1);
    });
  });

  describe("non-existent id", () => {
    it("returns 404", async () => {
      const res = await request(app).delete(
        "/api/integration-governance/credential-vault-refs/999999999",
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });
});
