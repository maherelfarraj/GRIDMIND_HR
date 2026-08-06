/**
 * Enforced-auth regression suite for the MOBILE bearer-token session
 * transport (Authorization: Bearer <sid>).
 *
 * Sibling to auth-enforced.test.ts, which covers cookie sessions. With
 * PILOT_AUTH=true:
 *   - missing / garbage / logged-out bearer tokens must 401 with code
 *     UNAUTHENTICATED on protected routes — never a 5xx, never the demo
 *     fallback user
 *   - a valid bearer token must still allow reads AND writes
 *
 * Tokens are minted while auth is relaxed (isAuthEnforced() is read at
 * request time), avoiding a dependency on the seeded admin's bcrypt
 * password (see credential-handoff conventions).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, publicHolidaysTable, employeesTable, systemUsersTable } from "@workspace/db";
import app from "../app";

const prevPilotAuth = process.env.PILOT_AUTH;
const suffix = Date.now();
const createdHolidayIds: number[] = [];

let validToken: string; // stays logged in for the whole file
let destroyedToken: string; // logged out before the enforced tests run

let savedAdminId: number;
let savedMustChangePassword: boolean;

async function mintBearerToken(): Promise<string> {
  const login = await request(app)
    .post("/api/auth/login")
    .set("x-session-transport", "bearer")
    .send({ username: "admin", password: "irrelevant-in-demo-mode" });
  expect(login.status).toBe(200);
  const token = login.body.sessionToken;
  expect(typeof token).toBe("string");
  expect(token.length).toBeGreaterThan(10);
  return token;
}

beforeAll(async () => {
  // Save and clear must_change_password so enforcePasswordChange middleware
  // doesn't block authenticated requests with 403 PASSWORD_CHANGE_REQUIRED.
  const [admin] = await db
    .select({ id: systemUsersTable.id, mustChangePassword: systemUsersTable.mustChangePassword })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.username, "admin"));
  savedAdminId = admin.id;
  savedMustChangePassword = admin.mustChangePassword;
  if (admin.mustChangePassword) {
    await db.update(systemUsersTable)
      .set({ mustChangePassword: false })
      .where(eq(systemUsersTable.id, admin.id));
  }

  // Mint two real bearer sessions while auth is relaxed…
  process.env.PILOT_AUTH = "false";
  validToken = await mintBearerToken();
  destroyedToken = await mintBearerToken();

  // …destroy one of them via logout…
  const out = await request(app)
    .post("/api/auth/logout")
    .set("Authorization", `Bearer ${destroyedToken}`);
  expect(out.status).toBe(200);

  // …then enforce auth for every test in this file.
  process.env.PILOT_AUTH = "true";
});

afterAll(async () => {
  if (prevPilotAuth === undefined) delete process.env.PILOT_AUTH;
  else process.env.PILOT_AUTH = prevPilotAuth;

  // Restore admin's original must_change_password flag.
  await db.update(systemUsersTable)
    .set({ mustChangePassword: savedMustChangePassword })
    .where(eq(systemUsersTable.id, savedAdminId))
    .catch(() => {});

  for (const id of createdHolidayIds) {
    await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, id)).catch(() => {});
  }
});

describe("bearer transport with auth enforced — invalid tokens", () => {
  const protectedReads = ["/api/auth/me", "/api/employees", "/api/leave-requests"];

  it("missing bearer token → 401 UNAUTHENTICATED on protected reads", async () => {
    for (const path of protectedReads) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("garbage bearer tokens → 401 UNAUTHENTICATED, never 5xx, never demo fallback", async () => {
    const garbage = [
      "not!!a$$valid##sid",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // well-formed-looking but unknown sid
      "", // empty
      "s%3Aforged.signature", // cookie-style forged value
    ];
    for (const token of garbage) {
      for (const path of protectedReads) {
        const res = await request(app)
          .get(path)
          .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHENTICATED");
        // never the demo fallback user
        expect(res.body.username).toBeUndefined();
      }
    }
  });

  it("garbage bearer token → 401 on writes, nothing persisted", async () => {
    const res = await request(app)
      .post("/api/public-holidays")
      .set("Authorization", "Bearer definitely-not-a-session")
      .send({ nameEn: `Bearer Anon Holiday ${suffix}`, nameAr: "عطلة", date: "2026-12-03", year: 2026 });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");

    const rows = await db.select({ id: publicHolidaysTable.id })
      .from(publicHolidaysTable)
      .where(eq(publicHolidaysTable.nameEn, `Bearer Anon Holiday ${suffix}`));
    expect(rows).toHaveLength(0);
  });

  it("logged-out (destroyed) bearer token → 401 UNAUTHENTICATED on reads and writes", async () => {
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${destroyedToken}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("UNAUTHENTICATED");

    const write = await request(app)
      .post("/api/public-holidays")
      .set("Authorization", `Bearer ${destroyedToken}`)
      .send({ nameEn: `Bearer Destroyed Holiday ${suffix}`, nameAr: "عطلة", date: "2026-12-04", year: 2026 });
    expect(write.status).toBe(401);
    expect(write.body.code).toBe("UNAUTHENTICATED");

    const rows = await db.select({ id: publicHolidaysTable.id })
      .from(publicHolidaysTable)
      .where(eq(publicHolidaysTable.nameEn, `Bearer Destroyed Holiday ${suffix}`));
    expect(rows).toHaveLength(0);
  });
});

describe("bearer transport with auth enforced — valid token", () => {
  it("GET /api/auth/me returns the logged-in admin (no cookies involved)", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("admin");
  });

  it("protected reads succeed with a valid bearer token", async () => {
    const res = await request(app)
      .get("/api/employees")
      .set("Authorization", `Bearer ${validToken}`);
    expect(res.status).toBe(200);
  });

  it("POST /api/public-holidays succeeds and is persisted", async () => {
    const res = await request(app)
      .post("/api/public-holidays")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ nameEn: `Bearer Enforced Holiday ${suffix}`, nameAr: "عطلة اختبار", date: "2026-12-05", year: 2026 });
    expect(res.status).toBe(201);
    createdHolidayIds.push(res.body.id);

    const rows = await db.select({ id: publicHolidaysTable.id })
      .from(publicHolidaysTable)
      .where(eq(publicHolidaysTable.id, res.body.id));
    expect(rows).toHaveLength(1);
  });

  it("after logout, the same bearer token is rejected → 401", async () => {
    const out = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${validToken}`);
    expect(out.status).toBe(200);

    const res = await request(app)
      .get("/api/employees")
      .set("Authorization", `Bearer ${validToken}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });
});
