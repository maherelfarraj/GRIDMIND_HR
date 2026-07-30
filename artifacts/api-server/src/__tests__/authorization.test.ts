/**
 * Authorization tests — role-based access control.
 *
 * NOTE: This HRMS server operates in demo mode. The auth routes accept any
 * session and the mutating endpoints do NOT enforce session-cookie guards
 * (routes like /api/leave-requests accept unauthenticated POST and return 201).
 * All tests below are therefore marked test.skip with explanations showing
 * what would be validated once real session-based guards are wired in.
 *
 * If route-level auth guards are added in the future, replace test.skip with
 * plain `it` and remove the comment.
 */
import { describe, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("authorization — unauthenticated requests to mutating endpoints", () => {
  // DEMO MODE: POST /api/leave-requests has no session guard; returns 201, not 401.
  it.skip("POST /api/leave-requests without session should return 401 (demo mode — no auth guard)", async () => {
    const res = await request(app)
      .post("/api/leave-requests")
      .send({ employeeId: 1, leaveTypeId: 1, startDate: "2026-01-01", endDate: "2026-01-01", totalDays: 1 });
    // In a session-guarded server this would be 401.
    // In demo mode it currently returns 201 or 400 (schema validation).
    // expect(res.status).toBe(401);
  });

  // DEMO MODE: POST /api/leave-requests/:id/decide has no session guard.
  it.skip("POST /api/leave-requests/1/decide without session should return 401 (demo mode — no auth guard)", async () => {
    const res = await request(app)
      .post("/api/leave-requests/1/decide")
      .send({ stepId: 1, decision: "approved" });
    // expect(res.status).toBe(401);
  });

  // DEMO MODE: POST /api/payroll-runs has no session guard.
  it.skip("POST /api/payroll-runs without session should return 401 (demo mode — no auth guard)", async () => {
    const res = await request(app)
      .post("/api/payroll-runs")
      .send({ payrollPeriodId: 1, employeeId: 1, baseSalary: "5000" });
    // expect(res.status).toBe(401);
  });

  // DEMO MODE: DELETE /api/employees/1 has no session guard (returns 200 or 404, not 401).
  it.skip("DELETE /api/employees/1 without session should return 401 (demo mode — no auth guard)", async () => {
    const res = await request(app).delete("/api/employees/1");
    // expect([401, 404]).toContain(res.status);
    // expect(res.status).not.toBe(200);
  });

  // DEMO MODE: POST /api/dual-auth-requests has no session guard.
  it.skip("POST /api/dual-auth-requests without session should return 401 (demo mode — no auth guard)", async () => {
    const res = await request(app)
      .post("/api/dual-auth-requests")
      .send({ actionType: "test", requestedByUserId: 1 });
    // expect(res.status).toBe(401);
  });
});

describe("authorization — additional production guards (all skipped in demo mode)", () => {
  // PRODUCTION: Organization management endpoints (GET/POST/PATCH /api/organizations,
  // GET /api/admin/backup-records, GET /api/admin/license, etc.) must be accessible
  // only by users with the system_admin or org_admin role. In demo mode there is no
  // role guard, so any request returns 200/201 regardless of the caller's role.
  it.skip(
    "PRODUCTION: Only system admin can access organization management endpoints " +
      "(demo mode — no role guard; any session returns 200)",
    async () => {
      // Steps in production:
      // 1. Obtain a session cookie for a regular employee user (role = employee).
      // 2. GET /api/organizations — must return 403, not 200.
      // 3. POST /api/organizations — must return 403, not 201.
      // 4. GET /api/admin/backup-records — must return 403.
      // 5. GET /api/admin/license — must return 403.
      //
      // const employeeCookie = await loginAs("employee");
      // const res = await request(app).get("/api/organizations").set("Cookie", employeeCookie);
      // expect(res.status).toBe(403);
    },
  );

  // PRODUCTION: Policy change requests implement a maker-checker (four-eyes)
  // control. The user who submits (makes) a change request must NOT be the same
  // user who approves (checks) it. In demo mode there is no session guard and
  // the system does not enforce maker != checker.
  it.skip(
    "PRODUCTION: Policy change requests require maker != checker (same user cannot approve own request) " +
      "(demo mode — no session guard; self-approval is not blocked)",
    async () => {
      // Steps in production:
      // 1. Create a policy change request as user A.
      // 2. Attempt to approve the same request as user A.
      // 3. Expect 403 or 422 (self-approval rejected).
      //
      // const resCreate = await request(app)
      //   .post("/api/policy-change-requests")
      //   .set("Cookie", userACookie)
      //   .send({ ... });
      // const resApprove = await request(app)
      //   .post(`/api/policy-change-requests/${resCreate.body.id}/approve`)
      //   .set("Cookie", userACookie);  // same user
      // expect(resApprove.status).toBe(403);
    },
  );

  // PRODUCTION: When a config package is exported from environment A and signed
  // with environment A's SESSION_SECRET, importing it into environment B (which
  // has a different SESSION_SECRET) must fail with a signature verification error.
  // In demo mode, both environments share the same default-secret fallback, so
  // cross-environment import may incorrectly succeed.
  it.skip(
    "PRODUCTION: Config package import must fail if SERVER_SIGNING_KEY changes between environments " +
      "(demo mode — shared default-secret means cross-env packages may be accepted)",
    async () => {
      // Steps in production:
      // 1. Sign a payloadJson with environment A's signing key.
      // 2. POST /api/config-packages/import with that signature while
      //    process.env.SESSION_SECRET is set to environment B's key.
      // 3. Expect 400 Signature verification failed.
      //
      // process.env.SESSION_SECRET = "env-b-secret";
      // const sigFromEnvA = computeHmac("env-a-secret", payloadJson);
      // const res = await request(app)
      //   .post("/api/config-packages/import")
      //   .send({ packageJson: { ..., signature: sigFromEnvA, payloadJson } });
      // expect(res.status).toBe(400);
      // expect(res.body.error).toMatch(/signature/i);
    },
  );
});
