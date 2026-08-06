/**
 * Authorization sweep for admin-only mutating endpoints outside /users.
 *
 * For every covered endpoint we assert three cases:
 *   1. Unauthenticated  → 401 (no session at all)
 *   2. Non-admin authed → 403 (session exists but role ≠ Super Administrator)
 *   3. Admin authed     → the documented success status (endpoint reached)
 *
 * Where the success case depends on a pre-existing DB row (e.g. PATCH /:id)
 * we create the row in beforeAll and clean it up in afterAll.
 * Where the endpoint performs a side-effect we cannot easily undo in CI
 * (e.g. POST /admin/backup-records/run) we just verify the response is not
 * 401 or 403 — meaning the auth guard passed.
 *
 * Runs under PILOT_AUTH=true so sessions are real.  All fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  systemUsersTable,
  rolesTable,
  branchServersTable,
  licenseRecordsTable,
  updatePackagesTable,
} from "@workspace/db";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SUFFIX = Date.now();
const ADMIN_USERNAME = `authz-admin-${SUFFIX}`;
const NONADMIN_USERNAME = `authz-nonadmin-${SUFFIX}`;
const ADMIN_PASSWORD = "AuthzAdmin123!";
const NONADMIN_PASSWORD = "AuthzNonAdmin123!";

let app: Express;
let adminId: number;
let nonAdminId: number;

// IDs of rows created during testing — cleaned up in afterAll.
let testBranchServerId: number;
let testRoleId: number;
let testUpdatePackageId: number;
let testLicenseId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [admin] = await db
    .insert(systemUsersTable)
    .values({
      username: ADMIN_USERNAME,
      email: `${ADMIN_USERNAME}@test.example`,
      fullNameEn: "Authz Admin",
      fullNameAr: "مسؤول",
      roleId: 1, // Super Administrator
      isActive: true,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
    })
    .returning();
  adminId = admin.id;

  const [nonAdmin] = await db
    .insert(systemUsersTable)
    .values({
      username: NONADMIN_USERNAME,
      email: `${NONADMIN_USERNAME}@test.example`,
      fullNameEn: "Authz Non Admin",
      fullNameAr: "مستخدم",
      roleId: 5,
      isActive: true,
      passwordHash: await bcrypt.hash(NONADMIN_PASSWORD, 10),
    })
    .returning();
  nonAdminId = nonAdmin.id;

  // Pre-create a branch server for PATCH tests.
  const [branch] = await db
    .insert(branchServersTable)
    .values({
      serverCode: `TEST-${SUFFIX}`,
      nameEn: "Test Branch",
      nameAr: "فرع اختبار",
      status: "active",
    })
    .returning();
  testBranchServerId = branch.id;

  // Pre-create a custom role for PATCH/DELETE tests.
  const [role] = await db
    .insert(rolesTable)
    .values({
      nameEn: `Test Role ${SUFFIX}`,
      nameAr: "دور اختبار",
      permissionsJson: "[]",
    })
    .returning();
  testRoleId = role.id;

  // Pre-create an update package for PATCH/verify/install tests.
  const [pkg] = await db
    .insert(updatePackagesTable)
    .values({
      packageName: `test-pkg-${SUFFIX}`,
      packageVersion: "1.0.0",
      checksum: "test-checksum-placeholder",
      status: "pending",
    })
    .returning();
  testUpdatePackageId = pkg.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();

  // Users
  for (const id of [adminId, nonAdminId]) {
    await db
      .delete(systemUsersTable)
      .where(eq(systemUsersTable.id, id))
      .catch(() => {});
  }
  // Branch server
  await db
    .delete(branchServersTable)
    .where(eq(branchServersTable.id, testBranchServerId))
    .catch(() => {});
  // Role
  await db
    .delete(rolesTable)
    .where(eq(rolesTable.id, testRoleId))
    .catch(() => {});
  // Update package
  await db
    .delete(updatePackagesTable)
    .where(eq(updatePackagesTable.id, testUpdatePackageId))
    .catch(() => {});
  // License (created during test)
  if (testLicenseId) {
    await db
      .delete(licenseRecordsTable)
      .where(eq(licenseRecordsTable.id, testLicenseId))
      .catch(() => {});
  }
});

async function adminAgent() {
  const agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

async function nonAdminAgent() {
  const agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: NONADMIN_USERNAME, password: NONADMIN_PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

// ---------------------------------------------------------------------------
// Backup endpoints
// ---------------------------------------------------------------------------

describe("POST /admin/backup-records/retry-offsite authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post("/api/admin/backup-records/retry-offsite");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.post("/api/admin/backup-records/retry-offsite");
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator (returns sweep results)", async () => {
    const agent = await adminAgent();
    const res = await agent.post("/api/admin/backup-records/retry-offsite");
    expect(res.status).toBe(200);
  });
});

describe("POST /admin/backup-records/:id/retry-offsite authorization", () => {
  const fakeId = 999999;

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post(`/api/admin/backup-records/${fakeId}/retry-offsite`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.post(`/api/admin/backup-records/${fakeId}/retry-offsite`);
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator (auth guard passed; 404 for unknown id is expected)", async () => {
    const agent = await adminAgent();
    const res = await agent.post(`/api/admin/backup-records/${fakeId}/retry-offsite`);
    expect([404, 400]).toContain(res.status); // auth cleared; handler logic ran
  });
});

describe("PATCH /admin/backup-records/:id/verify authorization", () => {
  const fakeId = 999999;

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).patch(`/api/admin/backup-records/${fakeId}/verify`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.patch(`/api/admin/backup-records/${fakeId}/verify`);
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator (auth guard passed; 404 for unknown id is expected)", async () => {
    const agent = await adminAgent();
    const res = await agent.patch(`/api/admin/backup-records/${fakeId}/verify`);
    expect(res.status).toBe(404);
  });
});

describe("POST /admin/backup-records/run authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/admin/backup-records/run")
      .send({ backupType: "full" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .post("/api/admin/backup-records/run")
      .send({ backupType: "full" });
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to reach the handler (auth guard passed)", async () => {
    const agent = await adminAgent();
    const res = await agent
      .post("/api/admin/backup-records/run")
      .send({ backupType: "full" });
    // In CI the actual pg_dump may succeed (201) or fail (500), but auth passed.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Branch server endpoints
// ---------------------------------------------------------------------------

describe("POST /admin/branch-servers authorization", () => {
  const serverCode = `NEWBRANCH-${SUFFIX}`;
  let createdId: number;

  afterAll(async () => {
    if (createdId) {
      await db
        .delete(branchServersTable)
        .where(eq(branchServersTable.id, createdId))
        .catch(() => {});
    }
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/admin/branch-servers")
      .send({ serverCode, nameEn: "New", nameAr: "جديد" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and does not create a row", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .post("/api/admin/branch-servers")
      .send({ serverCode, nameEn: "New", nameAr: "جديد" });
    expect(res.status).toBe(403);
    const rows = await db
      .select()
      .from(branchServersTable)
      .where(eq(branchServersTable.serverCode, serverCode));
    expect(rows).toHaveLength(0);
  });

  it("allows Super Administrator to create a branch server", async () => {
    const agent = await adminAgent();
    const res = await agent
      .post("/api/admin/branch-servers")
      .send({ serverCode, nameEn: "New Branch", nameAr: "فرع جديد" });
    expect(res.status).toBe(201);
    expect(res.body.serverCode).toBe(serverCode);
    createdId = res.body.id;
  });
});

describe("PATCH /admin/branch-servers/:id authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .patch(`/api/admin/branch-servers/${testBranchServerId}`)
      .send({ nameEn: "Hacked" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and leaves the row unchanged", async () => {
    const [before] = await db
      .select()
      .from(branchServersTable)
      .where(eq(branchServersTable.id, testBranchServerId));

    const agent = await nonAdminAgent();
    const res = await agent
      .patch(`/api/admin/branch-servers/${testBranchServerId}`)
      .send({ nameEn: "Hacked" });
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(branchServersTable)
      .where(eq(branchServersTable.id, testBranchServerId));
    expect(after.nameEn).toBe(before.nameEn);
  });

  it("allows Super Administrator to update a branch server", async () => {
    const agent = await adminAgent();
    const res = await agent
      .patch(`/api/admin/branch-servers/${testBranchServerId}`)
      .send({ nameEn: "Updated Branch" });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe("Updated Branch");
  });
});

describe("POST /admin/sync-queue/:id/resolve authorization", () => {
  const fakeId = 999999;

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post(`/api/admin/sync-queue/${fakeId}/resolve`)
      .send({ resolution: "accepted" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .post(`/api/admin/sync-queue/${fakeId}/resolve`)
      .send({ resolution: "accepted" });
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator (auth guard passed; 404 for unknown id is expected)", async () => {
    const agent = await adminAgent();
    const res = await agent
      .post(`/api/admin/sync-queue/${fakeId}/resolve`)
      .send({ resolution: "accepted" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// License endpoint
// ---------------------------------------------------------------------------

describe("POST /admin/license authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/admin/license")
      .send({ licenseKey: "TEST-LICENSE-KEY", issuedTo: "Test Org" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .post("/api/admin/license")
      .send({ licenseKey: "TEST-LICENSE-KEY", issuedTo: "Test Org" });
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to register a license", async () => {
    const agent = await adminAgent();
    const res = await agent
      .post("/api/admin/license")
      .send({ licenseKey: `KEY-${SUFFIX}`, issuedTo: "Test Org" });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(true);
    testLicenseId = res.body.id;
  });
});

// ---------------------------------------------------------------------------
// Roles endpoints
// ---------------------------------------------------------------------------

describe("POST /roles authorization", () => {
  let createdRoleId: number;

  afterAll(async () => {
    if (createdRoleId) {
      await db
        .delete(rolesTable)
        .where(eq(rolesTable.id, createdRoleId))
        .catch(() => {});
    }
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/roles")
      .send({ nameEn: "Hacker Role", nameAr: "دور", permissions: [] });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and does not create a role", async () => {
    const label = `NonadminRole-${SUFFIX}`;
    const agent = await nonAdminAgent();
    const res = await agent
      .post("/api/roles")
      .send({ nameEn: label, nameAr: "دور", permissions: [] });
    expect(res.status).toBe(403);
    const rows = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.nameEn, label));
    expect(rows).toHaveLength(0);
  });

  it("allows Super Administrator to create a role", async () => {
    const agent = await adminAgent();
    const res = await agent
      .post("/api/roles")
      .send({ nameEn: `AdminRole-${SUFFIX}`, nameAr: "دور مسؤول", permissions: [] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    createdRoleId = res.body.id;
  });
});

describe("PATCH /roles/:id authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .patch(`/api/roles/${testRoleId}`)
      .send({ nameEn: "Hacked Role" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and leaves the role unchanged", async () => {
    const [before] = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.id, testRoleId));

    const agent = await nonAdminAgent();
    const res = await agent
      .patch(`/api/roles/${testRoleId}`)
      .send({ nameEn: "Hacked Role" });
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.id, testRoleId));
    expect(after.nameEn).toBe(before.nameEn);
  });

  it("allows Super Administrator to update a role", async () => {
    const agent = await adminAgent();
    const newName = `Updated Role ${SUFFIX}`;
    const res = await agent
      .patch(`/api/roles/${testRoleId}`)
      .send({ nameEn: newName });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe(newName);
  });
});

describe("DELETE /roles/:id authorization", () => {
  let roleToDeleteId: number;

  beforeAll(async () => {
    const [r] = await db
      .insert(rolesTable)
      .values({ nameEn: `DeleteTarget-${SUFFIX}`, nameAr: "حذف", permissionsJson: "[]" })
      .returning();
    roleToDeleteId = r.id;
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).delete(`/api/roles/${roleToDeleteId}`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and leaves the role in the DB", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.delete(`/api/roles/${roleToDeleteId}`);
    expect(res.status).toBe(403);
    const rows = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.id, roleToDeleteId));
    expect(rows).toHaveLength(1);
  });

  it("allows Super Administrator to delete a role", async () => {
    const agent = await adminAgent();
    const res = await agent.delete(`/api/roles/${roleToDeleteId}`);
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.id, roleToDeleteId));
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// System config endpoint
// ---------------------------------------------------------------------------

describe("PATCH /system-config authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ "org.name": "Hacked" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .patch("/api/system-config")
      .send({ "org.name": "Hacked" });
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to update system config", async () => {
    const agent = await adminAgent();
    // Send an update; even if the key doesn't exist the handler returns 200
    // with the list of successfully updated rows (may be empty for unknown keys).
    const res = await agent
      .patch("/api/system-config")
      .send({ "org.name": "Test Org Name" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Setup wizard endpoints
// ---------------------------------------------------------------------------

describe("PATCH /setup/wizard authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .patch("/api/setup/wizard")
      .send({ currentStep: "org_profile" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .patch("/api/setup/wizard")
      .send({ currentStep: "org_profile" });
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to update wizard progress", async () => {
    const agent = await adminAgent();
    const res = await agent
      .patch("/api/setup/wizard")
      .send({ currentStep: "org_profile", completedSteps: [] });
    expect([200, 201]).toContain(res.status);
  });
});

describe("POST /setup/wizard/complete authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post("/api/setup/wizard/complete");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.post("/api/setup/wizard/complete");
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to complete the wizard", async () => {
    const agent = await adminAgent();
    const res = await agent.post("/api/setup/wizard/complete");
    // 200 if wizard row exists, 404 if not yet created — auth passed either way.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("POST /setup/wizard/reset authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post("/api/setup/wizard/reset");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.post("/api/setup/wizard/reset");
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to reset the wizard", async () => {
    const agent = await adminAgent();
    const res = await agent.post("/api/setup/wizard/reset");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Update packages endpoints
// ---------------------------------------------------------------------------

describe("POST /update-packages authorization", () => {
  let createdPkgId: number;

  afterAll(async () => {
    if (createdPkgId) {
      await db
        .delete(updatePackagesTable)
        .where(eq(updatePackagesTable.id, createdPkgId))
        .catch(() => {});
    }
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/update-packages")
      .send({ packageName: "pkg", packageVersion: "1.0.0", status: "pending" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent
      .post("/api/update-packages")
      .send({ packageName: "pkg", packageVersion: "1.0.0", checksum: "x", status: "pending" });
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to register an update package", async () => {
    const agent = await adminAgent();
    const res = await agent
      .post("/api/update-packages")
      .send({ packageName: `pkg-${SUFFIX}`, packageVersion: "2.0.0", checksum: "test-cs", status: "pending" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    createdPkgId = res.body.id;
  });
});

describe("PATCH /update-packages/:id authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .patch(`/api/update-packages/${testUpdatePackageId}`)
      .send({ status: "verified" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403 and leaves the row unchanged", async () => {
    const [before] = await db
      .select()
      .from(updatePackagesTable)
      .where(eq(updatePackagesTable.id, testUpdatePackageId));

    const agent = await nonAdminAgent();
    const res = await agent
      .patch(`/api/update-packages/${testUpdatePackageId}`)
      .send({ status: "hacked" });
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(updatePackagesTable)
      .where(eq(updatePackagesTable.id, testUpdatePackageId));
    expect(after.status).toBe(before.status);
  });

  it("allows Super Administrator to update a package", async () => {
    const agent = await adminAgent();
    const res = await agent
      .patch(`/api/update-packages/${testUpdatePackageId}`)
      .send({ status: "verified" });
    expect(res.status).toBe(200);
  });
});

describe("POST /update-packages/:id/verify authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post(
      `/api/update-packages/${testUpdatePackageId}/verify`
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.post(
      `/api/update-packages/${testUpdatePackageId}/verify`
    );
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to verify a package", async () => {
    const agent = await adminAgent();
    const res = await agent.post(
      `/api/update-packages/${testUpdatePackageId}/verify`
    );
    expect(res.status).toBe(200);
    expect(res.body.signatureVerified).toBe(true);
  });
});

describe("POST /update-packages/:id/install authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).post(
      `/api/update-packages/${testUpdatePackageId}/install`
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions with 403", async () => {
    const agent = await nonAdminAgent();
    const res = await agent.post(
      `/api/update-packages/${testUpdatePackageId}/install`
    );
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator to reach the install handler (auth guard passed)", async () => {
    const agent = await adminAgent();
    const res = await agent.post(
      `/api/update-packages/${testUpdatePackageId}/install`
    );
    // Auth cleared — the handler ran. Business-logic errors (500) in CI are
    // acceptable here; what matters is the response is not 401 or 403.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
