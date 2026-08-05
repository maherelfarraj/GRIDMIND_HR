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
import { resolveProfileConnection } from "../lib/profile-connection";

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
    expect(r.message).toContain("Missing connection settings");
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
    expect(r.message).toContain("Missing connection settings");
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
    expect(r.message).toContain("Missing connection settings");
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
    const r = await testDeviceConnection({ timeoutMs: 300 });
    const elapsed = Date.now() - start;
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("timed out after 300ms");
    expect(elapsed).toBeLessThan(1900); // aborted well before the stub's 2s reply
    expect(r.latencyMs).toBeGreaterThanOrEqual(290);
  });
});

// ─── LDAP/SMTP live-connection failure paths ─────────────────────────────────
// Local stubs simulate outage conditions: a port with nothing listening
// (unreachable host) and a TCP server that accepts but never speaks
// (hung server — the adapter must honor its timeout and not hang).

import net from "node:net";

/** Returns a 127.0.0.1 port that is guaranteed to have no listener. */
async function closedPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>(resolve => srv.listen(0, "127.0.0.1", resolve));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  await new Promise<void>(resolve => srv.close(() => resolve()));
  return port;
}

let hungServer: net.Server;
let hungPort: number;

beforeAll(async () => {
  // Accepts connections but never sends any bytes back.
  hungServer = net.createServer(() => { /* keep socket open, say nothing */ });
  await new Promise<void>(resolve => hungServer.listen(0, "127.0.0.1", resolve));
  hungPort = (hungServer.address() as import("node:net").AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => {
    hungServer.close(() => resolve());
    // Destroy any lingering sockets so close() completes.
    hungServer.getConnections?.(() => { /* noop */ });
    hungServer.unref();
    resolve();
  });
});

describe("LDAP adapter live-connection failures", () => {
  beforeEach(() => clearAdapterEnv());

  function setLdapEnv(port: number) {
    process.env.LDAP_HOST = "127.0.0.1";
    process.env.LDAP_PORT = String(port);
    process.env.LDAP_BIND_DN = "cn=admin,dc=example,dc=test";
    process.env.LDAP_BIND_PASSWORD = "wrong-password";
  }

  it("fails fast with success:false when nothing is listening (unreachable host)", async () => {
    setLdapEnv(await closedPort());
    const start = Date.now();
    const r = await testLdapConnection({ timeoutMs: 2000 });
    const elapsed = Date.now() - start;
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("LDAP bind failed");
    expect(elapsed).toBeLessThan(1500); // connection refused, not a hang
    expect(typeof r.latencyMs).toBe("number");
  });

  it("honors its timeout against a hung server instead of hanging", async () => {
    setLdapEnv(hungPort);
    const start = Date.now();
    const r = await testLdapConnection({ timeoutMs: 400 });
    const elapsed = Date.now() - start;
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("LDAP bind failed");
    expect(elapsed).toBeGreaterThanOrEqual(300); // actually waited for the timeout window
    expect(elapsed).toBeLessThan(3000); // but aborted promptly, no indefinite hang
  });
});

