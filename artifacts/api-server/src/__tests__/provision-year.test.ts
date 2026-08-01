/**
 * Provision-year tests — bulk-provisioning balances for all active employees,
 * reusing ensureLeaveBalance (carry-over caps apply), idempotency, and audit.
 * Uses far-future years so the seeded demo data is never touched, and removes
 * everything it creates.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray, or } from "drizzle-orm";
import { db, leaveBalancesTable, leaveTypesTable, employeesTable, auditLogsTable } from "@workspace/db";
import app from "../app";
import {
  createFixtures, cleanupFixtures, setBalance, getBalance,
  TEST_EMPLOYEE_ID, type TestFixtures,
} from "./helpers";

const PROV_YEAR = 2097;
const PREV_YEAR = PROV_YEAR - 1;

let f: TestFixtures;

beforeAll(async () => {
  f = await createFixtures();
  await db.update(leaveTypesTable).set({ isActive: true })
    .where(eq(leaveTypesTable.id, f.annualTypeId));
});

afterAll(async () => {
  await db.delete(leaveBalancesTable).where(or(
    eq(leaveBalancesTable.year, PROV_YEAR),
    eq(leaveBalancesTable.year, PREV_YEAR),
  ));
  await cleanupFixtures(f);
});

describe("POST /leave-balances/provision-year", () => {
  it("requires a year", async () => {
    const res = await request(app).post("/api/leave-balances/provision-year").send({});
    expect(res.status).toBe(400);
  });

  it("provisions rows for active employees × active types with carry-over caps, and audits", async () => {
    // Previous-year balance with 8 days remaining; type allows max 5 carryover.
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, PREV_YEAR, "10");
    const prev = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, PREV_YEAR);
    await db.update(leaveBalancesTable).set({ used: "2" })
      .where(eq(leaveBalancesTable.id, prev.id));

    const res = await request(app).post("/api/leave-balances/provision-year").send({ year: PROV_YEAR });
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(PROV_YEAR);
    expect(res.body.created).toBeGreaterThan(0);

    const newBal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, PROV_YEAR);
    expect(newBal).toBeDefined();
    // ensureLeaveBalance semantics: entitlement lands in `accrued`, opening 0.
    expect(parseFloat(newBal.accrued)).toBeCloseTo(10); // defaultDaysPerYear
    expect(parseFloat(newBal.openingBalance)).toBeCloseTo(0);
    expect(parseFloat(newBal.carriedOver)).toBeCloseTo(5); // min(8 available, 5 max)
    expect(parseFloat(newBal.used)).toBeCloseTo(0);
    expect(parseFloat(newBal.pending)).toBeCloseTo(0);

    // Only active employees get rows.
    const inactive = await db.select().from(employeesTable)
      .where(eq(employeesTable.status, "inactive"));
    if (inactive.length > 0) {
      const rows = await db.select().from(leaveBalancesTable).where(
        eq(leaveBalancesTable.year, PROV_YEAR),
      );
      const inactiveIds = new Set(inactive.map(e => e.id));
      expect(rows.some(r => inactiveIds.has(r.employeeId))).toBe(false);
    }

    const audit = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.action, "leave_balance.provision_year"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("two simultaneous provision requests do not create duplicate rows", async () => {
    const CONC_YEAR = 2094; // distinct from other test years; cleaned explicitly below
    const [r1, r2] = await Promise.all([
      request(app).post("/api/leave-balances/provision-year").send({ year: CONC_YEAR }),
      request(app).post("/api/leave-balances/provision-year").send({ year: CONC_YEAR }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const rows = await db.select().from(leaveBalancesTable)
      .where(eq(leaveBalancesTable.year, CONC_YEAR));
    const keys = rows.map(r => `${r.employeeId}:${r.leaveTypeId}`);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates

    await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.year, CONC_YEAR));
  });

  it("is idempotent — a second run creates no duplicates and reports skipped", async () => {
    const res = await request(app).post("/api/leave-balances/provision-year").send({ year: PROV_YEAR });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toBeGreaterThan(0);

    const rows = await db.select().from(leaveBalancesTable).where(
      inArray(leaveBalancesTable.leaveTypeId, [f.annualTypeId]),
    );
    const forEmp = rows.filter(r => r.employeeId === TEST_EMPLOYEE_ID && r.year === PROV_YEAR);
    expect(forEmp).toHaveLength(1);
  });
});
