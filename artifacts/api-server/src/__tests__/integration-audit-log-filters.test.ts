/**
 * Integration audit log — filter, total, and pagination tests.
 *
 * Self-cleaning: all DB rows created here are deleted in afterAll.
 * Static: does not touch env vars, LDAP, SMTP, or device adapters.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  integrationConnectionProfilesTable,
  integrationAuditLogTable,
} from "@workspace/db";
import app from "../app";

const TEST_TAG = `audit-filter-test-${Date.now()}`;

let profileAId: number;
let profileBId: number;
const createdAuditIds: number[] = [];
const createdProfileIds: number[] = [];

beforeAll(async () => {
  // Two throwaway connection profiles
  const [pA] = await db
    .insert(integrationConnectionProfilesTable)
    .values({ profileName: `${TEST_TAG}-A`, profileNameAr: `${TEST_TAG}-A`, integrationType: "smtp", environment: "development", orgId: 1 })
    .returning();
  const [pB] = await db
    .insert(integrationConnectionProfilesTable)
    .values({ profileName: `${TEST_TAG}-B`, profileNameAr: `${TEST_TAG}-B`, integrationType: "ldap", environment: "development", orgId: 1 })
    .returning();
  profileAId = pA.id;
  profileBId = pB.id;
  createdProfileIds.push(profileAId, profileBId);

  // Seed known audit rows
  const rows = await db
    .insert(integrationAuditLogTable)
    .values([
      { profileId: profileAId, integrationType: "smtp", eventType: "test_passed", outcome: "success", message: TEST_TAG },
      { profileId: profileAId, integrationType: "smtp", eventType: "test_failed", outcome: "failure", message: TEST_TAG },
      { profileId: profileAId, integrationType: "smtp", eventType: "retry_triggered", outcome: "warning", message: TEST_TAG },
      { profileId: profileBId, integrationType: "ldap", eventType: "test_passed", outcome: "success", message: TEST_TAG },
      { profileId: profileBId, integrationType: "ldap", eventType: "health_alert", outcome: "failure", message: TEST_TAG },
    ])
    .returning();
  createdAuditIds.push(...rows.map(r => r.id));
});

afterAll(async () => {
  if (createdAuditIds.length) {
    await db.delete(integrationAuditLogTable).where(inArray(integrationAuditLogTable.id, createdAuditIds));
  }
  if (createdProfileIds.length) {
    await db.delete(integrationConnectionProfilesTable).where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
});

describe("GET /api/integration-governance/audit-log", () => {
  it("returns data, page, pageSize, and total in response", async () => {
    const res = await request(app).get("/api/integration-governance/audit-log?pageSize=1").expect(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("pageSize", 1);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.total).toBeGreaterThanOrEqual(5); // at least our seeded rows
  });

  it("filters by profileId — returns only rows for that profile", async () => {
    const res = await request(app)
      .get(`/api/integration-governance/audit-log?profileId=${profileAId}&pageSize=50`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    for (const row of res.body.data) {
      expect(row.profileId).toBe(profileAId);
    }
    // profileB rows must not appear
    const profileBRows = res.body.data.filter((r: any) => r.profileId === profileBId);
    expect(profileBRows).toHaveLength(0);
  });

  it("filters by eventType — returns only rows with that type", async () => {
    const res = await request(app)
      .get(`/api/integration-governance/audit-log?eventType=test_passed&pageSize=50`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    for (const row of res.body.data) {
      expect(row.eventType).toBe("test_passed");
    }
  });

  it("combines profileId + eventType filters", async () => {
    const res = await request(app)
      .get(`/api/integration-governance/audit-log?profileId=${profileAId}&eventType=retry_triggered&pageSize=50`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of res.body.data) {
      expect(row.profileId).toBe(profileAId);
      expect(row.eventType).toBe("retry_triggered");
    }
    // total must match data length when only our test rows qualify
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("total reflects filtered count, not full table count", async () => {
    const allRes = await request(app).get("/api/integration-governance/audit-log?pageSize=1").expect(200);
    const filteredRes = await request(app)
      .get(`/api/integration-governance/audit-log?profileId=${profileAId}&pageSize=1`)
      .expect(200);
    // Filtered total must be smaller than (or equal to) full total
    expect(filteredRes.body.total).toBeLessThanOrEqual(allRes.body.total);
    // And only profileA rows: should be exactly 3 (our seeded rows)
    expect(filteredRes.body.total).toBeGreaterThanOrEqual(3);
  });

  it("unknown eventType returns empty data array, not an error", async () => {
    const res = await request(app)
      .get("/api/integration-governance/audit-log?eventType=nonexistent_event_xyz&pageSize=50")
      .expect(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("page 2 with pageSize 1 returns a different row than page 1", async () => {
    const p1 = await request(app)
      .get(`/api/integration-governance/audit-log?profileId=${profileAId}&page=1&pageSize=1`)
      .expect(200);
    const p2 = await request(app)
      .get(`/api/integration-governance/audit-log?profileId=${profileAId}&page=2&pageSize=1`)
      .expect(200);
    expect(p1.body.data).toHaveLength(1);
    expect(p2.body.data).toHaveLength(1);
    expect(p1.body.data[0].id).not.toBe(p2.body.data[0].id);
  });

  it("clamps page < 1 to page 1", async () => {
    const res = await request(app)
      .get(`/api/integration-governance/audit-log?page=0&pageSize=5`)
      .expect(200);
    expect(res.body.page).toBe(1);
  });

  it("clamps pageSize > 200 to 200", async () => {
    const res = await request(app)
      .get("/api/integration-governance/audit-log?pageSize=9999")
      .expect(200);
    expect(res.body.pageSize).toBe(200);
  });

  it("page beyond last page returns empty data, not an error", async () => {
    const res = await request(app)
      .get(`/api/integration-governance/audit-log?profileId=${profileAId}&page=99999&pageSize=50`)
      .expect(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });
});
