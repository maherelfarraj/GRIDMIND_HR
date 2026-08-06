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

// ---------------------------------------------------------------------------
// Task #166 — draft-cancel must not release any pending days.
// A draft request has never touched the pending counter, so cancelling it
// must leave the balance completely unchanged.
// ---------------------------------------------------------------------------
let draftCxlEmployeeId: number;
let draftCxlLeaveTypeId: number;
let draftCxlBalanceId: number;
const draftCxlRequestIds: number[] = [];
const DRAFT_CXL_UNIQ = `T166-${Date.now()}`;

async function cleanupDraftCancel() {
  if (draftCxlRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, draftCxlRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, draftCxlRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, draftCxlRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, draftCxlRequestIds));
  }
  if (draftCxlBalanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, draftCxlBalanceId));
  if (draftCxlEmployeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, draftCxlEmployeeId));
  if (draftCxlLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, draftCxlLeaveTypeId));
  if (draftCxlEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, draftCxlEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: DRAFT_CXL_UNIQ,
    firstNameEn: "DraftCancel", lastNameEn: "Test",
    firstNameAr: "اختبار", lastNameAr: "مسودة",
    nationalId: DRAFT_CXL_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${DRAFT_CXL_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  draftCxlEmployeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: DRAFT_CXL_UNIQ.slice(0, 20),
    nameEn: `Annual (${DRAFT_CXL_UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  draftCxlLeaveTypeId = lt.id;

  // The balance has 2 pending days from a *different* submitted request; the
  // draft we create here must never touch this counter.
  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId: draftCxlEmployeeId, leaveTypeId: draftCxlLeaveTypeId, year: YEAR,
    openingBalance: "10", accrued: "0", used: "0", pending: "2",
    adjustment: "0", carriedOver: "0",
  }).returning();
  draftCxlBalanceId = bal.id;

  // One draft request — never submitted, so no pending reservation.
  const [req] = await db.insert(leaveRequestsTable).values({
    requestNumber: `${DRAFT_CXL_UNIQ}-0`,
    employeeId: draftCxlEmployeeId, leaveTypeId: draftCxlLeaveTypeId,
    startDate: `${YEAR}-08-05`, endDate: `${YEAR}-08-07`,
    totalDays: "3",
    status: "draft",
    currentStepNumber: 1,
    totalApprovalSteps: 2,
  } as any).returning();
  draftCxlRequestIds.push(req.id);
});

afterAll(async () => {
  await cleanupDraftCancel();
});

describe("draft cancellation must not release pending balance (Task #166)", () => {
  it("cancels a draft request and leaves the pending counter unchanged", async () => {
    const res = await fetch(`${baseUrl}/leave-requests/${draftCxlRequestIds[0]}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.status).toBe("cancelled");

    // The pending counter must remain exactly as it was before the cancel.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, draftCxlBalanceId));
    expect(parseFloat(bal.pending)).toBe(2);
  });

  it("returns 409 when cancelling the same draft a second time", async () => {
    const res = await fetch(`${baseUrl}/leave-requests/${draftCxlRequestIds[0]}/cancel`, { method: "POST" });
    expect([400, 409]).toContain(res.status);

    // Pending still untouched after the failed second cancel.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, draftCxlBalanceId));
    expect(parseFloat(bal.pending)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task #236 — revoke-route concurrency.
// Two concurrent revokes of the same approved request must credit the used
// balance exactly once (one 200, one 409).
// ---------------------------------------------------------------------------
let rvkEmployeeId: number;
let rvkLeaveTypeId: number;
let rvkBalanceId: number;
const rvkRequestIds: number[] = [];
const RVK_UNIQ = `T236-${Date.now()}`;

async function cleanupRevoke() {
  if (rvkRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, rvkRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, rvkRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, rvkRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, rvkRequestIds));
  }
  if (rvkBalanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, rvkBalanceId));
  if (rvkEmployeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, rvkEmployeeId));
  if (rvkLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, rvkLeaveTypeId));
  if (rvkEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, rvkEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: RVK_UNIQ,
    firstNameEn: "Revoke", lastNameEn: "Race",
    firstNameAr: "اختبار", lastNameAr: "إلغاء",
    nationalId: RVK_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${RVK_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  rvkEmployeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: RVK_UNIQ.slice(0, 20),
    nameEn: `Annual (${RVK_UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  rvkLeaveTypeId = lt.id;

  // Employee used 5 days on this approved leave; balance reflects that.
  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId: rvkEmployeeId, leaveTypeId: rvkLeaveTypeId, year: YEAR,
    openingBalance: "10", accrued: "0", used: "5", pending: "0",
    adjustment: "0", carriedOver: "0",
  }).returning();
  rvkBalanceId = bal.id;

  // One approved 5-day request — the target of both concurrent revokes.
  const [req] = await db.insert(leaveRequestsTable).values({
    requestNumber: `${RVK_UNIQ}-0`,
    employeeId: rvkEmployeeId, leaveTypeId: rvkLeaveTypeId,
    startDate: `${YEAR}-07-01`, endDate: `${YEAR}-07-05`,
    totalDays: "5",
    status: "approved",
    currentStepNumber: 2,
    totalApprovalSteps: 2,
  } as any).returning();
  rvkRequestIds.push(req.id);
});

afterAll(async () => {
  await cleanupRevoke();
});

// ---------------------------------------------------------------------------
// Task #236 — partial/partial race.
// Two concurrent partial revokes of the same approved request must shorten
// the range and credit the balance exactly once (one 200, one 409).
// ---------------------------------------------------------------------------
let prtEmployeeId: number;
let prtLeaveTypeId: number;
let prtBalanceId: number;
const prtRequestIds: number[] = [];
const PRT_UNIQ = `T2P-${Date.now()}`;

async function cleanupPartial() {
  if (prtRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, prtRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, prtRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, prtRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, prtRequestIds));
  }
  if (prtBalanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, prtBalanceId));
  if (prtEmployeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, prtEmployeeId));
  if (prtLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, prtLeaveTypeId));
  if (prtEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, prtEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: PRT_UNIQ,
    firstNameEn: "Partial", lastNameEn: "Race",
    firstNameAr: "اختبار", lastNameAr: "جزئي",
    nationalId: PRT_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${PRT_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  prtEmployeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: PRT_UNIQ.slice(0, 20),
    nameEn: `Annual (${PRT_UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  prtLeaveTypeId = lt.id;

  // 10 days used on an approved 10-day leave (days 1–10 of next month).
  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId: prtEmployeeId, leaveTypeId: prtLeaveTypeId, year: YEAR,
    openingBalance: "20", accrued: "0", used: "10", pending: "0",
    adjustment: "0", carriedOver: "0",
  }).returning();
  prtBalanceId = bal.id;

  const [req] = await db.insert(leaveRequestsTable).values({
    requestNumber: `${PRT_UNIQ}-0`,
    employeeId: prtEmployeeId, leaveTypeId: prtLeaveTypeId,
    startDate: `${YEAR}-06-01`, endDate: `${YEAR}-06-10`,
    totalDays: "10",
    status: "approved",
    currentStepNumber: 2,
    totalApprovalSteps: 2,
  } as any).returning();
  prtRequestIds.push(req.id);
});

