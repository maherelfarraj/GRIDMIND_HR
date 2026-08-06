/**
 * profile-resolved-target.test.ts
 *
 * Covers all three resolved-target states for connection profiles:
 *   1. profile-specific host  — profile.connectionParamsJson has a host/baseUrl
 *   2. global default         — profile has no host; env-var fallback is used
 *                               → usingGlobalDefault: true
 *   3. no host configured     — neither profile nor env var provides a host
 *                               → host/baseUrl are null, usingGlobalDefault: false
 *
 * Two test layers:
 *   A. Direct unit tests of resolveProfileTarget (no DB, no HTTP)
 *   B. API-level tests: GET /connection-profiles and GET /connection-profiles/:id
 *      include resolvedTarget and report the correct state.
 *
 * Self-cleaning: all DB rows created here are deleted in afterAll.
 * Env vars (LDAP_HOST, LDAP_PORT, SMTP_HOST, SMTP_PORT, DEVICE_API_URL)
 * are saved and restored so other suites are not affected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  integrationConnectionProfilesTable,
  integrationAuditLogTable,
} from "@workspace/db";
import app from "../app";
import { resolveProfileTarget } from "../lib/profile-connection.js";

// ─── Env save / restore ───────────────────────────────────────────────────────

const ENV_KEYS = ["LDAP_HOST", "LDAP_PORT", "SMTP_HOST", "SMTP_PORT", "DEVICE_API_URL"] as const;
const savedEnv: Partial<Record<typeof ENV_KEYS[number], string>> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ─── DB cleanup ───────────────────────────────────────────────────────────────

const createdProfileIds: number[] = [];

afterAll(async () => {
  if (createdProfileIds.length) {
    await db.delete(integrationAuditLogTable)
      .where(inArray(integrationAuditLogTable.profileId, createdProfileIds));
    await db.delete(integrationConnectionProfilesTable)
      .where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a profile via the API POST so the server assigns the correct orgId
 * (from resolveOrgId).  Section B tests then query the list endpoint without
 * an explicit X-Org-Id header and find the same default-org profiles.
 */
async function seedProfileViaApi(
  integrationType: string,
  connectionParamsJson: string,
): Promise<number> {
  const res = await request(app)
    .post("/api/integration-governance/connection-profiles")
    .send({
      profileName: uid("rt-test"),
      profileNameAr: "اختبار الهدف",
      integrationType,
      environment: "staging",
      connectionParamsJson,
    });
  if (!res.body?.id) {
    throw new Error(`Failed to seed profile via API: ${JSON.stringify(res.body)}`);
  }
  createdProfileIds.push(res.body.id);
  return res.body.id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. UNIT TESTS — resolveProfileTarget (pure function, no DB)
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveProfileTarget — LDAP: profile-specific host", () => {
  it("returns the profile host and port, usingGlobalDefault false", () => {
    delete process.env.LDAP_HOST;
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: JSON.stringify({ host: "ldap.example.com", port: 636 }),
    });
    expect(result.host).toBe("ldap.example.com");
    expect(result.port).toBe("636");
    expect(result.baseUrl).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("defaults port to 389 when only host is given", () => {
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: JSON.stringify({ host: "ldap.corp.local" }),
    });
    expect(result.host).toBe("ldap.corp.local");
    expect(result.port).toBe("389");
    expect(result.usingGlobalDefault).toBe(false);
  });
});

describe("resolveProfileTarget — LDAP: global default (env-var fallback)", () => {
  it("falls back to LDAP_HOST and sets usingGlobalDefault true when profile has no host", () => {
    process.env.LDAP_HOST = "global-ldap.example.com";
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.host).toBe("global-ldap.example.com");
    expect(result.usingGlobalDefault).toBe(true);
    delete process.env.LDAP_HOST;
  });

  it("uses LDAP_PORT from env when profile port is absent", () => {
    process.env.LDAP_HOST = "global-ldap.example.com";
    process.env.LDAP_PORT = "1389";
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.port).toBe("1389");
    expect(result.usingGlobalDefault).toBe(true);
    delete process.env.LDAP_HOST;
    delete process.env.LDAP_PORT;
  });

  it("profile host takes precedence over LDAP_HOST even when env var is set", () => {
    process.env.LDAP_HOST = "global-ldap.example.com";
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: JSON.stringify({ host: "profile-specific.example.com" }),
    });
    expect(result.host).toBe("profile-specific.example.com");
    expect(result.usingGlobalDefault).toBe(false);
    delete process.env.LDAP_HOST;
  });
});

