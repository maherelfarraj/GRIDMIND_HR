/**
 * Config-package signing — fail-closed key guard.
 *
 * When NODE_ENV=production and SESSION_SECRET is absent, sign and import
 * endpoints must refuse with a clear error instead of silently using the
 * well-known "default-secret" fallback (which would let anyone forge a
 * valid signature).
 */
import { createHmac } from "crypto";
import { describe, it, expect, afterEach, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, configPackagesTable, configPackageItemsTable } from "@workspace/db";
import app from "../app";

const createdPackageIds: number[] = [];

afterAll(async () => {
  if (createdPackageIds.length) {
    await db.delete(configPackageItemsTable).where(
      // no items created in these tests, but guard anyway
      inArray(configPackageItemsTable.packageId, createdPackageIds),
    );
    await db.delete(configPackagesTable).where(
      inArray(configPackagesTable.id, createdPackageIds),
    );
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Helper: sign with the dev fallback key ────────────────────────────────────
function signWithDefault(data: string): string {
  return createHmac("sha256", "default-secret").update(data).digest("hex");
}

// ─── Production fail-closed ────────────────────────────────────────────────────
describe("computeSignature — production fail-closed when SESSION_SECRET is missing", () => {
  it("POST /api/config-packages/:id/sign returns 500 with a clear error in production without SESSION_SECRET", async () => {
    // Create a package to sign
    const [pkg] = await db.insert(configPackagesTable).values({
      packageName: `SIGNING-TEST-${Date.now()}`,
      packageType: "policy_set",
      version: "1.0.0",
      sourceEnvironment: "test",
      targetEnvironment: "production",
      status: "draft",
      payloadJson: JSON.stringify({ test: true }),
      payloadChecksum: "0".repeat(64),
      policyAreasJson: "[]",
    }).returning();
    createdPackageIds.push(pkg.id);

    // Simulate production with no signing secret
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", undefined as unknown as string);
    delete process.env.SESSION_SECRET;

    const res = await request(app)
      .post(`/api/config-packages/${pkg.id}/sign`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/SESSION_SECRET must be set in production/i);
  });

  it("POST /api/config-packages/import returns 500 with a clear error in production without SESSION_SECRET", async () => {
    const payloadJson = JSON.stringify({ test: "import-prod-guard", ts: Date.now() });
    // Sign with the default key (as if exported from dev) — server must refuse to verify it
    const signature = signWithDefault(payloadJson);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", undefined as unknown as string);
    delete process.env.SESSION_SECRET;

    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: `SIGNING-IMPORT-TEST-${Date.now()}`,
          packageType: "policy_set",
          version: "1.0.0",
          signature,
          payloadJson,
        },
      });

    // Must refuse — not accept, not merely reject the sig
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/SESSION_SECRET must be set in production/i);
  });
});

// ─── Dev fallback still works ──────────────────────────────────────────────────
describe("computeSignature — dev fallback accepted outside production", () => {
  it("POST /api/config-packages/import succeeds in non-production without SESSION_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SESSION_SECRET", undefined as unknown as string);
    delete process.env.SESSION_SECRET;

    const payloadJson = JSON.stringify({ test: "dev-fallback", ts: Date.now() });
    const signature = signWithDefault(payloadJson);

    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: `SIGNING-DEV-TEST-${Date.now()}`,
          packageType: "policy_set",
          version: "1.0.0",
          signature,
          payloadJson,
        },
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
    createdPackageIds.push(res.body.id);
  });
});