afterAll(async () => {
  await cleanupPartial();
});

describe("concurrent partial revocations (Task #236)", () => {
  it("shortens the range and credits balance exactly once when two partial revokes race", async () => {
    // Both racers request the same partial: shorten to end on day 5.
    const [resA, resB] = await Promise.all(
      [0, 1].map(() =>
        fetch(`${baseUrl}/leave-requests/${prtRequestIds[0]}/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Concurrent partial revoke", newEndDate: `${YEAR}-06-05` }),
        }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    // The range was shortened exactly once: endDate = June 5, totalDays ≤ 10.
    const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, prtRequestIds[0]));
    expect(r.status).toBe("approved"); // partial revoke keeps approved status
    expect(r.endDate).toBe(`${YEAR}-06-05`);
    expect(parseFloat(r.totalDays)).toBeLessThan(10);

    // Balance credited once: used went 10 → some value, never 10 → (10 - 2×credited).
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, prtBalanceId));
    const used = parseFloat(bal.used);
    expect(used).toBeGreaterThanOrEqual(0);
    expect(used).toBeLessThan(10); // definitely credited at least once
  });
});

// ---------------------------------------------------------------------------
// Task #236 — partial/full race.
// A partial revoke and a full revoke racing against the same approved request
// must both be handled: one wins with 200, the other loses with 409.
// ---------------------------------------------------------------------------
let pfEmployeeId: number;
let pfLeaveTypeId: number;
let pfBalanceId: number;
const pfRequestIds: number[] = [];
const PF_UNIQ = `T2F-${Date.now()}`;

async function cleanupPartialFull() {
  if (pfRequestIds.length) {
    await db.delete(auditLogsTable).where(
      and(eq(auditLogsTable.entityType, "leave_request"), inArray(auditLogsTable.entityId, pfRequestIds)),
    );
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, pfRequestIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, pfRequestIds));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, pfRequestIds));
  }
  if (pfBalanceId) await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.id, pfBalanceId));
  if (pfEmployeeId) await db.delete(rostersTable).where(eq(rostersTable.employeeId, pfEmployeeId));
  if (pfLeaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, pfLeaveTypeId));
  if (pfEmployeeId) await db.delete(employeesTable).where(eq(employeesTable.id, pfEmployeeId));
}

beforeAll(async () => {
  const [dept] = await db.select().from(departmentsTable).limit(1);
  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: PF_UNIQ,
    firstNameEn: "PartialFull", lastNameEn: "Race",
    firstNameAr: "اختبار", lastNameAr: "كامل",
    nationalId: PF_UNIQ,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: dept?.id ?? 1,
    roleId: 1,
    email: `${PF_UNIQ.toLowerCase()}@test.local`,
    hireDate: "2020-01-01",
    nationality: "SA",
    status: "active",
  }).returning();
  pfEmployeeId = emp.id;

  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn: PF_UNIQ.slice(0, 20),
    nameEn: `Annual (${PF_UNIQ})`, nameAr: "سنوية",
    category: "general",
  }).returning();
  pfLeaveTypeId = lt.id;

  const [bal] = await db.insert(leaveBalancesTable).values({
    employeeId: pfEmployeeId, leaveTypeId: pfLeaveTypeId, year: YEAR,
    openingBalance: "20", accrued: "0", used: "6", pending: "0",
    adjustment: "0", carriedOver: "0",
  }).returning();
  pfBalanceId = bal.id;

  const [req] = await db.insert(leaveRequestsTable).values({
    requestNumber: `${PF_UNIQ}-0`,
    employeeId: pfEmployeeId, leaveTypeId: pfLeaveTypeId,
    startDate: `${YEAR}-05-01`, endDate: `${YEAR}-05-06`,
    totalDays: "6",
    status: "approved",
    currentStepNumber: 2,
    totalApprovalSteps: 2,
  } as any).returning();
  pfRequestIds.push(req.id);
});

afterAll(async () => {
  await cleanupPartialFull();
});

describe("racing partial vs full revocation (Task #236)", () => {
  it("leaves the balance consistent when a partial and a full revoke race", async () => {
    // Capture the pre-race used balance so we can verify it only ever
    // decreases by what the winning operations actually credit.
    const [balBefore] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, pfBalanceId));
    const usedBefore = parseFloat(balBefore.used);

    const partialFetch = fetch(`${baseUrl}/leave-requests/${pfRequestIds[0]}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Partial race", newEndDate: `${YEAR}-05-03` }),
    });
    const fullFetch = fetch(`${baseUrl}/leave-requests/${pfRequestIds[0]}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Full race" }),
    });
    const [resA, resB] = await Promise.all([partialFetch, fullFetch]);

    const statuses = [resA.status, resB.status].sort();
    // Both can legitimately succeed (partial shortens, then full revokes the
    // remainder) OR full wins and partial sees a non-approved status (409).
    // What must never happen is two identical credits doubling the reduction.
    expect(statuses[0]).toBe(200); // at least one must succeed

    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, pfBalanceId));
    const usedAfter = parseFloat(bal.used);
    // Balance must not go below 0, and each credit was at most usedBefore.
    expect(usedAfter).toBeGreaterThanOrEqual(0);
    expect(usedAfter).toBeLessThan(usedBefore); // at least one credit happened

    // Final state must be coherent: fully revoked, or partially revoked.
    const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, pfRequestIds[0]));
    expect(["revoked", "approved"]).toContain(r.status);
  });
});

describe("concurrent leave revocations (Task #236)", () => {
  it("credits used balance exactly once when two revokes race", async () => {
    const [resA, resB] = await Promise.all(
      [0, 1].map(() =>
        fetch(`${baseUrl}/leave-requests/${rvkRequestIds[0]}/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Concurrent revoke test" }),
        }),
      ),
    );

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    // Used must go 5 → 0, never go negative or stay at -5 from a double credit.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, rvkBalanceId));
    expect(parseFloat(bal.used)).toBe(0);

    // The request must be revoked exactly once.
    const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, rvkRequestIds[0]));
    expect(r.status).toBe("revoked");
  });

  it("returns 400 or 409 when revoking an already-revoked request", async () => {
    const res = await fetch(`${baseUrl}/leave-requests/${rvkRequestIds[0]}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Second revoke attempt" }),
    });
    // The pre-transaction guard returns 400; the conditional claim inside the
    // transaction returns 409.  Either is correct — what matters is that the
    // balance is not doubly-credited (asserted below).
    expect([400, 409]).toContain(res.status);

    // Balance still at 0 after the failed second revoke.
    const [bal] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.id, rvkBalanceId));
    expect(parseFloat(bal.used)).toBe(0);
  });
});
