/**
 * Authorization for the user directory endpoints.
 *
 * Client routing (web sidebar, mobile Home entry) is not a security
 * boundary: any signed-in user could call these endpoints directly (e.g. by
 * deep-linking the mobile admin screen). The server must enforce:
 *   - GET /users        → Super Administrator only (account enumeration).
 *   - GET /users/:id    → self, or Super Administrator for other records
 *                         (mobile uses the self read to learn its role).
 *   - Unauthenticated requests are rejected outright.
 *
 * Runs under PILOT_AUTH=true so sessions are real. Fixtures are
 * self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
const ADMIN_USERNAME = `dir-admin-${SUFFIX}`;
const NONADMIN_USERNAME = `dir-nonadmin-${SUFFIX}`;
const ADMIN_PASSWORD = "DirAdmin123!";
const NONADMIN_PASSWORD = "DirNonAdmin123!";

let app: Express;
let adminId: number;
let nonAdminId: number;

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "true");
  vi.resetModules();
  app = (await import("../app")).default;

  const [admin] = await db.insert(systemUsersTable).values({
    username: ADMIN_USERNAME,
    email: `${ADMIN_USERNAME}@test.example`,
    fullNameEn: "Directory Admin",
    fullNameAr: "اختبار",
    roleId: 1, // Super Administrator
    isActive: true,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
  }).returning();
  adminId = admin.id;

  const [nonAdmin] = await db.insert(systemUsersTable).values({
    username: NONADMIN_USERNAME,
    email: `${NONADMIN_USERNAME}@test.example`,
    fullNameEn: "Directory Non Admin",
    fullNameAr: "اختبار",
    roleId: 5, // non-admin
    isActive: true,
    passwordHash: await bcrypt.hash(NONADMIN_PASSWORD, 10),
  }).returning();
  nonAdminId = nonAdmin.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const id of [adminId, nonAdminId]) {
    await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id)).catch(() => {});
  }
});

async function loggedInAgent(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

describe("GET /users authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin sessions (no account enumeration)", async () => {
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);
    const res = await agent.get("/api/users");
    expect(res.status).toBe(403);
  });

  it("allows Super Administrator sessions", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.get("/api/users");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // No password material ever leaves the endpoint.
    for (const u of res.body) expect(u.passwordHash).toBeUndefined();
  });
});

describe("GET /users/:id authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get(`/api/users/${nonAdminId}`);
    expect(res.status).toBe(401);
  });

  it("lets a non-admin read only their own record", async () => {
    const agent = await loggedInAgent(NONADMIN_USERNAME, NONADMIN_PASSWORD);

    const self = await agent.get(`/api/users/${nonAdminId}`);
    expect(self.status).toBe(200);
    expect(self.body.username).toBe(NONADMIN_USERNAME);
    expect(typeof self.body.roleNameEn).toBe("string");
    expect(self.body.passwordHash).toBeUndefined();

    const other = await agent.get(`/api/users/${adminId}`);
    expect(other.status).toBe(403);
  });

  it("lets an admin read any record", async () => {
    const agent = await loggedInAgent(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await agent.get(`/api/users/${nonAdminId}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(NONADMIN_USERNAME);
  });
});
