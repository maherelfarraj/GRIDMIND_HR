/**
 * Verifies that PATCH /employees/:id records accurate before/after snapshots in
 * the audit log — not the raw request body for both sides.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, and, inArray } from "drizzle-orm";
import { db, employeesTable, auditLogsTable } from "@workspace/db";
import app from "../app";
import { TEST_ORG_ID } from "./helpers";

const SUFFIX = `${Date.now() % 1000000}`;

let empId: number;

beforeAll(async () => {
  const [seed] = await db.select().from(employeesTable).limit(1);
  expect(seed).toBeDefined();

  const [emp] = await db.insert(employeesTable).values({
    employeeNumber: `T-AUD-${SUFFIX}`,
    firstNameEn: "Audit",
    lastNameEn: "Before",
    firstNameAr: "تدقيق",
    lastNameAr: "قبل",
    nationalId: `AUD${SUFFIX}`,
    jobTitleEn: "Tester",
    jobTitleAr: "مختبر",
    departmentId: seed.departmentId,
    roleId: seed.roleId,
    status: "active",
    email: `audit-before-${SUFFIX}@example.com`,
    hireDate: "2022-01-01",
    nationality: "SA",
    orgId: TEST_ORG_ID,
  }).returning();
  empId = emp.id;
});

afterAll(async () => {
  if (!empId) return;
  await db.delete(auditLogsTable).where(
    and(
      eq(auditLogsTable.entityType, "employee"),
      eq(auditLogsTable.entityId, empId),
    )
  );
  await db.delete(employeesTable).where(eq(employeesTable.id, empId));
});

describe("PATCH /employees/:id audit before/after", () => {
  it("stores the real prior value in before and the new value in after", async () => {
    // Patch a single field so the diff is unambiguous.
    const newTitle = `Senior Tester ${SUFFIX}`;
    const res = await request(app)
      .patch(`/api/employees/${empId}`)
      .set("X-Org-Id", String(TEST_ORG_ID))
      .send({ jobTitleEn: newTitle });

    expect(res.status).toBe(200);
    expect(res.body.jobTitleEn).toBe(newTitle);

    // Fetch the latest audit row for this employee update.
    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.entityType, "employee"),
          eq(auditLogsTable.entityId, empId),
          eq(auditLogsTable.action, "update"),
        )
      );

    expect(logs.length).toBeGreaterThan(0);
    const changes = JSON.parse(logs[logs.length - 1].changesJson as string);

    // before should hold the OLD value, after should hold the NEW value.
    expect(changes.before).toBeDefined();
    expect(changes.after).toBeDefined();
    expect(changes.before.jobTitleEn).toBe("Tester");
    expect(changes.after.jobTitleEn).toBe(newTitle);

    // Crucially, before and after must differ.
    expect(changes.before.jobTitleEn).not.toBe(changes.after.jobTitleEn);
  });

  it("records accurate before/after for multiple changed fields", async () => {
    const res = await request(app)
      .patch(`/api/employees/${empId}`)
      .set("X-Org-Id", String(TEST_ORG_ID))
      .send({ jobTitleEn: "Lead Tester", jobTitleAr: "قائد المختبرين" });

    expect(res.status).toBe(200);

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.entityType, "employee"),
          eq(auditLogsTable.entityId, empId),
          eq(auditLogsTable.action, "update"),
        )
      );

    const changes = JSON.parse(logs[logs.length - 1].changesJson as string);

    // Both fields should appear in the snapshot.
    expect(changes.before.jobTitleEn).not.toBe(changes.after.jobTitleEn);
    expect(changes.before.jobTitleAr).not.toBe(changes.after.jobTitleAr);
    expect(changes.after.jobTitleEn).toBe("Lead Tester");
    expect(changes.after.jobTitleAr).toBe("قائد المختبرين");
  });
});