describe("resolveProfileTarget — LDAP: no host configured", () => {
  it("returns null host and usingGlobalDefault false when neither profile nor env has a host", () => {
    delete process.env.LDAP_HOST;
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.host).toBeNull();
    expect(result.port).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("returns null host for empty connectionParamsJson string", () => {
    delete process.env.LDAP_HOST;
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: "",
    });
    expect(result.host).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("returns null host for malformed JSON", () => {
    delete process.env.LDAP_HOST;
    const result = resolveProfileTarget({
      integrationType: "ldap",
      connectionParamsJson: "not-json{",
    });
    expect(result.host).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });
});

describe("resolveProfileTarget — active_directory: same rules as LDAP", () => {
  it("profile host → usingGlobalDefault false", () => {
    const result = resolveProfileTarget({
      integrationType: "active_directory",
      connectionParamsJson: JSON.stringify({ host: "ad.corp.local", port: 389 }),
    });
    expect(result.host).toBe("ad.corp.local");
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("no profile host + LDAP_HOST set → usingGlobalDefault true", () => {
    process.env.LDAP_HOST = "global-ad.corp.local";
    const result = resolveProfileTarget({
      integrationType: "active_directory",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.usingGlobalDefault).toBe(true);
    delete process.env.LDAP_HOST;
  });

  it("no profile host + no LDAP_HOST → host null, usingGlobalDefault false", () => {
    delete process.env.LDAP_HOST;
    const result = resolveProfileTarget({
      integrationType: "active_directory",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.host).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });
});

describe("resolveProfileTarget — SMTP: all three states", () => {
  it("profile host → returns profile host, usingGlobalDefault false", () => {
    delete process.env.SMTP_HOST;
    const result = resolveProfileTarget({
      integrationType: "smtp",
      connectionParamsJson: JSON.stringify({ host: "smtp.mailer.io", port: 465 }),
    });
    expect(result.host).toBe("smtp.mailer.io");
    expect(result.port).toBe("465");
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("no profile host + SMTP_HOST set → global default, usingGlobalDefault true", () => {
    process.env.SMTP_HOST = "global-smtp.mailer.io";
    const result = resolveProfileTarget({
      integrationType: "smtp",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.host).toBe("global-smtp.mailer.io");
    expect(result.usingGlobalDefault).toBe(true);
    delete process.env.SMTP_HOST;
  });

  it("no profile host + no SMTP_HOST → host null, usingGlobalDefault false", () => {
    delete process.env.SMTP_HOST;
    const result = resolveProfileTarget({
      integrationType: "smtp",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.host).toBeNull();
    expect(result.port).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("SMTP port defaults to 587 when not supplied in profile", () => {
    process.env.SMTP_HOST = "smtp.fallback.io";
    const result = resolveProfileTarget({
      integrationType: "smtp",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.port).toBe("587");
    delete process.env.SMTP_HOST;
  });
});

describe("resolveProfileTarget — attendance_device: all three states", () => {
  it("profile baseUrl → returns it directly, usingGlobalDefault false", () => {
    delete process.env.DEVICE_API_URL;
    const result = resolveProfileTarget({
      integrationType: "attendance_device",
      connectionParamsJson: JSON.stringify({ baseUrl: "http://device1.lan:8080" }),
    });
    expect(result.baseUrl).toBe("http://device1.lan:8080");
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("profile host without baseUrl → synthesises baseUrl, usingGlobalDefault false", () => {
    delete process.env.DEVICE_API_URL;
    const result = resolveProfileTarget({
      integrationType: "attendance_device",
      connectionParamsJson: JSON.stringify({ host: "device2.lan", port: 9090 }),
    });
    expect(result.baseUrl).toBe("http://device2.lan:9090");
    expect(result.usingGlobalDefault).toBe(false);
  });

  it("no profile host/baseUrl + DEVICE_API_URL set → global default, usingGlobalDefault true", () => {
    process.env.DEVICE_API_URL = "http://global-device.lan:8080";
    const result = resolveProfileTarget({
      integrationType: "attendance_device",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.baseUrl).toBe("http://global-device.lan:8080");
    expect(result.usingGlobalDefault).toBe(true);
    delete process.env.DEVICE_API_URL;
  });

  it("no profile host/baseUrl + no DEVICE_API_URL → baseUrl null, usingGlobalDefault false", () => {
    delete process.env.DEVICE_API_URL;
    const result = resolveProfileTarget({
      integrationType: "attendance_device",
      connectionParamsJson: JSON.stringify({}),
    });
    expect(result.baseUrl).toBeNull();
    expect(result.usingGlobalDefault).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. API-LEVEL TESTS — resolvedTarget field in list and get endpoints
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /connection-profiles — resolvedTarget in list response", () => {
  let profileWithHostId: number;
  let profileGlobalDefaultId: number;
  let profileNoHostId: number;

  beforeAll(async () => {
    // Profile with its own LDAP host
    profileWithHostId = await seedProfileViaApi(
      "ldap",
      JSON.stringify({ host: "ldap.specific.example.com", port: 636 }),
    );
    // Profile with no host — will use global default when env var is set
    profileGlobalDefaultId = await seedProfileViaApi(
      "ldap",
      JSON.stringify({}),
    );
    // SMTP profile with no host and no env var → "no host" state
    profileNoHostId = await seedProfileViaApi(
      "smtp",
      JSON.stringify({}),
    );
  });

  it("profile with own host → resolvedTarget.host is the profile's host, usingGlobalDefault false", async () => {
    delete process.env.LDAP_HOST;
    const res = await request(app).get("/api/integration-governance/connection-profiles");
    expect(res.status).toBe(200);
    const row = res.body.find((p: any) => p.id === profileWithHostId);
    expect(row).toBeDefined();
    expect(row.resolvedTarget).toBeDefined();
    expect(row.resolvedTarget.host).toBe("ldap.specific.example.com");
    expect(row.resolvedTarget.port).toBe("636");
    expect(row.resolvedTarget.usingGlobalDefault).toBe(false);
  });

  it("profile with no host but LDAP_HOST set → resolvedTarget.usingGlobalDefault true", async () => {
    process.env.LDAP_HOST = "global-ldap.example.com";
    const res = await request(app).get("/api/integration-governance/connection-profiles");
    expect(res.status).toBe(200);
    const row = res.body.find((p: any) => p.id === profileGlobalDefaultId);
    expect(row).toBeDefined();
    expect(row.resolvedTarget.host).toBe("global-ldap.example.com");
    expect(row.resolvedTarget.usingGlobalDefault).toBe(true);
    delete process.env.LDAP_HOST;
  });

  it("profile with no host and no LDAP_HOST → resolvedTarget.host null, usingGlobalDefault false", async () => {
    delete process.env.LDAP_HOST;
    const res = await request(app).get("/api/integration-governance/connection-profiles");
    expect(res.status).toBe(200);
    const row = res.body.find((p: any) => p.id === profileGlobalDefaultId);
    expect(row).toBeDefined();
    expect(row.resolvedTarget.host).toBeNull();
    expect(row.resolvedTarget.usingGlobalDefault).toBe(false);
  });

  it("SMTP profile with no host and no SMTP_HOST → resolvedTarget.host null (no-host state)", async () => {
    delete process.env.SMTP_HOST;
    const res = await request(app).get("/api/integration-governance/connection-profiles");
    expect(res.status).toBe(200);
    const row = res.body.find((p: any) => p.id === profileNoHostId);
    expect(row).toBeDefined();
    expect(row.resolvedTarget.host).toBeNull();
    expect(row.resolvedTarget.usingGlobalDefault).toBe(false);
  });
});

describe("GET /connection-profiles/:id — resolvedTarget in single-profile response", () => {
  let profileWithHostId: number;
  let profileGlobalDefaultId: number;
  let profileNoHostId: number;

  beforeAll(async () => {
    profileWithHostId = await seedProfileViaApi(
      "smtp",
      JSON.stringify({ host: "smtp.specific.example.com", port: 465 }),
    );
    profileGlobalDefaultId = await seedProfileViaApi(
      "smtp",
      JSON.stringify({}),
    );
    profileNoHostId = await seedProfileViaApi(
      "attendance_device",
      JSON.stringify({}),
    );
  });

  it("profile with own host → resolvedTarget.host is the profile host, usingGlobalDefault false", async () => {
    delete process.env.SMTP_HOST;
    const res = await request(app).get(
      `/api/integration-governance/connection-profiles/${profileWithHostId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.resolvedTarget).toBeDefined();
    expect(res.body.resolvedTarget.host).toBe("smtp.specific.example.com");
    expect(res.body.resolvedTarget.usingGlobalDefault).toBe(false);
  });

  it("SMTP profile with no host but SMTP_HOST set → usingGlobalDefault true", async () => {
    process.env.SMTP_HOST = "global-smtp.example.com";
    const res = await request(app).get(
      `/api/integration-governance/connection-profiles/${profileGlobalDefaultId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.resolvedTarget.host).toBe("global-smtp.example.com");
    expect(res.body.resolvedTarget.usingGlobalDefault).toBe(true);
    delete process.env.SMTP_HOST;
  });

  it("attendance_device profile with no params and no DEVICE_API_URL → baseUrl null (no-host state)", async () => {
    delete process.env.DEVICE_API_URL;
    const res = await request(app).get(
      `/api/integration-governance/connection-profiles/${profileNoHostId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.resolvedTarget.baseUrl).toBeNull();
    expect(res.body.resolvedTarget.usingGlobalDefault).toBe(false);
  });

  it("attendance_device profile with no params but DEVICE_API_URL set → global default (usingGlobalDefault true)", async () => {
    process.env.DEVICE_API_URL = "http://global-device.lan:8080";
    const res = await request(app).get(
      `/api/integration-governance/connection-profiles/${profileNoHostId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.resolvedTarget.baseUrl).toBe("http://global-device.lan:8080");
    expect(res.body.resolvedTarget.usingGlobalDefault).toBe(true);
    delete process.env.DEVICE_API_URL;
  });

  it("resolvedTarget is present in the response shape (not undefined)", async () => {
    const res = await request(app).get(
      `/api/integration-governance/connection-profiles/${profileWithHostId}`,
    );
    expect(res.status).toBe(200);
    // The field must exist in the response; absence would mean a regression in
    // the route that enriches the profile row with resolveProfileTarget().
    expect(Object.prototype.hasOwnProperty.call(res.body, "resolvedTarget")).toBe(true);
  });
});
