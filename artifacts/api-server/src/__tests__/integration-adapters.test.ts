/**
 * Integration adapter tests — real LDAP/SMTP/device adapters and the
 * connection-profile /test route's audit logging.
 *
 * Self-cleaning: env vars are saved/restored per suite; DB rows created here
 * are deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import http from "node:http";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  integrationCredentialVaultRefsTable,
  integrationConnectionProfilesTable,
  integrationAuditLogTable,
} from "@workspace/db";
import app from "../app";
import { testLdapConnection } from "../lib/ldap-adapter";
import { testSmtpConnection } from "../lib/smtp-adapter";
import { testDeviceConnection } from "../lib/device-adapter";

const ENV_KEYS = [
  "LDAP_HOST", "LDAP_PORT", "LDAP_BIND_DN", "LDAP_BIND_PASSWORD",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_TEST_RECIPIENT",
  "DEVICE_API_URL", "DEVICE_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function clearAdapterEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

// ─── Stub device gateway ─────────────────────────────────────────────────────
// Behavior is keyed off the request path so one server covers all cases.
let stubServer: http.Server;
let stubBaseUrl: string;
let lastAuthHeader: string | undefined;

beforeAll(async () => {
  stubServer = http.createServer((req, res) => {
    lastAuthHeader = req.headers.authorization;
    if (req.url === "/ok/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "up" }));
    } else if (req.url === "/fail/health") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "down" }));
    } else if (req.url === "/slow/health") {
      // Never respond within the test timeout; the adapter must abort.
      setTimeout(() => { try { res.writeHead(200); res.end(); } catch { /* ignore */ } }, 2000);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>(resolve => stubServer.listen(0, "127.0.0.1", resolve));
  const addr = stubServer.address() as import("node:net").AddressInfo;
  stubBaseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => stubServer.close(() => resolve()));
});

// ─── Missing env var paths ───────────────────────────────────────────────────

describe("Adapters: missing environment variables", () => {
  beforeEach(() => clearAdapterEnv());

  it("LDAP adapter reports all missing vars, simulated:false", async () => {
    const r = await testLdapConnection();
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("Missing environment variables");
    expect(r.message).toContain("LDAP_HOST");
    expect(r.message).toContain("LDAP_BIND_DN");
    expect(r.message).toContain("LDAP_BIND_PASSWORD");
    expect(typeof r.latencyMs).toBe("number");
  });

  it("LDAP adapter reports only the vars that are actually missing", async () => {
    process.env.LDAP_HOST = "ldap.example.test";
    const r = await testLdapConnection();
    expect(r.success).toBe(false);
    expect(r.message).not.toContain("LDAP_HOST");
    expect(r.message).toContain("LDAP_BIND_DN");
    expect(r.message).toContain("LDAP_BIND_PASSWORD");
  });

  it("SMTP adapter reports all missing vars, simulated:false", async () => {
    const r = await testSmtpConnection();
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("Missing environment variables");
    expect(r.message).toContain("SMTP_HOST");
    expect(r.message).toContain("SMTP_USER");
    expect(r.message).toContain("SMTP_PASS");
  });

  it("SMTP adapter reports only the vars that are actually missing", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_USER = "tester@example.test";
    const r = await testSmtpConnection();
    expect(r.success).toBe(false);
    expect(r.message).toContain("SMTP_PASS");
    expect(r.message).not.toContain("SMTP_HOST");
    expect(r.message).not.toContain("SMTP_USER");
  });

  it("Device adapter reports all missing vars, simulated:false", async () => {
    const r = await testDeviceConnection();
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("Missing environment variables");
    expect(r.message).toContain("DEVICE_API_URL");
    expect(r.message).toContain("DEVICE_API_KEY");
  });

  it("Device adapter reports only the vars that are actually missing", async () => {
    process.env.DEVICE_API_URL = "http://device.example.test";
    const r = await testDeviceConnection();
    expect(r.success).toBe(false);
    expect(r.message).not.toContain("DEVICE_API_URL");
    expect(r.message).toContain("DEVICE_API_KEY");
  });
});

// ─── Device adapter against local stub ───────────────────────────────────────

