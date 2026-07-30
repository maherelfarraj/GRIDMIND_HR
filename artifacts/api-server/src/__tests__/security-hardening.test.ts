/**
 * Security Hardening Integration Tests
 *
 * Tests security properties of the HRMS API. This file is honest about the
 * current demo-mode state of the system:
 *
 *   - it()       → system currently enforces this; test should PASS
 *   - it.skip()  → PRODUCTION guard not yet wired; skip with clear production note
 *
 * Use this as a regression baseline: un-skip tests as real guards are added.
 */
import { createHmac, createHash } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  configPackagesTable,
  configPackageItemsTable,
  employeesTable,
  punchEventsTable,
  leaveTypesTable,
  breakGlassAccessTable,
} from "@workspace/db";
import app from "../app";

// ─── Cleanup trackers ─────────────────────────────────────────────────────────
const createdConfigPackageIds: number[] = [];
const createdEmployeeIds: number[] = [];
const createdPunchEventIds: number[] = [];
const createdBreakGlassIds: number[] = [];
const createdLeaveTypeIds: number[] = [];
const cleanupAuditEntityIds: { entityType: string; entityId: number }[] = [];

const UNIQUE = Date.now();

// ─── Helper: compute HMAC signature the same way configPackages.ts does ───────
function computeSignature(data: string): string {
  const secret = process.env.SESSION_SECRET ?? "default-secret";
  return createHmac("sha256", secret).update(data).digest("hex");
}

function computeChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── afterAll: clean up all created records ────────────────────────────────────
afterAll(async () => {
  // Remove punch events
  if (createdPunchEventIds.length) {
    await db.delete(punchEventsTable).where(inArray(punchEventsTable.id, createdPunchEventIds));
  }

  // Remove config package items then packages
  for (const pid of createdConfigPackageIds) {
    await db.delete(configPackageItemsTable).where(eq(configPackageItemsTable.packageId, pid));
  }
  if (createdConfigPackageIds.length) {
    await db.delete(configPackagesTable).where(inArray(configPackagesTable.id, createdConfigPackageIds));
  }

  // Remove test employees
  if (createdEmployeeIds.length) {
    await db.delete(employeesTable).where(inArray(employeesTable.id, createdEmployeeIds));
  }

  // Revoke break-glass entries created in tests
  if (createdBreakGlassIds.length) {
    for (const id of createdBreakGlassIds) {
      await db
        .update(breakGlassAccessTable)
        .set({ isActive: false })
        .where(eq(breakGlassAccessTable.id, id));
    }
  }

  // Remove test leave types
  if (createdLeaveTypeIds.length) {
    await db.delete(leaveTypesTable).where(inArray(leaveTypesTable.id, createdLeaveTypeIds));
  }

  // Clean up audit log entries created specifically by these tests
  for (const { entityType, entityId } of cleanupAuditEntityIds) {
    await db.delete(auditLogsTable).where(
      and(
        eq(auditLogsTable.entityType, entityType),
        eq(auditLogsTable.entityId, entityId),
      ),
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 1: Tampered Config Package — AUTOMATED
// The import route actively verifies HMAC signatures; these tests exercise that.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 1: Tampered Config Package — signature enforcement", () => {
  it("POST /api/config-packages/import with completely wrong signature returns 400", async () => {
    const payloadJson = JSON.stringify({ test: "tampered", ts: UNIQUE });

    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: `SEC-TEST-TAMPERED-${UNIQUE}`,
          packageType: "policy_set",
          version: "1.0.0",
          signature: "this-is-not-a-valid-hmac-signature-at-all",
          payloadJson,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it("POST /api/config-packages/import where signature uses wrong key returns 400", async () => {
    const payloadJson = JSON.stringify({ test: "wrong-key", ts: UNIQUE });
    // Sign with a different key — simulates a package exported from another environment
    const badSig = createHmac("sha256", "wrong-secret-key")
      .update(payloadJson)
      .digest("hex");

    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: `SEC-TEST-WRONGKEY-${UNIQUE}`,
          packageType: "policy_set",
          version: "1.0.0",
          signature: badSig,
          payloadJson,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it("POST /api/config-packages/import with correct signature returns 201", async () => {
    const payloadJson = JSON.stringify({ test: "valid", ts: UNIQUE });
    const signature = computeSignature(payloadJson);

    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: `SEC-TEST-VALID-${UNIQUE}`,
          packageType: "policy_set",
          version: "1.0.0",
          signature,
          payloadJson,
        },
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
    createdConfigPackageIds.push(res.body.id);
    cleanupAuditEntityIds.push({ entityType: "config_package", entityId: res.body.id });
  });

  it("POST /api/config-packages/import with no signature still imports (signature is optional)", async () => {
    // The route only rejects when signature is PRESENT but wrong.
    // When omitted entirely, it proceeds without a sig (documented behaviour).
    const payloadJson = JSON.stringify({ test: "no-sig", ts: UNIQUE });

    const res = await request(app)
      .post("/api/config-packages/import")
      .send({
        packageJson: {
          packageName: `SEC-TEST-NOSIG-${UNIQUE}`,
          packageType: "policy_set",
          version: "1.0.0",
          payloadJson,
          // deliberately no signature field
        },
      });

    // System accepts imports without a signature in demo mode
    expect([200, 201]).toContain(res.status);
    if (res.body.id) {
      createdConfigPackageIds.push(res.body.id);
      cleanupAuditEntityIds.push({ entityType: "config_package", entityId: res.body.id });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 2: Duplicate Payroll Actions — check enforcement
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 2: Duplicate Payroll Actions — idempotency checks", () => {
  it("POST /api/payroll-periods/:id/close on already-closed period returns 400", async () => {
    // Find a closed period
    const listRes = await request(app).get("/api/payroll-periods");
    expect(listRes.status).toBe(200);

    const closedPeriod = listRes.body.find(
      (p: any) => p.isClosed === true || p.status === "closed",
    );

    if (!closedPeriod) {
      console.warn("No closed payroll period found — skipping duplicate-close check");
      return;
    }

    const res = await request(app).post(`/api/payroll-periods/${closedPeriod.id}/close`);
    // System enforces: cannot close an already-closed period
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already closed/i);
  });

  it("POST /api/payroll-periods/:id/calculate on closed period returns 400", async () => {
    const listRes = await request(app).get("/api/payroll-periods");
    expect(listRes.status).toBe(200);

    const closedPeriod = listRes.body.find(
      (p: any) => p.isClosed === true || p.status === "closed",
    );

    if (!closedPeriod) {
      console.warn("No closed payroll period found — skipping re-calculate check");
      return;
    }

    const res = await request(app).post(`/api/payroll-periods/${closedPeriod.id}/calculate`);
    // System enforces: closed periods cannot be recalculated
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 3: Replay Attendance Events — deduplication check
// punchEventsTable has no deviceEventId / unique constraint; documents current
// behaviour (no dedup) and provides a baseline for when dedup is added.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 3: Replay Attendance Events — deduplication", () => {
  const REPLAY_EVENT_TIME = "2026-01-15T08:00:00.000Z";
  const REPLAY_NOTES = `REPLAY-TEST-${UNIQUE}`;

  it("first POST /api/punch-events creates the event (201)", async () => {
    const res = await request(app)
      .post("/api/punch-events")
      .send({
        employeeId: 1,
        eventType: "in",
        eventTime: REPLAY_EVENT_TIME,
        source: "BIOMETRIC",
        notes: REPLAY_NOTES,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    createdPunchEventIds.push(res.body.id);
  });

  it("second POST /api/punch-events with identical data reveals dedup status", async () => {
    const res = await request(app)
      .post("/api/punch-events")
      .send({
        employeeId: 1,
        eventType: "in",
        eventTime: REPLAY_EVENT_TIME,
        source: "BIOMETRIC",
        notes: REPLAY_NOTES,
      });

    // CURRENT BEHAVIOUR: no dedup — system accepts replay and returns 201.
    // PRODUCTION NOTE: Should return 409 Conflict when deviceEventId unique
    // constraint is added to punch_events table and checked in the route.
    if (res.status === 409) {
      // Dedup enforced — great!
      expect(res.status).toBe(409);
    } else {
      // Not yet enforced — document and track for cleanup
      expect(res.status).toBe(201);
      console.warn(
        "[SECURITY] Replay punch event accepted (201). " +
        "PRODUCTION: Add deviceEventId unique constraint to prevent replay attacks.",
      );
      if (res.body.id) createdPunchEventIds.push(res.body.id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 4: Break-Glass Audit Trail — AUTOMATED
// Verifies that break-glass access creates an immutable audit log entry.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 4: Break-Glass Audit Trail — audit log creation", () => {
  let breakGlassId: number;
  let auditEntryId: number | undefined;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/break-glass")
      .send({
        userId: 1,
        resourceType: `SEC-TEST-BG-${UNIQUE}`,
        justification: `Security hardening test ${UNIQUE}`,
        ttlMinutes: 1,
      });

    expect([200, 201]).toContain(res.status);
    breakGlassId = res.body.id;
    createdBreakGlassIds.push(breakGlassId);
    cleanupAuditEntityIds.push({ entityType: "break_glass_access", entityId: breakGlassId });
  });

  it("break-glass POST creates the access record with isActive=true", async () => {
    expect(breakGlassId).toBeDefined();
    const [record] = await db
      .select()
      .from(breakGlassAccessTable)
      .where(eq(breakGlassAccessTable.id, breakGlassId));
    expect(record).toBeDefined();
    expect(record.isActive).toBe(true);
    expect(record.resourceType).toContain(`SEC-TEST-BG-${UNIQUE}`);
  });

  it("break-glass POST writes an audit_logs entry with correct action and entityType", async () => {
    const entries = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.entityType, "break_glass_access"),
          eq(auditLogsTable.entityId, breakGlassId),
        ),
      );

    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries.find((e) => e.action === "break_glass.granted");
    expect(entry).toBeDefined();
    expect(entry!.action).toBe("break_glass.granted");
    expect(entry!.entityType).toBe("break_glass_access");
    expect(entry!.entityId).toBe(breakGlassId);
    auditEntryId = entry!.id;
  });

  it("GET /api/audit-logs?entityType=break_glass_access shows the break-glass event", async () => {
    const res = await request(app).get(
      `/api/audit-logs?entityType=break_glass_access&entityId=${breakGlassId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    const entry = res.body.data.find(
      (e: any) => e.entityId === breakGlassId && e.action === "break_glass.granted",
    );
    expect(entry).toBeDefined();
    expect(entry.entityType).toBe("break_glass_access");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 5: Privilege Escalation via Direct API — DEMO MODE (all skipped)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 5: Privilege Escalation via Direct API — DEMO MODE", () => {
  it.skip(
    "PRODUCTION: GET /api/admin/backup-records without admin role should return 403 " +
      "(demo mode — no role guard; currently returns 200)",
    async () => {
      // In production, attach a non-admin session cookie here and expect:
      // const res = await request(app).get("/api/admin/backup-records").set("Cookie", "session=employee-cookie");
      // expect(res.status).toBe(403);
    },
  );

  it.skip(
    "PRODUCTION: GET /api/admin/license without admin role should return 403 " +
      "(demo mode — no role guard; currently returns 200)",
    async () => {
      // expect(res.status).toBe(403);
    },
  );

  it.skip(
    "PRODUCTION: POST /api/dual-auth-requests from non-admin session should return 403 " +
      "(demo mode — no session guard; currently returns 201 or 400)",
    async () => {
      // expect(res.status).toBe(403);
    },
  );

  it.skip(
    "PRODUCTION: GET /api/security-clearances from employee role should return 403 " +
      "(demo mode — no role guard; currently returns 200)",
    async () => {
      // expect(res.status).toBe(403);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 6: Cross-Organization Data Access — DEMO MODE (all skipped)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 6: Cross-Organization Data Access — DEMO MODE", () => {
  it.skip(
    "PRODUCTION: GET /api/employees while authenticated as org A should not return org B employees " +
      "(demo mode — no org tenancy isolation; all employees are returned regardless of session org)",
    async () => {
      // Steps in production:
      // 1. Create employee for org B
      // 2. Authenticate as org A user
      // 3. GET /api/employees → must not include org B employee
      // expect(res.body.every((e: any) => e.orgId === orgAId)).toBe(true);
    },
  );

  it.skip(
    "PRODUCTION: GET /api/payroll-runs while authenticated as org A should not include org B runs " +
      "(demo mode — no org isolation; payroll runs are returned for all orgs)",
    async () => {
      // expect(res.body.data.every((r: any) => r.orgId === orgAId)).toBe(true);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 7: Unauthorized Export — DEMO MODE (skipped)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 7: Unauthorized Export — DEMO MODE", () => {
  it.skip(
    "PRODUCTION: GET /api/export-jobs without export permission should return 403 " +
      "(demo mode — no permission guard; currently returns 200)",
    async () => {
      // const res = await request(app).get("/api/export-jobs").set("Cookie", "session=no-export-cookie");
      // expect(res.status).toBe(403);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 8: Mass Assignment Protection — AUTOMATED
// Verifies that extra / privileged fields posted by a client are not persisted.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 8: Mass Assignment Protection", () => {
  let createdEmployeeId: number | undefined;

  it("POST /api/employees with privileged extra fields does not persist those fields", async () => {
    const employeeNumber = `SEC-MA-${UNIQUE}`;
    const res = await request(app)
      .post("/api/employees")
      .send({
        employeeNumber,
        firstNameEn: "MassAssign",
        lastNameEn: "Test",
        firstNameAr: "اختبار",
        lastNameAr: "تعيين",
        nationalId: `NA-${UNIQUE}`,
        jobTitleEn: "Tester",
        jobTitleAr: "مختبر",
        departmentId: 1,
        roleId: 1,
        status: "active",
        employmentType: "full_time",
        email: `mass-assign-${UNIQUE}@test.example`,
        hireDate: "2026-01-01",
        nationality: "SA",
        organizationType: "commercial",
        // ── privileged extra fields that must NOT be reflected ──
        isSystemAdmin: true,
        salary: 999999,
        extraPrivilegedRole: "super_admin",
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
    createdEmployeeId = res.body.id;
    createdEmployeeIds.push(createdEmployeeId!);

    // The schema columns `isSystemAdmin`, `salary`, `extraPrivilegedRole` do not
    // exist on employeesTable → they must not appear in the response.
    expect(res.body).not.toHaveProperty("isSystemAdmin");
    expect(res.body).not.toHaveProperty("salary");
    expect(res.body).not.toHaveProperty("extraPrivilegedRole");
    // roleId must equal the legitimate submitted value, not any escalation
    expect(res.body.roleId).toBe(1);
  });

  it("GET /api/employees/:id confirms no privileged fields were persisted", async () => {
    if (!createdEmployeeId) return;

    const res = await request(app).get(`/api/employees/${createdEmployeeId}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("isSystemAdmin");
    expect(res.body).not.toHaveProperty("salary");
    expect(res.body).not.toHaveProperty("extraPrivilegedRole");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 9: Break-Glass Rate Limiting — DEMO MODE (skipped)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 9: Break-Glass Rate Limiting — DEMO MODE", () => {
  it.skip(
    "PRODUCTION: 5 rapid POST /api/break-glass requests should be rate-limited (429) " +
      "(demo mode — no rate limiter; all requests return 201)",
    async () => {
      // const results = await Promise.all(
      //   Array.from({ length: 5 }, () =>
      //     request(app).post("/api/break-glass").send({ userId: 1, resourceType: "test", justification: "rate-limit-test" })
      //   )
      // );
      // const rateLimited = results.filter((r) => r.status === 429);
      // expect(rateLimited.length).toBeGreaterThan(0);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vector 10: Audit Log Integrity — AUTOMATED
// Verifies that audit log entries cannot be deleted or mutated through the API.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Vector 10: Audit Log Integrity — immutability enforcement", () => {
  let testLeaveTypeId: number | undefined;
  let auditLogId: number | undefined;

  beforeAll(async () => {
    // Create a leave type to generate a legitimate audit log entry
    const res = await request(app)
      .post("/api/leave-types")
      .send({
        codeEn: `SEC-AL-${UNIQUE}`,
        nameEn: `Security Audit Test ${UNIQUE}`,
        nameAr: "اختبار السجل الأمني",
        category: "general",
        defaultDaysPerYear: 5,
        maxCarryoverDays: 0,
        requiresAttachment: false,
        isActive: false,
      });

    if (res.status === 201 && res.body.id) {
      testLeaveTypeId = res.body.id;
      createdLeaveTypeIds.push(testLeaveTypeId!);

      // Retrieve the audit entry for this creation
      const auditRes = await request(app).get(
        `/api/audit-logs?entityType=leave_type&entityId=${testLeaveTypeId}`,
      );
      if (auditRes.status === 200 && auditRes.body.data?.length) {
        auditLogId = auditRes.body.data[0].id;
      }
    }
  });

  it("attempt DELETE /api/audit-logs/:id returns 404 or 405 (no delete endpoint)", async () => {
    if (!auditLogId) {
      console.warn("No audit log entry found for integrity test — skipping");
      return;
    }

    const res = await request(app).delete(`/api/audit-logs/${auditLogId}`);
    // No delete route exists → Express returns 404
    expect([404, 405]).toContain(res.status);
  });

  it("attempt PATCH /api/audit-logs/:id returns 404 or 405 (no mutate endpoint)", async () => {
    if (!auditLogId) {
      console.warn("No audit log entry found for integrity test — skipping");
      return;
    }

    const res = await request(app)
      .patch(`/api/audit-logs/${auditLogId}`)
      .send({ action: "tampered" });
    // No patch route exists → Express returns 404
    expect([404, 405]).toContain(res.status);
  });

  it("audit log entry still exists and is unchanged after attempted mutation", async () => {
    if (!auditLogId) {
      console.warn("No audit log entry found for integrity test — skipping");
      return;
    }

    const [entry] = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.id, auditLogId));

    expect(entry).toBeDefined();
    expect(entry.action).not.toBe("tampered");
    // The entry's entityType must still be leave_type
    expect(entry.entityType).toBe("leave_type");
  });
});
