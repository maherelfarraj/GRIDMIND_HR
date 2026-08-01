/**
 * Task #18 — Leave approval concurrency test.
 *
 * Verifies that two concurrent HTTP approvals competing for an employee's
 * last available leave day result in exactly one success and one 409,
 * thanks to the SELECT ... FOR UPDATE row lock in the decide route.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool,
  employeesTable, departmentsTable, leaveTypesTable, leaveBalancesTable,
  leaveRequestsTable, leaveApprovalStepsTable, leaveAttachmentsTable, auditLogsTable,
  rostersTable,
} from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;

let employeeId: number;
let leaveTypeId: number;
let balanceId: number;
const requestIds: number[] = [];
const stepIds: number[] = [];

const YEAR = new Date().getFullYear();
const UNIQ = `T18-${Date.now()}`;

async function cleanup() {
  if (requestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, requestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, requestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, requestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, requestIds));
  }
  if (balanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, balanceId));
  // Approval marks roster rows for the employee; remove them before deleting the employee
  if (employeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, employeeId));
  if (leaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, leaveTypeId));
  if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
}

beforeAll(async () => {
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;

  // Fixtures: one employee with exactly ONE available day, and two
  // 1-day requests already pending final approval.
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: UNIQ,
    firstNameEn: "Concurrency", lastNameEn: "Test",
    firstNameAr: "اختبار", lastNameAr: "تزامن",
    nationalId: UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  employeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: UNIQ.slice(0, 20),
    nameEn: `Annual (${UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  leaveTypeId = lt.id;

  // Entitlement 10, used 9 → exactly 1 day left. Both requests hold a
  // pending reservation (2 total) — the race the lock must resolve.
  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId, leaveTypeId, year: YEAR,
    openingBalance: "10", accrued: "0", used: "9", pending: "2",
    adjustment: "0", carriedOver: "0",
  }).returning();
  balanceId = bal.id;

  // Requests 0 and 1: single-step, race for the last available day.
  // Request 2: two-step, used to verify the same step can't be decided twice.
  for (let i = 0; i < 3; i++) {
    const [req] = await db.insert(leaveRequestsTable).values({
      requestNumber: `${UNIQ}-${i}`,
      employeeId, leaveTypeId,
      startDate: `${YEAR}-12-2${i}`, endDate: `${YEAR}-12-2${i}`,
      totalDays: "1",
      status: "under_review",
      currentStepNumber: 1,
      totalApprovalSteps: i === 2 ? 2 : 1,
    } as any).returning();
    requestIds.push(req.id);
    const [step] = await db.insert(leaveApprovalStepsTable).values({
      leaveRequestId: req.id, stepNumber: 1, roleRequired: "hr_director", status: "pending",
    }).returning();
    stepIds.push(step.id);
  }
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("concurrent leave approvals", () => {
  it("allows exactly one approval when two race for the last available day", async () => {
    const [resA, resB] = await Promise.all(
      [0, 1].map((i) =>
        fetch(`${baseUrl}/leave-requests/${requestIds[i]}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId: stepIds[i], decision: "approved" }),
        }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);

    // Balance must not be overdrawn: used goes 9 → 10, never 11.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, balanceId));
    expect(parseFloat(bal.used)).toBe(10);

    // Exactly one request approved.
    const rows = await db.select().from(leaveRequestsTable).where(inArray(leaveRequestsTable.id, requestIds));
    expect(rows.filter((r) => r.status === "approved")).toHaveLength(1);
  });

  it("rejects a second decision on the same approval step (double-click)", async () => {
    const [resA, resB] = await Promise.all(
      [0, 1].map(() =>
        fetch(`${baseUrl}/leave-requests/${requestIds[2]}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId: stepIds[2], decision: "approved" }),
        }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    // The step was decided exactly once and the request advanced one step.
    const [step] = await db.select().from(leaveApprovalStepsTable)
      .where(eq(leaveApprovalStepsTable.id, stepIds[2]));
    expect(step.status).toBe("approved");
    const [r] = await db.select().from(leaveRequestsTable)
      .where(eq(leaveRequestsTable.id, requestIds[2]));
    expect(r.status).toBe("under_review");
    expect(r.currentStepNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task #19 — submit-route concurrency.
// Two DRAFT requests race to reserve the employee's last available day via
// POST /submit; the row-locked transaction must let exactly one through.
// ---------------------------------------------------------------------------
let subEmployeeId: number;
let subLeaveTypeId: number;
let subBalanceId: number;
const subRequestIds: number[] = [];
const SUB_UNIQ = `T19-${Date.now()}`;

async function cleanupSubmit() {
  if (subRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, subRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, subRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, subRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, subRequestIds));
  }
  if (subBalanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, subBalanceId));
  if (subEmployeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, subEmployeeId));
  if (subLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, subLeaveTypeId));
  if (subEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, subEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: SUB_UNIQ,
    firstNameEn: "Submit", lastNameEn: "Race",
    firstNameAr: "اختبار", lastNameAr: "تقديم",
    nationalId: SUB_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${SUB_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  subEmployeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: SUB_UNIQ.slice(0, 20),
    nameEn: `Annual (${SUB_UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  subLeaveTypeId = lt.id;

  // Entitlement 10, used 9, nothing pending → exactly 1 day available.
  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId: subEmployeeId, leaveTypeId: subLeaveTypeId, year: YEAR,
    openingBalance: "10", accrued: "0", used: "9", pending: "0",
    adjustment: "0", carriedOver: "0",
  }).returning();
  subBalanceId = bal.id;

  for (let i = 0; i < 2; i++) {
    const [req] = await db.insert(leaveRequestsTable).values({
      requestNumber: `${SUB_UNIQ}-${i}`,
      employeeId: subEmployeeId, leaveTypeId: subLeaveTypeId,
      startDate: `${YEAR}-11-1${i}`, endDate: `${YEAR}-11-1${i}`,
      totalDays: "1",
      status: "draft",
      currentStepNumber: 1,
      totalApprovalSteps: 2,
    } as any).returning();
    subRequestIds.push(req.id);
  }
});

afterAll(async () => {
  await cleanupSubmit();
});

describe("concurrent leave submissions (Task #19)", () => {
  it("allows exactly one submission when two race to reserve the last available day", async () => {
    const [resA, resB] = await Promise.all(
      subRequestIds.map((rid) =>
        fetch(`${baseUrl}/leave-requests/${rid}/submit`, { method: "POST" }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(422);

    // Pending must never exceed the single available day.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, subBalanceId));
    expect(parseFloat(bal.pending)).toBe(1);

    // Exactly one request submitted; the other stays draft.
    const rows = await db.select().from(leaveRequestsTable).where(inArray(leaveRequestsTable.id, subRequestIds));
    expect(rows.filter((r) => r.status === "submitted")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "draft")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task #19 — auto-provisioning race: no balance row exists yet for the
// current year; two first-time submissions must not each create and reserve
// a separate balance row (unique constraint + insert-on-conflict).
// ---------------------------------------------------------------------------
let provEmployeeId: number;
let provLeaveTypeId: number;
const provRequestIds: number[] = [];
const PROV_UNIQ = `T19P-${Date.now()}`;

async function cleanupProvision() {
  if (provRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, provRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, provRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, provRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, provRequestIds));
  }
  if (provEmployeeId) {
    await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.employeeId, provEmployeeId));
    await db.delete(rostersTable).where(eq(rostersTable.employeeId, provEmployeeId));
  }
  if (provLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, provLeaveTypeId));
  if (provEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, provEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: PROV_UNIQ,
    firstNameEn: "Provision", lastNameEn: "Race",
    firstNameAr: "اختبار", lastNameAr: "توفير",
    nationalId: PROV_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${PROV_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  provEmployeeId = emp.id;

  // Leave type grants exactly 1 day/year; NO balance row is pre-created, so
  // both submissions trigger auto-provisioning concurrently.
  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: PROV_UNIQ.slice(0, 20),
    nameEn: `Annual (${PROV_UNIQ})`, nameAr: "سنوية",
    category: "general",
    defaultDaysPerYear: 1,
  } as any).returning();
  provLeaveTypeId = lt.id;

  for (let i = 0; i < 2; i++) {
    const [req] = await db.insert(leaveRequestsTable).values({
      requestNumber: `${PROV_UNIQ}-${i}`,
      employeeId: provEmployeeId, leaveTypeId: provLeaveTypeId,
      startDate: `${YEAR}-10-1${i}`, endDate: `${YEAR}-10-1${i}`,
      totalDays: "1",
      status: "draft",
      currentStepNumber: 1,
      totalApprovalSteps: 2,
    } as any).returning();
    provRequestIds.push(req.id);
  }
});

afterAll(async () => {
  await cleanupProvision();
});

// ---------------------------------------------------------------------------
// Task #179 — cancel-route concurrency.
// Two concurrent cancels of the same submitted request must release the
// pending reservation exactly once (one 200, one 409).
// ---------------------------------------------------------------------------
let cxlEmployeeId: number;
let cxlLeaveTypeId: number;
let cxlBalanceId: number;
const cxlRequestIds: number[] = [];
const CXL_UNIQ = `T179-${Date.now()}`;

async function cleanupCancel() {
  if (cxlRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, cxlRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, cxlRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, cxlRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, cxlRequestIds));
  }
  if (cxlBalanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, cxlBalanceId));
  if (cxlEmployeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, cxlEmployeeId));
  if (cxlLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, cxlLeaveTypeId));
  if (cxlEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, cxlEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: CXL_UNIQ,
    firstNameEn: "Cancel", lastNameEn: "Race",
    firstNameAr: "اختبار", lastNameAr: "إلغاء",
    nationalId: CXL_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${CXL_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  cxlEmployeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: CXL_UNIQ.slice(0, 20),
    nameEn: `Annual (${CXL_UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  cxlLeaveTypeId = lt.id;

  // One submitted 3-day request holding a pending reservation of 3.
  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId: cxlEmployeeId, leaveTypeId: cxlLeaveTypeId, year: YEAR,
    openingBalance: "10", accrued: "0", used: "0", pending: "3",
    adjustment: "0", carriedOver: "0",
  }).returning();
  cxlBalanceId = bal.id;

  const [req] = await db.insert(leaveRequestsTable).values({
    requestNumber: `${CXL_UNIQ}-0`,
    employeeId: cxlEmployeeId, leaveTypeId: cxlLeaveTypeId,
    startDate: `${YEAR}-09-10`, endDate: `${YEAR}-09-12`,
    totalDays: "3",
    status: "submitted",
    currentStepNumber: 1,
    totalApprovalSteps: 2,
  } as any).returning();
  cxlRequestIds.push(req.id);
});

afterAll(async () => {
  await cleanupCancel();
});

describe("concurrent leave cancellations (Task #179)", () => {
  it("releases the pending reservation exactly once when two cancels race", async () => {
    const [resA, resB] = await Promise.all(
      [0, 1].map(() =>
        fetch(`${baseUrl}/leave-requests/${cxlRequestIds[0]}/cancel`, { method: "POST" }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    // Pending released once: 3 → 0, never negative / double-released.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, cxlBalanceId));
    expect(parseFloat(bal.pending)).toBe(0);

    const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, cxlRequestIds[0]));
    expect(r.status).toBe("cancelled");
  });

  it("returns 409 when cancelling an already-cancelled request", async () => {
    const res = await fetch(`${baseUrl}/leave-requests/${cxlRequestIds[0]}/cancel`, { method: "POST" });
    // Pre-transaction status check catches it with 400, or the conditional claim with 409.
    expect([400, 409]).toContain(res.status);
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, cxlBalanceId));
    expect(parseFloat(bal.pending)).toBe(0);
  });
});

describe("concurrent first-time submissions with no existing balance row (Task #19)", () => {
  it("auto-provisions exactly one balance row and lets only one submission through", async () => {
    const [resA, resB] = await Promise.all(
      provRequestIds.map((rid) =>
        fetch(`${baseUrl}/leave-requests/${rid}/submit`, { method: "POST" }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(422);

    // Exactly one balance row exists for (employee, type, year), pending = 1.
    const bals = await db.select().from(leaveBalancesTable).where(
      and(
        eq(leaveBalancesTable.employeeId, provEmployeeId),
        eq(leaveBalancesTable.leaveTypeId, provLeaveTypeId),
        eq(leaveBalancesTable.year, YEAR),
      ),
    );
    expect(bals).toHaveLength(1);
    expect(parseFloat(bals[0].pending)).toBe(1);

    const rows = await db.select().from(leaveRequestsTable).where(inArray(leaveRequestsTable.id, provRequestIds));
    expect(rows.filter((r) => r.status === "submitted")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "draft")).toHaveLength(1);
  });
});
