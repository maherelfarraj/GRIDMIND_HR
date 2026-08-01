/**
 * Health monitor — scheduled connection checks, consecutive-failure tracking,
 * and admin alerting when the failure streak reaches alertOnFailureCount.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  integrationConnectionProfilesTable,
  integrationAuditLogTable,
  notificationsTable,
} from "@workspace/db";
import app from "../app";
import { runHealthChecksOnce } from "../lib/health-monitor";
import { testLdapConnection } from "../lib/ldap-adapter";

vi.mock("../lib/ldap-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ldap-adapter")>();
  return { ...actual, testLdapConnection: vi.fn(actual.testLdapConnection) };
});

const createdProfileIds: number[] = [];

async function createProfile(overrides: Partial<typeof integrationConnectionProfilesTable.$inferInsert> = {}) {
  const [row] = await db.insert(integrationConnectionProfilesTable).values({
    profileName: `TEST-HM-${Date.now() % 1000000}-${Math.floor(Math.random() * 1000)}`,
    profileNameAr: "اختبار مراقبة",
    integrationType: "ldap", // no LDAP_* env vars in test env → real adapter fails
    environment: "development",
    governanceStatus: "approved",
    isHealthMonitoringEnabled: true,
    healthCheckIntervalMinutes: 15,
    alertOnFailureCount: 2,
    retryEnabled: false, // most tests exercise single-attempt behavior
    ...overrides,
  }).returning();
  createdProfileIds.push(row.id);
  return row;
}

afterAll(async () => {
  if (createdProfileIds.length) {
    await db.delete(notificationsTable).where(and(
      eq(notificationsTable.entityType, "connection_profile"),
      inArray(notificationsTable.entityId, createdProfileIds),
    ));
    await db.delete(integrationAuditLogTable).where(inArray(integrationAuditLogTable.profileId, createdProfileIds));
    await db.delete(integrationConnectionProfilesTable).where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
});

describe("connection health monitor", () => {
  it("increments consecutiveFailures on failed checks and alerts at the threshold", async () => {
    const profile = await createProfile(); // ldap → fails (missing env vars)

    // Sweep 1 — failure #1, below threshold: no alert yet.
    let result = await runHealthChecksOnce({ force: true });
    let outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome).toBeDefined();
    expect(outcome!.success).toBe(false);
    expect(outcome!.consecutiveFailures).toBe(1);
    expect(outcome!.alertRaised).toBe(false);

    // Sweep 2 — failure #2 reaches alertOnFailureCount: alert fires.
    result = await runHealthChecksOnce({ force: true });
    outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.consecutiveFailures).toBe(2);
    expect(outcome!.alertRaised).toBe(true);

    const [row] = await db.select().from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, profile.id));
    expect(row.consecutiveFailures).toBe(2);
    expect(row.lastTestResult).toBe("failure");
    expect(row.status).toBe("error");
    expect(row.lastTestedAt).not.toBeNull();

    // health_alert audit event recorded
    const auditRows = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_alert"),
      ));
    expect(auditRows.length).toBe(1);

    // Admin notifications surfaced
    const notifs = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.entityType, "connection_profile"),
        eq(notificationsTable.entityId, profile.id),
      ));
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0].severity).toBe("urgent");
    expect(notifs[0].bodyEn).toContain(profile.profileName);

    // Sweep 3 — failure #3 past the threshold: no duplicate alert.
    result = await runHealthChecksOnce({ force: true });
    outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.consecutiveFailures).toBe(3);
    expect(outcome!.alertRaised).toBe(false);
    const auditAfter = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_alert"),
      ));
    expect(auditAfter.length).toBe(1);
  });

  it("retry-then-success: recovers within the retry policy without counting a failure", async () => {
    const profile = await createProfile({
      integrationType: "ldap",
      retryEnabled: true,
      retryMaxAttempts: 3,
      retryBackoffSeconds: 0, // keep the test fast
      consecutiveFailures: 4,
    });

    // Only this profile may consume the mocked results below — take earlier
    // test profiles out of the sweep.
    const others = createdProfileIds.filter((id) => id !== profile.id);
    if (others.length) {
      await db.update(integrationConnectionProfilesTable)
        .set({ isHealthMonitoringEnabled: false })
        .where(inArray(integrationConnectionProfilesTable.id, others));
    }

    // Initial attempt fails, first retry succeeds.
    vi.mocked(testLdapConnection)
      .mockResolvedValueOnce({ success: false, message: "transient blip", latencyMs: 5, simulated: false })
      .mockResolvedValueOnce({ success: true, message: "recovered", latencyMs: 5, simulated: false });

    const result = await runHealthChecksOnce({ force: true });
    const outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(true);
    expect(outcome!.consecutiveFailures).toBe(0);
    expect(outcome!.alertRaised).toBe(false);

    const [row] = await db.select().from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, profile.id));
    expect(row.consecutiveFailures).toBe(0);
    expect(row.lastTestResult).toBe("success");
    expect(row.status).toBe("active");

    // Exactly one retry_triggered audit event, and the sweep event is test_passed.
    const retryEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "retry_triggered"),
      ));
    expect(retryEvents.length).toBe(1);
    const passedEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "test_passed"),
      ));
    expect(passedEvents.length).toBe(1);
  });

  it("retry-exhausted: counts one failure after all retries fail and logs each retry", async () => {
    const profile = await createProfile({
      integrationType: "ldap", // real adapter fails every attempt (no LDAP env)
      retryEnabled: true,
      retryMaxAttempts: 2,
      retryBackoffSeconds: 0,
    });

    const result = await runHealthChecksOnce({ force: true });
    const outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(false);
    // Retries happen within the sweep — only ONE failure is counted.
    expect(outcome!.consecutiveFailures).toBe(1);

    const retryEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "retry_triggered"),
      ));
    expect(retryEvents.length).toBe(2);
    const failedEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "test_failed"),
      ));
    expect(failedEvents.length).toBe(1);
  });

  it("does not retry when retryEnabled is false", async () => {
    const profile = await createProfile({ integrationType: "ldap", retryEnabled: false });
    await runHealthChecksOnce({ force: true });
    const retryEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "retry_triggered"),
      ));
    expect(retryEvents.length).toBe(0);
  });

  it("resets consecutiveFailures to 0 on a successful check", async () => {
    // internal_api has no real adapter → simulated success
    const profile = await createProfile({ integrationType: "internal_api", consecutiveFailures: 5 });
    const result = await runHealthChecksOnce({ force: true });
    const outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(true);
    expect(outcome!.consecutiveFailures).toBe(0);
    const [row] = await db.select().from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, profile.id));
    expect(row.consecutiveFailures).toBe(0);
    expect(row.status).toBe("active");
  });

  it("skips profiles without monitoring enabled and suspended profiles", async () => {
    const off = await createProfile({ isHealthMonitoringEnabled: false });
    const suspended = await createProfile({ governanceStatus: "suspended" });
    const result = await runHealthChecksOnce({ force: true });
    expect(result.outcomes.find((o) => o.profileId === off.id)).toBeUndefined();
    expect(result.outcomes.find((o) => o.profileId === suspended.id)).toBeUndefined();
  });

  it("respects healthCheckIntervalMinutes when not forced", async () => {
    const profile = await createProfile({ integrationType: "internal_api" });
    await db.update(integrationConnectionProfilesTable)
      .set({ lastTestedAt: new Date() }) // just tested — not due
      .where(eq(integrationConnectionProfilesTable.id, profile.id));
    const result = await runHealthChecksOnce();
    expect(result.outcomes.find((o) => o.profileId === profile.id)).toBeUndefined();
  });

  it("exposes a manual trigger endpoint", async () => {
    const profile = await createProfile({ integrationType: "internal_api" });
    const res = await request(app)
      .post("/api/integration-governance/health-checks/run")
      .send({ force: true });
    expect(res.status).toBe(200);
    expect(res.body.checked).toBeGreaterThan(0);
    const outcome = res.body.outcomes.find((o: any) => o.profileId === profile.id);
    expect(outcome).toBeDefined();
    expect(outcome.success).toBe(true);
  });

  it("manual profile test updates the failure streak too", async () => {
    const profile = await createProfile({ integrationType: "ldap", consecutiveFailures: 0 });
    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profile.id}/test`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    const [row] = await db.select().from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, profile.id));
    expect(row.consecutiveFailures).toBe(1);
  });
});