describe("Device adapter against local stub server", () => {
  beforeEach(() => clearAdapterEnv());

  it("succeeds on 200 health response and sends Bearer key", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/ok`;
    process.env.DEVICE_API_KEY = "test-device-key";
    const r = await testDeviceConnection();
    expect(r.success).toBe(true);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("200");
    expect(lastAuthHeader).toBe("Bearer test-device-key");
  });

  it("strips trailing slashes from DEVICE_API_URL", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/ok///`;
    process.env.DEVICE_API_KEY = "k";
    const r = await testDeviceConnection();
    expect(r.success).toBe(true);
  });

  it("fails with success:false on non-200 response", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/fail`;
    process.env.DEVICE_API_KEY = "k";
    const r = await testDeviceConnection();
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("503");
  });

  it("honors the timeout and aborts a slow server", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/slow`;
    process.env.DEVICE_API_KEY = "k";
    const start = Date.now();
    const r = await testDeviceConnection(300);
    const elapsed = Date.now() - start;
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("timed out after 300ms");
    expect(elapsed).toBeLessThan(1900); // aborted well before the stub's 2s reply
    expect(r.latencyMs).toBeGreaterThanOrEqual(290);
  });
});

// ─── /test route audit logging ───────────────────────────────────────────────

describe("Connection profile /test route audit logging", () => {
  const createdVaultRefIds: number[] = [];
  const createdProfileIds: number[] = [];

  beforeEach(() => clearAdapterEnv());

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

  async function createProfile(integrationType: string) {
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `Adapter Test Cred ${Date.now()}`,
      labelAr: "بيانات اعتماد اختبار المحول",
      credentialType: integrationType,
      vaultKeyRef: `vault:adapter_test_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    createdVaultRefIds.push(ref.id);

    const [profile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `Adapter Test ${integrationType} ${Date.now()}`,
      profileNameAr: "ملف اختبار المحول",
      integrationType,
      environment: "staging",
      connectionParamsJson: JSON.stringify({}),
      credentialVaultRefId: ref.id,
      createdByUserId: 1,
    }).returning();
    createdProfileIds.push(profile.id);
    return profile.id;
  }

  async function latestAuditRow(profileId: number) {
    const rows = await db.select().from(integrationAuditLogTable)
      .where(eq(integrationAuditLogTable.profileId, profileId));
    expect(rows.length).toBeGreaterThan(0);
    return rows[rows.length - 1];
  }

  it("real device adapter success writes audit row with real latency and simulated:false", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/ok`;
    process.env.DEVICE_API_KEY = "route-test-key";
    const profileId = await createProfile("attendance_device");

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.simulated).toBe(false);

    const row = await latestAuditRow(profileId);
    expect(row.eventType).toBe("test_passed");
    expect(row.outcome).toBe("success");
    const meta = JSON.parse(row.metadataJson as string);
    expect(meta.simulated).toBe(false);
    expect(typeof meta.latencyMs).toBe("number");
    expect(meta.latencyMs).toBe(res.body.latencyMs);
  });

  it("real device adapter failure (non-200) writes test_failed audit row", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/fail`;
    process.env.DEVICE_API_KEY = "route-test-key";
    const profileId = await createProfile("attendance_device");

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.simulated).toBe(false);

    const row = await latestAuditRow(profileId);
    expect(row.eventType).toBe("test_failed");
    expect(row.outcome).toBe("failure");
    const meta = JSON.parse(row.metadataJson as string);
    expect(meta.simulated).toBe(false);
    expect(meta.latencyMs).toBe(res.body.latencyMs);
  });

  it("missing env vars via route yields failure audit row naming the vars, simulated:false", async () => {
    const profileId = await createProfile("ldap");

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.simulated).toBe(false);
    expect(res.body.message).toContain("Missing environment variables");
    expect(res.body.message).toContain("LDAP_HOST");

    const row = await latestAuditRow(profileId);
    expect(row.eventType).toBe("test_failed");
    expect(row.message).toContain("Missing environment variables");
    const meta = JSON.parse(row.metadataJson as string);
    expect(meta.simulated).toBe(false);
  });

  it("integration type without a real adapter is marked simulated:true in audit metadata", async () => {
    const profileId = await createProfile("sftp");

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.simulated).toBe(true);

    const row = await latestAuditRow(profileId);
    expect(row.eventType).toBe("test_passed");
    const meta = JSON.parse(row.metadataJson as string);
    expect(meta.simulated).toBe(true);
    expect(typeof meta.latencyMs).toBe("number");
  });
});