describe("SMTP adapter live-connection failures", () => {
  beforeEach(() => clearAdapterEnv());

  function setSmtpEnv(port: number) {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "tester@example.test";
    process.env.SMTP_PASS = "wrong-password";
  }

  it("fails fast with success:false when nothing is listening (unreachable host)", async () => {
    setSmtpEnv(await closedPort());
    const start = Date.now();
    const r = await testSmtpConnection(undefined, { timeoutMs: 2000 });
    const elapsed = Date.now() - start;
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("SMTP test failed");
    expect(elapsed).toBeLessThan(1500);
  });

  it("honors its greeting timeout against a hung server instead of hanging", async () => {
    setSmtpEnv(hungPort);
    const start = Date.now();
    const r = await testSmtpConnection(undefined, { timeoutMs: 400 });
    const elapsed = Date.now() - start;
    expect(r.success).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.message).toContain("SMTP test failed");
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(3000);
  });

  it("reports rejected credentials with success:false, simulated:false", async () => {
    // Minimal SMTP stub: greets, advertises AUTH, rejects the login.
    const smtpStub = net.createServer(socket => {
      socket.write("220 stub.example.test ESMTP ready\r\n");
      socket.on("data", (buf) => {
        const line = buf.toString();
        if (/^(EHLO|HELO)/i.test(line)) {
          socket.write("250-stub.example.test\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (/^AUTH/i.test(line) || /^[A-Za-z0-9+/=]+\r\n$/.test(line)) {
          socket.write("535 5.7.8 Authentication credentials invalid\r\n");
        } else if (/^QUIT/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("500 unrecognized\r\n");
        }
      });
    });
    await new Promise<void>(resolve => smtpStub.listen(0, "127.0.0.1", resolve));
    const port = (smtpStub.address() as import("node:net").AddressInfo).port;
    try {
      setSmtpEnv(port);
      const r = await testSmtpConnection(undefined, { timeoutMs: 3000 });
      expect(r.success).toBe(false);
      expect(r.simulated).toBe(false);
      expect(r.message).toContain("SMTP test failed");
      expect(r.message).toMatch(/535|credentials|auth/i);
    } finally {
      await new Promise<void>(resolve => smtpStub.close(() => resolve()));
    }
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
    expect(res.body.message).toContain("Missing connection settings");
    expect(res.body.message).toContain("LDAP_HOST");

    const row = await latestAuditRow(profileId);
    expect(row.eventType).toBe("test_failed");
    expect(row.message).toContain("Missing connection settings");
    const meta = JSON.parse(row.metadataJson as string);
    expect(meta.simulated).toBe(false);
  });

  it("profile connectionParamsJson host is used (not LDAP_HOST global) when present", async () => {
    // Set a global that would succeed if it were used — but the profile's
    // params don't have an accessible LDAP server, so we expect a connection
    // failure that mentions the profile host, not the global.
    process.env.LDAP_HOST = "global.ldap.host";
    process.env.LDAP_BIND_DN = "cn=global,dc=example,dc=test";
    process.env.LDAP_BIND_PASSWORD = "global-pass";

    const port = await closedPort();
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `Precedence Test Cred ${Date.now()}`,
      labelAr: "بيانات اعتماد اختبار الأسبقية",
      credentialType: "ldap",
      vaultKeyRef: `vault:precedence_test_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    createdVaultRefIds.push(ref.id);

    const [precedenceProfile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `Precedence Test LDAP ${Date.now()}`,
      profileNameAr: "ملف أسبقية",
      integrationType: "ldap",
      environment: "staging",
      connectionParamsJson: JSON.stringify({ host: "127.0.0.1", port, bindDn: "cn=profile,dc=test" }),
      credentialVaultRefId: ref.id,
      createdByUserId: 1,
    }).returning();
    createdProfileIds.push(precedenceProfile.id);

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${precedenceProfile.id}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    // Should mention the profile host (127.0.0.1), NOT the global (global.ldap.host)
    expect(res.body.message).toContain("127.0.0.1");
    expect(res.body.message).not.toContain("global.ldap.host");
  });

  it("global LDAP_HOST is used as fallback when profile connectionParamsJson has no host", async () => {
    process.env.LDAP_HOST = "fallback.ldap.host";
    process.env.LDAP_BIND_DN = "cn=fallback,dc=example,dc=test";
    process.env.LDAP_BIND_PASSWORD = "fallback-pass";

    const profileId = await createProfile("ldap"); // connectionParamsJson = {}

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profileId}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    // Global host should appear in the failure message
    expect(res.body.message).toContain("fallback.ldap.host");
  });

  it("device adapter: profile connectionParamsJson baseUrl preferred over DEVICE_API_URL global", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/ok`; // global → would succeed
    process.env.DEVICE_API_KEY = "global-key";

    const [ref2] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `Precedence Device Cred ${Date.now()}`,
      labelAr: "بيانات اعتماد جهاز",
      credentialType: "attendance_device",
      vaultKeyRef: `vault:device_precedence_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    createdVaultRefIds.push(ref2.id);

    const [devProfile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `Precedence Device ${Date.now()}`,
      profileNameAr: "ملف جهاز",
      integrationType: "attendance_device",
      environment: "staging",
      // Profile overrides to /fail — adapter must use profile URL, not global /ok
      connectionParamsJson: JSON.stringify({ baseUrl: `${stubBaseUrl}/fail` }),
      credentialVaultRefId: ref2.id,
      createdByUserId: 1,
    }).returning();
    createdProfileIds.push(devProfile.id);

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${devProfile.id}/test`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);   // used profile /fail → 503, not global /ok
    expect(res.body.simulated).toBe(false);
    expect(res.body.message).toContain("503");
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

// ─── Per-profile host resolution: two-profile differentiation ────────────────
//
// These tests are the primary regression guard for per-profile host resolution.
// They create TWO profiles of the same integration type with DIFFERENT hosts
// AND different environments (one staging, one production) and verify that each
// /test result message references only that profile's own host — not the global
// env var host, and not the other profile's host. Spanning environments catches
// any regression where production profiles are silently routed differently from
// staging ones. A regression that routes every profile to the global env var
// would make both messages identical and both assertions would fire.
//
// We also cover the env-var fallback path: a profile with no host in
// connectionParamsJson must fall through to the global env var.

describe("Per-profile host resolution: two-profile differentiation (LDAP)", () => {
  const localVaultRefIds: number[] = [];
  const localProfileIds: number[] = [];

  afterAll(async () => {
    if (localProfileIds.length) {
      await db.delete(integrationAuditLogTable)
        .where(inArray(integrationAuditLogTable.profileId, localProfileIds));
      await db.delete(integrationConnectionProfilesTable)
        .where(inArray(integrationConnectionProfilesTable.id, localProfileIds));
    }
    if (localVaultRefIds.length) {
      await db.delete(integrationCredentialVaultRefsTable)
        .where(inArray(integrationCredentialVaultRefsTable.id, localVaultRefIds));
    }
  });

  async function createLdapProfile(host: string, label: string, environment: "staging" | "production") {
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `${label} cred ${Date.now()}`,
      labelAr: "بيانات اعتماد",
      credentialType: "ldap",
      vaultKeyRef: `vault:two_profile_ldap_${label}_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    localVaultRefIds.push(ref.id);

    const [profile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `${label} LDAP ${Date.now()}`,
      profileNameAr: "ملف LDAP",
      integrationType: "ldap",
      environment,
      // host set per-profile; bindDn also in params so vault secret isn't needed
      connectionParamsJson: JSON.stringify({ host, port: 389, bindDn: `cn=${label},dc=test` }),
      credentialVaultRefId: ref.id,
      createdByUserId: 1,
    }).returning();
    localProfileIds.push(profile.id);
    return profile.id;
  }

  it("staging and production profiles each hit their own host, not the other's or the global", async () => {
    // Global host is a distinct third value — must NOT appear in either result.
    process.env.LDAP_HOST = "global.ldap.should-not-appear.test";
    process.env.LDAP_BIND_DN = "cn=global,dc=test";
    process.env.LDAP_BIND_PASSWORD = "global-pass";

    // Alpha is staging, Beta is production — different environments, different hosts.
    const profileAlphaId = await createLdapProfile("profile-alpha.ldap.test", "alpha", "staging");
    const profileBetaId  = await createLdapProfile("profile-beta.ldap.test",  "beta",  "production");

    const [resAlpha, resBeta] = await Promise.all([
      request(app).post(`/api/integration-governance/connection-profiles/${profileAlphaId}/test`),
      request(app).post(`/api/integration-governance/connection-profiles/${profileBetaId}/test`),
    ]);

    expect(resAlpha.status).toBe(200);
    expect(resBeta.status).toBe(200);

    // Both will fail (unresolvable hostnames), but each failure message must cite
    // that profile's own host.
    expect(resAlpha.body.message).toContain("profile-alpha.ldap.test");
    expect(resAlpha.body.message).not.toContain("profile-beta.ldap.test");
    expect(resAlpha.body.message).not.toContain("global.ldap.should-not-appear.test");

    expect(resBeta.body.message).toContain("profile-beta.ldap.test");
    expect(resBeta.body.message).not.toContain("profile-alpha.ldap.test");
    expect(resBeta.body.message).not.toContain("global.ldap.should-not-appear.test");

    // simulated must be false for a real adapter type
    expect(resAlpha.body.simulated).toBe(false);
    expect(resBeta.body.simulated).toBe(false);
  });

  it("LDAP profile without host in connectionParamsJson falls back to global LDAP_HOST", async () => {
    process.env.LDAP_HOST = "global-fallback.ldap.test";
    process.env.LDAP_BIND_DN = "cn=fallback,dc=test";
    process.env.LDAP_BIND_PASSWORD = "fallback-pass";

    // Profile has no host — connectionParamsJson only has bindDn so we don't
    // hit the "missing settings" branch, and the adapter must use LDAP_HOST.
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `Fallback LDAP cred ${Date.now()}`,
      labelAr: "بيانات اعتماد",
      credentialType: "ldap",
      vaultKeyRef: `vault:ldap_fallback_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    localVaultRefIds.push(ref.id);

    const [profile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `Fallback LDAP ${Date.now()}`,
      profileNameAr: "ملف احتياطي",
      integrationType: "ldap",
      environment: "staging",
      // No host — adapter must fall back to LDAP_HOST env var
      connectionParamsJson: JSON.stringify({ bindDn: "cn=profile-nohost,dc=test" }),
      credentialVaultRefId: ref.id,
      createdByUserId: 1,
    }).returning();
    localProfileIds.push(profile.id);

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profile.id}/test`);
    expect(res.status).toBe(200);
    // Failure is expected (host is unresolvable) but message must cite the GLOBAL host
    expect(res.body.message).toContain("global-fallback.ldap.test");
    expect(res.body.simulated).toBe(false);
  });
});

describe("Per-profile host resolution: two-profile differentiation (device adapter)", () => {
  const localVaultRefIds: number[] = [];
  const localProfileIds: number[] = [];

  afterAll(async () => {
    if (localProfileIds.length) {
      await db.delete(integrationAuditLogTable)
        .where(inArray(integrationAuditLogTable.profileId, localProfileIds));
      await db.delete(integrationConnectionProfilesTable)
        .where(inArray(integrationConnectionProfilesTable.id, localProfileIds));
    }
    if (localVaultRefIds.length) {
      await db.delete(integrationCredentialVaultRefsTable)
        .where(inArray(integrationCredentialVaultRefsTable.id, localVaultRefIds));
    }
  });

  async function createDeviceProfile(baseUrl: string, label: string, environment: "staging" | "production") {
    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `${label} device cred ${Date.now()}`,
      labelAr: "بيانات اعتماد",
      credentialType: "attendance_device",
      vaultKeyRef: `vault:two_profile_device_${label}_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    localVaultRefIds.push(ref.id);

    const [profile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `${label} device ${Date.now()}`,
      profileNameAr: "ملف جهاز",
      integrationType: "attendance_device",
      environment,
      connectionParamsJson: JSON.stringify({ baseUrl }),
      credentialVaultRefId: ref.id,
      createdByUserId: 1,
    }).returning();
    localProfileIds.push(profile.id);
    return profile.id;
  }

  it("staging and production device profiles route to their own servers independently", async () => {
    // Global would succeed (/ok) — production profile B must NOT fall back to it.
    process.env.DEVICE_API_URL = `${stubBaseUrl}/ok`;
    process.env.DEVICE_API_KEY = "global-device-key";

    // Profile A (staging)    → /ok (healthy stub) → expect success
    // Profile B (production) → /fail (503 stub)   → expect failure with 503 in message
    const profileAId = await createDeviceProfile(`${stubBaseUrl}/ok`,  "dev-ok",   "staging");
    const profileBId = await createDeviceProfile(`${stubBaseUrl}/fail`, "dev-fail", "production");

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/integration-governance/connection-profiles/${profileAId}/test`),
      request(app).post(`/api/integration-governance/connection-profiles/${profileBId}/test`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Profile A hit the /ok path — must succeed
    expect(resA.body.success).toBe(true);
    expect(resA.body.simulated).toBe(false);
    expect(resA.body.message).toContain("/ok/health");
    expect(resA.body.message).not.toContain("/fail");

    // Profile B hit the /fail path — must report 503, not a success
    expect(resB.body.success).toBe(false);
    expect(resB.body.simulated).toBe(false);
    expect(resB.body.message).toContain("503");
    expect(resB.body.message).toContain("/fail/health");
    expect(resB.body.message).not.toContain("/ok/health");
  });

  it("device profile without baseUrl in connectionParamsJson falls back to global DEVICE_API_URL", async () => {
    process.env.DEVICE_API_URL = `${stubBaseUrl}/ok`;
    process.env.DEVICE_API_KEY = "global-device-key";

    const [ref] = await db.insert(integrationCredentialVaultRefsTable).values({
      labelEn: `Fallback device cred ${Date.now()}`,
      labelAr: "بيانات اعتماد",
      credentialType: "attendance_device",
      vaultKeyRef: `vault:device_fallback_${Date.now()}`,
      status: "active",
      createdByUserId: 1,
    }).returning();
    localVaultRefIds.push(ref.id);

    const [profile] = await db.insert(integrationConnectionProfilesTable).values({
      profileName: `Fallback device ${Date.now()}`,
      profileNameAr: "ملف جهاز احتياطي",
      integrationType: "attendance_device",
      environment: "staging",
      // No baseUrl — must fall back to DEVICE_API_URL env var
      connectionParamsJson: JSON.stringify({}),
      credentialVaultRefId: ref.id,
      createdByUserId: 1,
    }).returning();
    localProfileIds.push(profile.id);

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profile.id}/test`);
    expect(res.status).toBe(200);
    // Global /ok → should succeed and mention the /ok/health path
    expect(res.body.success).toBe(true);
    expect(res.body.simulated).toBe(false);
    expect(res.body.message).toContain("/ok/health");
  });
});
