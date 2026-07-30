/**
 * Strong-password policy — shared validation (@workspace/api-zod) applied by
 * both password-setting endpoints:
 *   - POST /auth/change-password (self-service, PILOT_AUTH stubbed on)
 *   - POST /users/:id/password   (admin reset)
 *
 * Uses self-cleaning fixture users; vitest runs files sequentially.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";
import {
  getPasswordIssues,
  isStrongPassword,
  StrongPassword,
} from "@workspace/api-zod";

const SUFFIX = Date.now();
const USERNAME = `pw-strength-test-${SUFFIX}`;
const CURRENT_PASSWORD = "Current123!";

let app: Express;
let userId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const passwordHash = await bcrypt.hash(CURRENT_PASSWORD, 10);
  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Password Strength Test",
    fullNameAr: "اختبار قوة كلمة المرور",
    roleId: 1, // Super Administrator — can also exercise the admin reset path
    isActive: true,
    passwordHash,
    mustChangePassword: false,
  }).returning();
  userId = user.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await db.delete(systemUsersTable).where(eq(systemUsersTable.id, userId)).catch(() => {});
});

async function loginAgent() {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ username: USERNAME, password: CURRENT_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

const WEAK = [
  "aaaaaaaa",        // one class
  "abcdefgh",        // one class
  "12345678",        // one class + denylist
  "password",        // denylist
  "Password1",       // 3 classes but... check: lower+upper+digit = 3 classes, not denied? "password1" IS on denylist
  "abc123",          // too short
  "ABCDEF12",        // two classes
  "P@ssw0rd",        // denylist (case-insensitive)
];

const STRONG = [
  "Str0ng!Pass",
  "MyOwnSecret456!",
  "correct-Horse7",
  "Aa1!Aa1!",
];

describe("shared password policy (unit)", () => {
  it("rejects weak examples", () => {
    for (const pw of WEAK) {
      expect(isStrongPassword(pw), `expected weak: ${pw}`).toBe(false);
      expect(StrongPassword.safeParse(pw).success, `zod should reject: ${pw}`).toBe(false);
    }
  });

  it("accepts strong examples", () => {
    for (const pw of STRONG) {
      expect(getPasswordIssues(pw), `expected strong: ${pw}`).toEqual([]);
      expect(StrongPassword.safeParse(pw).success).toBe(true);
    }
  });

  it("issues carry bilingual messages", () => {
    const issues = getPasswordIssues("aaaaaaaa");
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.messageEn).toBeTruthy();
      expect(issue.messageAr).toBeTruthy();
    }
  });
});

describe("POST /auth/change-password enforces the policy", () => {
  it("rejects an all-lowercase 8-char password with a bilingual error", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: "aaaaaaaa" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowercase|classes|3 of/i);
    expect(res.body.errorAr).toBeTruthy();
  });

  it("rejects a common password even with mixed classes", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: "P@ssw0rd" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too common/i);
  });

  it("accepts a strong password, then restores the original", async () => {
    const agent = await loginAgent();
    const strong = "Str0ng!Pass";
    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: strong });
    expect(res.status).toBe(200);
    // restore for other tests in this file
    const back = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: strong, newPassword: CURRENT_PASSWORD });
    expect(back.status).toBe(200);
  });
});

describe("POST /users/:id/password enforces the policy", () => {
  it("rejects a weak admin-set password", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post(`/api/users/${userId}/password`)
      .send({ password: "aaaaaaaa" });
    expect(res.status).toBe(400);
    expect(res.body.errorAr).toBeTruthy();
  });

  it("rejects a denylisted admin-set password", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post(`/api/users/${userId}/password`)
      .send({ password: "Admin@123" });
    expect(res.status).toBe(400);
  });

  it("accepts a strong admin-set password (and sets mustChangePassword)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post(`/api/users/${userId}/password`)
      .send({ password: "Fresh#Reset42" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [u] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId));
    expect(u.mustChangePassword).toBe(true);
  });
});
