/**
 * Home-org enforcement tests.
 *
 * Verifies:
 *  1. Login and /auth/me responses include orgId (home org) and canSwitchOrg.
 *  2. A non-system-role session sending X-Org-Id for a different org is rejected 403.
 *  3. A system-role session may freely supply any valid X-Org-Id.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import {
  db,
  organizationsTable,
  employeesTable,
  systemUsersTable,
  rolesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { invalidateOrgCache, invalidateOrgAccessCache } from "../lib/orgContext";
import app from "../app";

const SUFFIX = `HO${Date.now() % 1_000_000}`;

let orgAId: number;
let orgBId: number;
let nonAdminUserId: number;
let nonAdminOrgId: number;
let adminUserId: number;   // dedicated system-role fixture user

const prevAuth = process.env.PILOT_AUTH;

// ── Fixtures ────────────────────────────────────────────────────────────────
beforeAll(async () => {
  process.env.PILOT_AUTH = "false"; // demo mode so we can log in without bcrypt

  // Two isolated orgs
  const [orgA] = await db.insert(organizationsTable).values({
    orgType: "company", orgCode: `${SUFFIX}-A`,
    nameEn: "HomeOrg A", nameAr: "أ", status: "active", createdByUserId: 1,
  }).returning();
  const [orgB] = await db.insert(organizationsTable).values({
    orgType: "company", orgCode: `${SUFFIX}-B`,
    nameEn: "HomeOrg B", nameAr: "ب", status: "active", createdByUserId: 1,
  }).returning();
  orgAId = orgA.id;
  orgBId = orgB.id;

  // Find a non-system role (roleId 3 = Department Head)
  const [nonAdminRole] = await db.select()
    .from(rolesTable)
    .where(eq(rolesTable.systemRole, false))
    .limit(1);

  // Find a system role (roleId 1 = Super Administrator)
  const [adminRole] = await db.select()
    .from(rolesTable)
    .where(eq(rolesTable.systemRole, true))
    .limit(1);

  const [seedEmp] = await db.select().from(employeesTable).limit(1);

  // Employee for non-admin user in orgA
  const [empA] = await db.insert(employeesTable).values({
    ...seedEmp,
    id: undefined as unknown as number,
    employeeNumber: `${SUFFIX}-EMPA`,
    orgId: orgAId,
    nationalId: `${SUFFIX}-NIDA`,
  } as any).returning();

  // Employee for system-role user in orgB
  const [empB] = await db.insert(employeesTable).values({
    ...seedEmp,
    id: undefined as unknown as number,
    employeeNumber: `${SUFFIX}-EMPB`,
    orgId: orgBId,
    nationalId: `${SUFFIX}-NIDB`,
  } as any).returning();

  // Non-admin user: home org = orgA
  const [nonAdmin] = await db.insert(systemUsersTable).values({
    username: `${SUFFIX}-nonadmin`,
    email: `${SUFFIX}-nonadmin@test.local`,
    fullNameEn: "Test NonAdmin",
    fullNameAr: "غير مسؤول",
    roleId: nonAdminRole.id,
    employeeId: empA.id,
    orgId: orgAId,
    isActive: true,
    mfaEnabled: false,
    mustChangePassword: false,
    preferredLanguage: "en",
  }).returning();

  // System-role user: home org = orgB (so cross-org tests are unambiguous)
  const [adminUser] = await db.insert(systemUsersTable).values({
    username: `${SUFFIX}-sysadmin`,
    email: `${SUFFIX}-sysadmin@test.local`,
    fullNameEn: "Test SysAdmin",
    fullNameAr: "مسؤول نظام",
    roleId: adminRole.id,
    employeeId: empB.id,
    orgId: orgBId,
    isActive: true,
    mfaEnabled: false,
    mustChangePassword: false,
    preferredLanguage: "en",
  }).returning();

  nonAdminUserId = nonAdmin.id;
  nonAdminOrgId = orgAId;
  adminUserId = adminUser.id;

  invalidateOrgCache();
  invalidateOrgAccessCache();
});

afterAll(async () => {
  if (prevAuth === undefined) delete process.env.PILOT_AUTH;
  else process.env.PILOT_AUTH = prevAuth;

  await db.delete(systemUsersTable)
    .where(eq(systemUsersTable.username, `${SUFFIX}-nonadmin`)).catch(() => {});
  await db.delete(systemUsersTable)
    .where(eq(systemUsersTable.username, `${SUFFIX}-sysadmin`)).catch(() => {});
  await db.delete(employeesTable)
    .where(eq(employeesTable.employeeNumber, `${SUFFIX}-EMPA`)).catch(() => {});
  await db.delete(employeesTable)
    .where(eq(employeesTable.employeeNumber, `${SUFFIX}-EMPB`)).catch(() => {});
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, orgAId)).catch(() => {});
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, orgBId)).catch(() => {});
  invalidateOrgCache();
  invalidateOrgAccessCache();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("login response includes home-org fields", () => {
  it("login returns orgId matching home org and canSwitchOrg=false for non-system-role user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: `${SUFFIX}-nonadmin`, password: "ignored-demo-mode" });

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(nonAdminOrgId);
    expect(res.body.canSwitchOrg).toBe(false);
  });

  it("system-role login returns canSwitchOrg=true with their home orgId", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: `${SUFFIX}-sysadmin`, password: "irrelevant-in-demo-mode" });

    expect(res.status).toBe(200);
    expect(res.body.canSwitchOrg).toBe(true);
    expect(res.body.orgId).toBe(orgBId);
  });
});

describe("/auth/me includes home-org fields", () => {
  it("returns orgId and canSwitchOrg on /auth/me", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ username: `${SUFFIX}-nonadmin`, password: "ignored" });

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.orgId).toBe(nonAdminOrgId);
    expect(me.body.canSwitchOrg).toBe(false);
  });
});

// X-Org-Id enforcement only applies when auth is enforced (PILOT_AUTH=true).
// Establish sessions while auth is relaxed, then flip for the header checks —
// mirroring the pattern in auth-enforced.test.ts.
describe("X-Org-Id enforcement", () => {
  const nonAdminAgent = request.agent(app);
  const sysAdminAgent = request.agent(app);

  beforeAll(async () => {
    process.env.PILOT_AUTH = "false";
    invalidateOrgAccessCache();
    invalidateOrgCache();

    await nonAdminAgent
      .post("/api/auth/login")
      .send({ username: `${SUFFIX}-nonadmin`, password: "ignored" });
    await sysAdminAgent
      .post("/api/auth/login")
      .send({ username: `${SUFFIX}-sysadmin`, password: "ignored" });

    process.env.PILOT_AUTH = "true";
    invalidateOrgAccessCache();
    invalidateOrgCache();
  });

  afterAll(() => {
    process.env.PILOT_AUTH = "false";
  });

  it("non-system-role session rejected (403) when requesting a different org", async () => {
    // Non-admin home = orgA; requesting orgB must be rejected
    const res = await nonAdminAgent
      .get("/api/organizations")
      .set("X-Org-Id", String(orgBId));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ORG_ACCESS_DENIED");
  });

  it("non-system-role session allowed when requesting their own org", async () => {
    // Non-admin home = orgA; requesting orgA must succeed
    const res = await nonAdminAgent
      .get("/api/organizations")
      .set("X-Org-Id", String(orgAId));

    expect(res.status).toBe(200);
  });

  it("system-role session may request an org other than their home org", async () => {
    // sysAdmin home = orgB; requesting orgA (a different org) must succeed
    const res = await sysAdminAgent
      .get("/api/organizations")
      .set("X-Org-Id", String(orgAId));

    expect(res.status).toBe(200);
  });
});
