/**
 * GET /audit-logs filtering tests (action / entityLabel / ipAddress).
 *
 * Inserts dedicated audit rows with a unique suffix, queries the endpoint
 * with each filter, and cleans up its own fixtures in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import app from "../app";

const SUFFIX = Date.now();
const USER_A = `audit-filter-a-${SUFFIX}`;
const USER_B = `audit-filter-b-${SUFFIX}`;
const IP_A = "203.0.113.77";
const IP_B = "198.51.100.42";

const ids: number[] = [];

beforeAll(async () => {
  const rows = await db.insert(auditLogsTable).values([
    { action: "login.failed", entityType: "auth", entityLabel: USER_A, ipAddress: IP_A },
    { action: "login.failed", entityType: "auth", entityLabel: USER_B, ipAddress: IP_B },
    { action: "login.lockout", entityType: "auth", entityLabel: USER_A, ipAddress: IP_A },
    { action: "create", entityType: "employee", entityLabel: USER_A, ipAddress: IP_B },
  ]).returning({ id: auditLogsTable.id });
  ids.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, ids));
});

type AuditRow = { id: number; action: string; entityLabel: string | null; ipAddress: string | null };
const mine = (data: AuditRow[]) => data.filter((d) => ids.includes(d.id));

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
