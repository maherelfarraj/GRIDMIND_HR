/**
 * Auth-regression suite: runs key write endpoints with sign-in ENFORCED
 * (PILOT_AUTH=true) against the live app.
 *
 * Guards against two regression classes:
 *   1. A route forgetting requireAuth — anonymous writes must 401 with
 *      code UNAUTHENTICATED and must not touch the database.
 *   2. Anonymous actors slipping into the audit trail — a rejected
 *      anonymous request must never produce an audit row (in particular,
 *      never one attributed to the seeded admin, user #1).
 *
 * Authenticated requests are made through a session established while auth
 * was still relaxed (isAuthEnforced() is read at request time, so an
 * existing session cookie remains valid after the flip). This avoids
 * depending on the seeded admin's bcrypt password, which is not fixed in
 * source (see credential-handoff conventions).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { count, eq, gt } from "drizzle-orm";
import { db, auditLogsTable, employeesTable, publicHolidaysTable, systemUsersTable } from "@workspace/db";
import app from "../app";

const prevPilotAuth = process.env.PILOT_AUTH;
const agent = request.agent(app); // holds an authenticated session cookie

const createdEmployeeIds: number[] = [];
const createdHolidayIds: number[] = [];
const suffix = Date.now();

let savedAdminId: number;
let savedMustChangePassword: boolean;

async function auditRowCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(auditLogsTable);
  return row.n;
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

  // Establish a real logged-in session while auth is relaxed…
  process.env.PILOT_AUTH = "false";
  const login = await agent
    .post("/api/auth/login")
    .send({ username: "admin", password: "irrelevant-in-demo-mode" });
  expect(login.status).toBe(200);
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

  for (const id of createdEmployeeIds) {
    await db.delete(employeesTable).where(eq(employeesTable.id, id)).catch(() => {});
  }
  for (const id of createdHolidayIds) {
    await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, id)).catch(() => {});
  }
});

describe("anonymous write requests with auth enforced", () => {
  it("POST /api/employees → 401 UNAUTHENTICATED, nothing persisted", async () => {
    const res = await request(app).post("/api/employees").send({
      employeeNumber: `ENF-ANON-${suffix}`,
      firstNameEn: "Anon", lastNameEn: "Blocked",
      firstNameAr: "مجهول", lastNameAr: "محظور",
      nationalId: `ENFA${suffix.toString().slice(-8)}`,
      jobTitleEn: "Tester", jobTitleAr: "مختبر",
      departmentId: 1, roleId: 1,
      status: "active", employmentType: "full_time",
      email: `enf-anon-${suffix}@test.example`,
      hireDate: "2024-01-01", nationality: "SA",
      organizationType: "commercial",
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");

    const rows = await db.select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.employeeNumber, `ENF-ANON-${suffix}`));
    expect(rows).toHaveLength(0);
  });

  it("POST /api/public-holidays → 401, nothing persisted", async () => {
    const res = await request(app).post("/api/public-holidays").send({
      nameEn: `Anon Holiday ${suffix}`, nameAr: "عطلة",
      date: "2026-12-01", year: 2026,
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");

    const rows = await db.select({ id: publicHolidaysTable.id })
      .from(publicHolidaysTable)
      .where(eq(publicHolidaysTable.nameEn, `Anon Holiday ${suffix}`));
    expect(rows).toHaveLength(0);
  });

  it("audit-sensitive writes (leave, break-glass, payroll) 401 and produce no audit rows", async () => {
    const before = await auditRowCount();
    const beforeTs = new Date();

    const attempts = await Promise.all([
      request(app).post("/api/leave-requests").send({ leaveTypeId: 1, startDate: "2026-09-01", endDate: "2026-09-02" }),
      request(app).post("/api/break-glass").send({ reason: "anon attempt" }),
      request(app).post("/api/payroll-periods").send({ month: 9, year: 2026 }),
      request(app).post("/api/leave-requests/1/decide").send({ decision: "approved" }),
    ]);
    for (const res of attempts) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }

    // No audit rows at all were written by the rejected requests — so an
    // anonymous request can never be attributed to user #1 (or anyone).
    expect(await auditRowCount()).toBe(before);
    const attributed = await db.select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(gt(auditLogsTable.createdAt, beforeTs));
    expect(attributed.filter(() => true)).toHaveLength(0);
  });

  it("anonymous reads of protected data also 401", async () => {
    for (const path of ["/api/employees", "/api/leave-requests", "/api/audit-logs"]) {
      const res = await request(app).get(path);
      expect([401, 404]).toContain(res.status); // 404 only if route not mounted
      if (res.status === 401) expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });
});

describe("authenticated session with auth enforced", () => {
  it("GET /api/auth/me returns the logged-in admin", async () => {
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("admin");
  });

  it("POST /api/public-holidays succeeds and is persisted", async () => {
    const res = await agent.post("/api/public-holidays").send({
      nameEn: `Enforced Holiday ${suffix}`, nameAr: "عطلة اختبار",
      date: "2026-12-02", year: 2026,
    });
    expect(res.status).toBe(201);
    createdHolidayIds.push(res.body.id);
  });

  it("POST /api/employees succeeds with a session", async () => {
    const res = await agent.post("/api/employees").send({
      employeeNumber: `ENF-AUTH-${suffix}`,
      firstNameEn: "Authed", lastNameEn: "Allowed",
      firstNameAr: "موثق", lastNameAr: "مسموح",
      nationalId: `ENFB${suffix.toString().slice(-8)}`,
      jobTitleEn: "Tester", jobTitleAr: "مختبر",
      departmentId: 1, roleId: 1,
      status: "active", employmentType: "full_time",
      email: `enf-auth-${suffix}@test.example`,
      hireDate: "2024-01-01", nationality: "SA",
      organizationType: "commercial",
    });
    expect(res.status).toBe(201);
    createdEmployeeIds.push(res.body.id);
  });

  it("after logout, the same agent is anonymous again → 401", async () => {
    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    const res = await agent.get("/api/employees");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });
});
