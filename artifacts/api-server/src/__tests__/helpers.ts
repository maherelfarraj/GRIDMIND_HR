/**
 * Shared test helpers — create isolated fixtures (dedicated leave types and
 * balances) so tests never disturb the seeded demo data, and clean up after.
 */
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  leaveTypesTable,
  leaveBalancesTable,
  leaveRequestsTable,
  leaveApprovalStepsTable,
  leaveAttachmentsTable,
  rostersTable,
  auditLogsTable,
} from "@workspace/db";

export const TEST_YEAR = 2026;
export const TEST_EMPLOYEE_ID = 1;
export const TEST_EMPLOYEE_ID_2 = 2;
/** Org that test employees belong to. Pass as X-Org-Id header on all API calls.
 *  Employees were migrated from stale org_id=1 to org_id=16 (Ministry of Interior, the default org). */
export const TEST_ORG_ID = 16;

export interface TestFixtures {
  annualTypeId: number;
  sickTypeId: number;
  createdRequestIds: number[];
}

export async function createFixtures(): Promise<TestFixtures> {
  // Dedicated leave types so seeded balances/requests are untouched.
  const [annual] = await db.insert(leaveTypesTable).values({
    codeEn: `T-ANN-${Date.now() % 100000}`,
    nameEn: "TEST Annual",
    nameAr: "اختبار سنوي",
    category: "general",
    defaultDaysPerYear: 10,
    maxCarryoverDays: 5,
    requiresAttachment: false,
    isActive: false, // keep out of annual-reset sweeps by default
  }).returning();

  const [sick] = await db.insert(leaveTypesTable).values({
    codeEn: `T-SCK-${Date.now() % 100000}`,
    nameEn: "TEST Sick",
    nameAr: "اختبار مرضي",
    category: "sick",
    defaultDaysPerYear: 15,
    maxCarryoverDays: 0,
    requiresAttachment: true,
    isActive: false,
  }).returning();

  return { annualTypeId: annual.id, sickTypeId: sick.id, createdRequestIds: [] };
}

export async function setBalance(
  employeeId: number,
  leaveTypeId: number,
  year: number,
  opening: string,
) {
  await db.delete(leaveBalancesTable).where(and(
    eq(leaveBalancesTable.employeeId, employeeId),
    eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
    eq(leaveBalancesTable.year, year),
  ));
  const [b] = await db.insert(leaveBalancesTable).values({
    employeeId, leaveTypeId, year,
    openingBalance: opening, accrued: "0", used: "0",
    pending: "0", adjustment: "0", carriedOver: "0",
  }).returning();
  return b;
}

export async function getBalance(employeeId: number, leaveTypeId: number, year: number) {
  const [b] = await db.select().from(leaveBalancesTable).where(and(
    eq(leaveBalancesTable.employeeId, employeeId),
    eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
    eq(leaveBalancesTable.year, year),
  ));
  return b;
}

export async function findAuditEntries(action: string, entityId: number) {
  return db.select().from(auditLogsTable).where(and(
    eq(auditLogsTable.action, action),
    eq(auditLogsTable.entityId, entityId),
  ));
}

export async function cleanupFixtures(f: TestFixtures) {
  const typeIds = [f.annualTypeId, f.sickTypeId];
  // Requests created against test types (covers ones we lost track of)
  const requests = await db.select().from(leaveRequestsTable)
    .where(inArray(leaveRequestsTable.leaveTypeId, typeIds));
  const reqIds = [...new Set([...requests.map(r => r.id), ...f.createdRequestIds])];
  if (reqIds.length) {
    await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, reqIds));
    await db.delete(leaveAttachmentsTable).where(inArray(leaveAttachmentsTable.leaveRequestId, reqIds));
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "leave_request"),
      inArray(auditLogsTable.entityId, reqIds),
    ));
    await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, reqIds));
  }
  await db.delete(leaveBalancesTable).where(inArray(leaveBalancesTable.leaveTypeId, typeIds));
  await db.delete(leaveTypesTable).where(inArray(leaveTypesTable.id, typeIds));
}

export async function cleanupTestRosters(employeeId: number, notesMarker: string) {
  const rows = await db.select().from(rostersTable).where(eq(rostersTable.employeeId, employeeId));
  const ids = rows.filter(r => (r.notes ?? "").includes(notesMarker)).map(r => r.id);
  if (ids.length) await db.delete(rostersTable).where(inArray(rostersTable.id, ids));
}
