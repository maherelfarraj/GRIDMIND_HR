/**
 * Bearer-session revocation on password change (PILOT_AUTH=true).
 *
 * Sibling to password-session-revocation.test.ts, which covers cookie
 * sessions. Proves that when a user changes their password, any mobile
 * bearer-token sessions are also destroyed — not just cookie sessions.
 * A stolen device cannot stay logged in after the owner rotates their
 * password.
 *
 * Invariants asserted:
 *   - Both bearer sessions are valid before the change.
 *   - After the change, the OTHER bearer session is 401 UNAUTHENTICATED
 *     (no 5xx, no demo fallback).
 *   - The caller's own bearer session (the one that performed the change)
 *     stays alive.
 *   - The revoked token is rejected on reads/writes too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import app from "../app";

const suffix = Date.now();
const TEST_USERNAME = `bearer-pwchange-${suffix}`;
const INITIAL_PASSWORD = "BearerInit1!";
const NEW_PASSWORD = "BearerNew2@Changed";

const prevPilotAuth = process.env.PILOT_AUTH;

let testUserId: number;
/** The session that calls change-password — should survive. */
let tokenA: string;
/** A second device's session — must be revoked after the password change. */
let tokenB: string;

async function mintBearerToken(): Promise<string> {
  // Login in demo mode so no bcrypt comparison is required for minting.
  const login = await request(app)
    .post("/api/auth/login")
    .set("x-session-transport", "bearer")
    .send({ username: TEST_USERNAME, password: "irrelevant-in-demo-mode" });
  expect(login.status).toBe(200);
  const token = login.body.sessionToken;
  expect(typeof token).toBe("string");
  expect(token.length).toBeGreaterThan(10);
  return token;
}

beforeAll(async () => {
  // Create a fixture user with a real bcrypt hash so change-password can
  // verify the current password (that endpoint is always fail-closed on hash,
  // regardless of PILOT_AUTH mode).
  const [role] = await db.select({ id: rolesTable.id }).from(rolesTable).limit(1);
  expect(role).toBeTruthy();

  const [inserted] = await db
    .insert(systemUsersTable)
    .values({
      username: TEST_USERNAME,
      email: `${TEST_USERNAME}@test.invalid`,
      fullNameEn: "Bearer PwChange Fixture",
      fullNameAr: "اختبار",
      roleId: role.id,
      isActive: true,
      passwordHash: await bcrypt.hash(INITIAL_PASSWORD, 10),
    })
    .returning({ id: systemUsersTable.id });
  testUserId = inserted.id;

  // Mint two bearer sessions while auth is relaxed.
  process.env.PILOT_AUTH = "false";
  tokenA = await mintBearerToken();
  tokenB = await mintBearerToken();

  // Enforce auth for every test in this file.
  process.env.PILOT_AUTH = "true";
});

afterAll(async () => {
  if (prevPilotAuth === undefined) delete process.env.PILOT_AUTH;
  else process.env.PILOT_AUTH = prevPilotAuth;
  if (testUserId) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, testUserId)).catch(() => {});
  }
});

describe("password change revokes other bearer sessions", () => {
  it("both bearer sessions are valid before the password change", async () => {
    for (const token of [tokenA, tokenB]) {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe(TEST_USERNAME);
    }
  });

  it("tokenA changes password → tokenB is revoked: 401 UNAUTHENTICATED, no 5xx, no demo fallback", async () => {
    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);
    expect(change.body.success).toBe(true);

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("UNAUTHENTICATED");
    // Must never expose the demo fallback user.
    expect(me.body.username).toBeUndefined();
  });

  it("revoked bearer token is rejected on protected reads too — no 5xx", async () => {
    const res = await request(app)
      .get("/api/employees")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("the bearer session that performed the change stays alive", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(TEST_USERNAME);
  });
});
