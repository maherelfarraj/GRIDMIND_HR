/**
 * Annual reset tests — new-year balance creation, carryover capping, idempotency.
 * Uses far-future years so the seeded demo data is never touched, and removes
 * everything it creates.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray, or } from "drizzle-orm";
import { db, leaveBalancesTable, leaveTypesTable, auditLogsTable } from "@workspace/db";
import app from "../app";
import {
  createFixtures, cleanupFixtures, setBalance, getBalance,
  TEST_EMPLOYEE_ID, type TestFixtures,
} from "./helpers";

const RESET_YEAR = 2099;
const PREV_YEAR = RESET_YEAR - 1;

let f: TestFixtures;

beforeAll(async () => {
  f = await createFixtures();
  // Activate the test annual type so the reset includes it.
  await db.update(leaveTypesTable).set({ isActive: true })
    .where(eq(leaveTypesTable.id, f.annualTypeId));
});

afterAll(async () => {
  // Remove every balance row the reset created for the far-future years.
  await db.delete(leaveBalancesTable).where(or(
    eq(leaveBalancesTable.year, RESET_YEAR),
    eq(leaveBalancesTable.year, PREV_YEAR),
  ));
  await cleanupFixtures(f);
});

describe("POST /leave-balances/annual-reset", () => {
  it("requires a year", async () => {
    const res = await request(app).post("/api/leave-balances/annual-reset").send({});
    expect(res.status).toBe(400);
  });

  it("creates new-year rows for every employee × active type, capping carryover, and audits", async () => {
    // Previous-year balance with 8 days remaining; type allows max 5 carryover.
    await setBalance(TEST_EMPLOYEE_ID, f.annualTypeId, PREV_YEAR, "10");
    const prev = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, PREV_YEAR);
    await db.update(leaveBalancesTable).set({ used: "2" })
      .where(eq(leaveBalancesTable.id, prev.id));

    const res = await request(app).post("/api/leave-balances/annual-reset").send({ year: RESET_YEAR });
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(RESET_YEAR);
    expect(res.body.created).toBeGreaterThan(0);

    const newBal = await getBalance(TEST_EMPLOYEE_ID, f.annualTypeId, RESET_YEAR);
    expect(newBal).toBeDefined();
    expect(parseFloat(newBal.openingBalance)).toBeCloseTo(10); // defaultDaysPerYear
    expect(parseFloat(newBal.carriedOver)).toBeCloseTo(5); // min(8 available, 5 max)
    expect(parseFloat(newBal.used)).toBeCloseTo(0);
    expect(parseFloat(newBal.pending)).toBeCloseTo(0);

    const audit = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.action, "leave_balance.annual_reset"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second run creates no duplicate rows", async () => {
    const res = await request(app).post("/api/leave-balances/annual-reset").send({ year: RESET_YEAR });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);

    const rows = await db.select().from(leaveBalancesTable).where(
      inArray(leaveBalancesTable.leaveTypeId, [f.annualTypeId]),
    );
    const forEmp = rows.filter(r => r.employeeId === TEST_EMPLOYEE_ID && r.year === RESET_YEAR);
    expect(forEmp).toHaveLength(1);
  });
});
