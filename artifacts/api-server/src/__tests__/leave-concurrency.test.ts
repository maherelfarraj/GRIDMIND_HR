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

  for (let i = 0; i < 2; i++) {
    const [req] = await db.insert(leaveRequestsTable).values({
      requestNumber: `${UNIQ}-${i}`,
      employeeId, leaveTypeId,
      startDate: `${YEAR}-12-2${i}`, endDate: `${YEAR}-12-2${i}`,
      totalDays: "1",
      status: "under_review",
      currentStepNumber: 1,
      totalApprovalSteps: 1,
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
});
