/**
 * GET /audit-logs filtering tests (action / entityLabel / ipAddress /
 * from-to date range / limit validation).
 *
 * Inserts dedicated audit rows with a unique suffix, queries the endpoint
 * with each filter, and cleans up its own fixtures in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, sql } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import app from "../app";

const SUFFIX = Date.now();
const USER_A = `audit-filter-a-${SUFFIX}`;
const USER_B = `audit-filter-b-${SUFFIX}`;
const IP_A = "203.0.113.77";
const IP_B = "198.51.100.42";

const ids: number[] = [];

// Two sentinel dates for the date-range tests — far in the past to avoid
// interfering with real data, yet distinct enough to test from/to separately.
const DATE_PAST = "2000-01-15"; // rows inserted at this timestamp
const DATE_FUTURE = "2000-01-17";
const DATE_MID = "2000-01-16";

const dateIds: number[] = [];

beforeAll(async () => {
  const rows = await db.insert(auditLogsTable).values([
    { action: "login.failed", entityType: "auth", entityLabel: USER_A, ipAddress: IP_A },
    { action: "login.failed", entityType: "auth", entityLabel: USER_B, ipAddress: IP_B },
    { action: "login.lockout", entityType: "auth", entityLabel: USER_A, ipAddress: IP_A },
    { action: "create", entityType: "employee", entityLabel: USER_A, ipAddress: IP_B },
  ]).returning({ id: auditLogsTable.id });
  ids.push(...rows.map((r) => r.id));

  // Insert rows with explicit timestamps for date-range tests
  const dateRows = await db.insert(auditLogsTable).values([
    {
      action: "UPDATE",
      entityType: "date-range-test",
      entityLabel: `dr-before-${SUFFIX}`,
      createdAt: new Date(`${DATE_PAST}T10:00:00Z`),
    },
    {
      action: "UPDATE",
      entityType: "date-range-test",
      entityLabel: `dr-mid-${SUFFIX}`,
      createdAt: new Date(`${DATE_MID}T10:00:00Z`),
    },
    {
      action: "UPDATE",
      entityType: "date-range-test",
      entityLabel: `dr-after-${SUFFIX}`,
      createdAt: new Date(`${DATE_FUTURE}T10:00:00Z`),
    },
  ]).returning({ id: auditLogsTable.id });
  dateIds.push(...dateRows.map((r) => r.id));
});

afterAll(async () => {
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, [...ids, ...dateIds]));
});

type AuditRow = { id: number; action: string; entityLabel: string | null; ipAddress: string | null };
const mine = (data: AuditRow[]) => data.filter((d) => ids.includes(d.id));
const mineDates = (data: AuditRow[]) => data.filter((d) => dateIds.includes(d.id));

describe("GET /audit-logs filters", () => {
  it("filters by a single action", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ action: "login.lockout", entityLabel: USER_A });
    expect(res.status).toBe(200);
    const rows = mine(res.body.data);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("login.lockout");
  });

  it("filters by a comma-separated security action set", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ action: "login.failed,login.lockout", entityLabel: `audit-filter`, limit: 200 });
    expect(res.status).toBe(200);
    const rows = mine(res.body.data);
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => ["login.failed", "login.lockout"].includes(r.action))).toBe(true);
  });

  it("filters by entity label (username substring, case-insensitive)", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ entityLabel: USER_B.toUpperCase(), limit: 200 });
    expect(res.status).toBe(200);
    const rows = mine(res.body.data);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityLabel).toBe(USER_B);
  });

  it("filters by IP address", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ ipAddress: IP_A, entityLabel: `audit-filter`, limit: 200 });
    expect(res.status).toBe(200);
    const rows = mine(res.body.data);
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.ipAddress === IP_A)).toBe(true);
  });

  it("combines action, entity label, and IP filters", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ action: "login.failed", entityLabel: USER_A, ipAddress: IP_A });
    expect(res.status).toBe(200);
    const rows = mine(res.body.data);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityLabel).toBe(USER_A);
    expect(rows[0].ipAddress).toBe(IP_A);
  });

  it("returns a total that reflects the active filters", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ entityLabel: `audit-filter-a-${SUFFIX}`, limit: 200 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(mine(res.body.data).length);
  });
});

describe("GET /audit-logs date-range filters", () => {
  it("filters by 'from' date (inclusive — rows on or after the date are returned)", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ from: DATE_MID, entityType: "date-range-test", limit: 200 });
    expect(res.status).toBe(200);
    const rows = mineDates(res.body.data);
    // Should include mid and after, exclude before
    expect(rows.map((r: any) => r.entityLabel)).toContain(`dr-mid-${SUFFIX}`);
    expect(rows.map((r: any) => r.entityLabel)).toContain(`dr-after-${SUFFIX}`);
    expect(rows.map((r: any) => r.entityLabel)).not.toContain(`dr-before-${SUFFIX}`);
  });

  it("filters by 'to' date (inclusive — rows on or before the date are returned)", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ to: DATE_MID, entityType: "date-range-test", limit: 200 });
    expect(res.status).toBe(200);
    const rows = mineDates(res.body.data);
    // Should include before and mid, exclude after
    expect(rows.map((r: any) => r.entityLabel)).toContain(`dr-before-${SUFFIX}`);
    expect(rows.map((r: any) => r.entityLabel)).toContain(`dr-mid-${SUFFIX}`);
    expect(rows.map((r: any) => r.entityLabel)).not.toContain(`dr-after-${SUFFIX}`);
  });

  it("filters by combined from/to range (inclusive both ends)", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ from: DATE_MID, to: DATE_MID, entityType: "date-range-test", limit: 200 });
    expect(res.status).toBe(200);
    const rows = mineDates(res.body.data);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityLabel).toBe(`dr-mid-${SUFFIX}`);
  });

  it("total count respects date-range filter", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ from: DATE_PAST, to: DATE_MID, entityType: "date-range-test", limit: 200 });
    expect(res.status).toBe(200);
    const rows = mineDates(res.body.data);
    // total reflects only filtered rows (ours: before + mid = 2)
    expect(rows).toHaveLength(2);
    // total >= 2 (there may be other date-range-test rows from concurrent test runs
    // but at least our 2 must be counted)
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("returns empty result for an out-of-range date", async () => {
    const res = await request(app).get("/api/audit-logs")
      .query({ from: "1999-01-01", to: "1999-12-31", entityType: "date-range-test", limit: 200 });
    expect(res.status).toBe(200);
    const rows = mineDates(res.body.data);
    expect(rows).toHaveLength(0);
  });
});

describe("GET /audit-logs limit validation", () => {
  it("accepts limit=50", async () => {
    const res = await request(app).get("/api/audit-logs").query({ limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
  });

  it("accepts limit=100", async () => {
    const res = await request(app).get("/api/audit-logs").query({ limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it("accepts limit=200", async () => {
    const res = await request(app).get("/api/audit-logs").query({ limit: 200 });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it("rejects an invalid limit (e.g. 999) with 400", async () => {
    const res = await request(app).get("/api/audit-logs").query({ limit: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid limit/i);
  });

  it("rejects limit=0 with 400", async () => {
    const res = await request(app).get("/api/audit-logs").query({ limit: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid limit/i);
  });

  it("defaults to limit=50 when no limit is provided", async () => {
    const res = await request(app).get("/api/audit-logs");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
  });
});
