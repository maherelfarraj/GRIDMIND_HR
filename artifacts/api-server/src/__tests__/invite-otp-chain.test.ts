/**
 * Invite User → one-time password chain (HRMS admin onboarding).
 *
 * Covers the full server-side contract for the "Invite User" flow:
 *   1. POST /api/users enforces the CreateUserBody schema — missing or
 *      wrong-typed required fields are rejected with 400.
 *   2. Non-admin sessions are rejected with 403 (minimal assertion;
 *      exhaustive authz coverage lives in user-directory-authz.test.ts).
 *   3. A successful create produces a user that is immediately ready for
 *      OTP issuance — POST /api/users/:id/one-time-password succeeds for
 *      the newly created user, matching the UI chain where onSuccess calls
 *      setOtpTarget({ id: created.id, name }) to open the OTP dialog.
 *
 * Runs under PILOT_AUTH=true so sessions are real. Fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, systemUsersTable, auditLogsTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const ADMIN_USERNAME = `invite-admin-${SUFFIX}`;
const NONADMIN_USERNAME = `invite-nonadmin-${SUFFIX}`;
const ADMIN_PASSWORD = "InviteAdmin123!";
const NONADMIN_PASSWORD = "InviteNonAdmin123!";

let app: Express;
let adminId: number;
let nonAdminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [admin] = await db
    .insert(systemUsersTable)
    .values({
      username: ADMIN_USERNAME,
      email: `${ADMIN_USERNAME}@test.example`,
      fullNameEn: "Invite Admin",
      fullNameAr: "مدير الدعوة",
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
      fullNameEn: "Invite Non Admin",
      fullNameAr: "مستخدم عادي",
      roleId: 5, // non-admin
      isActive: true,
      passwordHash: await bcrypt.hash(NONADMIN_PASSWORD, 10),
    })
    .returning();
  nonAdminId = nonAdmin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const id of [adminId, nonAdminId]) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

// Track every user created by POST /api/users so afterEach can remove them
// (plus their audit rows) even when a test fails mid-way.
const CREATED_USER_IDS: number[] = [];

afterEach(async () => {
  for (const id of CREATED_USER_IDS.splice(0)) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, id)).catch(() => {});
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

async function loggedInAgent(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

/** A fully valid CreateUserBody payload for the given label. */
function validPayload(label: string) {
  return {
    username: `invite-test-${label}-${SUFFIX}`,
    email: `invite-test-${label}-${SUFFIX}@test.example`,
    fullNameEn: "Invite Test",
    fullNameAr: "اختبار الدعوة",
    roleId: 5,
    isActive: true,
    preferredLanguage: "en",
  };
}

// ---------------------------------------------------------------------------
// CreateUserBody schema enforcement
// ---------------------------------------------------------------------------

describe("POST /api/users — CreateUserBody schema enforcement", () => {
  it("rejects a request with no body with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.post("/api/users").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a missing username with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { username: _omit, ...payload } = validPayload("no-username");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a missing email with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { email: _omit, ...payload } = validPayload("no-email");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a missing fullNameEn with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { fullNameEn: _omit, ...payload } = validPayload("no-name-en");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a missing fullNameAr with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { fullNameAr: _omit, ...payload } = validPayload("no-name-ar");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a missing roleId with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { roleId: _omit, ...payload } = validPayload("no-role");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a missing isActive with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { isActive: _omit, ...payload } = validPayload("no-active");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a missing preferredLanguage with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const { preferredLanguage: _omit, ...payload } = validPayload("no-lang");
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric roleId with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent
      .post("/api/users")
      .send({ ...validPayload("bad-role"), roleId: "five" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-boolean isActive with 400", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent
      .post("/api/users")
      .send({ ...validPayload("bad-active"), isActive: "yes" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Authorization — non-admin sessions (minimal; exhaustive coverage in
// user-directory-authz.test.ts).
// ---------------------------------------------------------------------------

describe("POST /api/users — non-admin authorization", () => {
  it("rejects non-admin sessions with 403 and does not create a user", async () => {
    const payload = validPayload("nonadmin-authz");
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.post("/api/users").send(payload);
    expect(res.status).toBe(403);

    // Confirm no row was written.
    const rows = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, payload.username));
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invite → OTP chain (happy path)
// ---------------------------------------------------------------------------

describe("Invite User → OTP chain", () => {
  it("creates a user with all CreateUserBody fields and immediately enables OTP issuance", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const payload = validPayload("chain");

    // Step 1 — create the user (mirrors the UI's createUser.mutate call).
    const createRes = await agent.post("/api/users").send(payload);
    expect(createRes.status).toBe(201);

    const created = createRes.body;

    // Track for cleanup even if subsequent assertions fail.
    CREATED_USER_IDS.push(created.id as number);

    // Response must include every field from CreateUserBody.
    expect(created.username).toBe(payload.username);
    expect(created.email).toBe(payload.email);
    expect(created.fullNameEn).toBe(payload.fullNameEn);
    expect(created.fullNameAr).toBe(payload.fullNameAr);
    expect(created.roleId).toBe(payload.roleId);
    expect(created.isActive).toBe(payload.isActive);
    expect(created.preferredLanguage).toBe(payload.preferredLanguage);

    // Password material must never leave the endpoint.
    expect(created.passwordHash).toBeUndefined();

    // A numeric id is required for the OTP step.
    expect(typeof created.id).toBe("number");

    // Step 2 — issue an OTP for the newly created user.
    // This mirrors the UI chain: onSuccess calls setOtpTarget({ id: created.id, name })
    // which opens the OTP confirm dialog; the admin then clicks "Issue One-Time Password".
    const otpRes = await agent.post(`/api/users/${created.id}/one-time-password`);
    expect(otpRes.status).toBe(200);

    // OTP is returned exactly once in the response and is a non-empty string.
    expect(typeof otpRes.body.oneTimePassword).toBe("string");
    expect(otpRes.body.oneTimePassword.length).toBeGreaterThan(0);
    expect(otpRes.body.username).toBe(payload.username);
    expect(otpRes.body.mustChangePassword).toBe(true);

    // The DB row must be flagged so the new user is forced to set their own
    // password on first sign-in.
    const [row] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, created.id));
    expect(row.mustChangePassword).toBe(true);

    // The stored credential is a bcrypt hash of the OTP, never the plaintext.
    expect(row.passwordHash).not.toBe(otpRes.body.oneTimePassword);
    expect(
      await bcrypt.compare(otpRes.body.oneTimePassword, row.passwordHash!),
    ).toBe(true);

    // An audit event must record the issuance without containing the OTP value.
    const [audit] = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, "user.otp_issued"),
          eq(auditLogsTable.entityId, created.id),
        ),
      );
    expect(audit).toBeTruthy();
    expect(audit.action).toBe("user.otp_issued");
    expect(audit.actorUserId).toBe(adminId);
    expect(audit.changesJson ?? "").not.toContain(otpRes.body.oneTimePassword);
  });
});
