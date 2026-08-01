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
import { runHealthChecksOnce, HEALTH_CHECK_CONCURRENCY_LIMIT } from "../lib/health-monitor";
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

  it("notifies admins with a recovery notice after a previously-alerted profile passes", async () => {
    // Profile with an outstanding health alert → next successful check recovers.
    const profile = await createProfile({ integrationType: "internal_api", consecutiveFailures: 3 });
    await db.insert(integrationAuditLogTable).values({
      profileId: profile.id, integrationType: profile.integrationType,
      eventType: "health_alert", outcome: "failure", message: "seeded alert", actorUserId: null,
    });

    const result = await runHealthChecksOnce({ force: true });
    const outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(true);
    expect(outcome!.consecutiveFailures).toBe(0);
    expect(outcome!.recoveryRaised).toBe(true);
    expect(result.recoveriesRaised).toBeGreaterThanOrEqual(1);

    // health_recovered audit event recorded
    const auditRows = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].outcome).toBe("success");

    // Admin notifications surfaced with success severity
    const notifs = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.entityType, "connection_profile"),
        eq(notificationsTable.entityId, profile.id),
      ));
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0].severity).toBe("success");
    expect(notifs[0].bodyEn).toContain(profile.profileName);
    expect(notifs[0].bodyEn).toContain("recovered");

    // A second successful sweep must not raise a duplicate recovery notice.
    const again = await runHealthChecksOnce({ force: true });
    const outcome2 = again.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome2!.recoveryRaised).toBe(false);
    const auditAfter = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(auditAfter.length).toBe(1);
  });

  it("does not raise a recovery notice for profiles that never crossed the threshold", async () => {
    const profile = await createProfile({ integrationType: "internal_api", consecutiveFailures: 1 }); // below threshold of 2

    const result = await runHealthChecksOnce({ force: true });
    const outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(true);
    expect(outcome!.consecutiveFailures).toBe(0);
    expect(outcome!.recoveryRaised).toBe(false);

    const auditRows = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(auditRows.length).toBe(0);
  });

  it("fail-to-threshold then recover: full loop", async () => {
    // ldap fails (no env) → two failed sweeps reach the threshold; then flip to
    // a simulated-success type to recover.
    const profile = await createProfile({ integrationType: "ldap", alertOnFailureCount: 2 });

    await runHealthChecksOnce({ force: true });
    const second = await runHealthChecksOnce({ force: true });
    expect(second.outcomes.find((o) => o.profileId === profile.id)!.alertRaised).toBe(true);

    await db.update(integrationConnectionProfilesTable)
      .set({ integrationType: "internal_api" })
      .where(eq(integrationConnectionProfilesTable.id, profile.id));

    const third = await runHealthChecksOnce({ force: true });
    const outcome = third.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(true);
    expect(outcome!.recoveryRaised).toBe(true);

    const recoveredEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(recoveredEvents.length).toBe(1);
  });

  it("does not raise a false recovery when the threshold was raised after failures (no actual alert)", async () => {
    // Failures accrued but never reached the (new, higher) threshold — no
    // health_alert audit event exists, so success must not raise a recovery.
    const profile = await createProfile({ integrationType: "internal_api", consecutiveFailures: 5, alertOnFailureCount: 10 });

    const result = await runHealthChecksOnce({ force: true });
    const outcome = result.outcomes.find((o) => o.profileId === profile.id);
    expect(outcome!.success).toBe(true);
    expect(outcome!.recoveryRaised).toBe(false);

    const auditRows = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(auditRows.length).toBe(0);
  });

  it("manual test success also raises the recovery notice for an alerted profile", async () => {
    const profile = await createProfile({ integrationType: "internal_api", consecutiveFailures: 4 });
    await db.insert(integrationAuditLogTable).values({
      profileId: profile.id, integrationType: profile.integrationType,
      eventType: "health_alert", outcome: "failure", message: "seeded alert", actorUserId: null,
    });

    const res = await request(app)
      .post(`/api/integration-governance/connection-profiles/${profile.id}/test`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const recoveredEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(recoveredEvents.length).toBe(1);

    const notifs = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.entityType, "connection_profile"),
        eq(notificationsTable.entityId, profile.id),
      ));
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0].severity).toBe("success");

    // A second manual success does not duplicate the recovery.
    await request(app)
      .post(`/api/integration-governance/connection-profiles/${profile.id}/test`)
      .send({});
    const after = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(after.length).toBe(1);
  });

  it("concurrent successful checks raise exactly one recovery notice", async () => {
    const profile = await createProfile({ integrationType: "internal_api", consecutiveFailures: 3 });
    await db.insert(integrationAuditLogTable).values({
      profileId: profile.id, integrationType: profile.integrationType,
      eventType: "health_alert", outcome: "failure", message: "seeded alert", actorUserId: null,
    });

    // A manual test racing another manual test (same shape as a sweep racing
    // a manual test — both go through the same atomic claim).
    const [a, b] = await Promise.all([
      request(app).post(`/api/integration-governance/connection-profiles/${profile.id}/test`).send({}),
      request(app).post(`/api/integration-governance/connection-profiles/${profile.id}/test`).send({}),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.success).toBe(true);
    expect(b.body.success).toBe(true);

    const recoveredEvents = await db.select().from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        eq(integrationAuditLogTable.eventType, "health_recovered"),
      ));
    expect(recoveredEvents.length).toBe(1);

    // Exactly one notification per admin recipient — no duplicates.
    const notifs = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.entityType, "connection_profile"),
        eq(notificationsTable.entityId, profile.id),
      ));
    const perRecipient = new Map<number, number>();
    for (const n of notifs) perRecipient.set(n.recipientUserId, (perRecipient.get(n.recipientUserId) ?? 0) + 1);
    expect(notifs.length).toBeGreaterThan(0);
    for (const count of perRecipient.values()) expect(count).toBe(1);
  });

  it("a slow-retrying profile does not delay health checks for other profiles", async () => {
    // Slow profile: ldap fails every attempt (no LDAP env), 2 retries with a
    // 1s backoff each → its check takes ~2s. Normal profile: simulated
    // success, near-instant. Checks run concurrently, so the normal profile
    // must be persisted long before the slow one finishes its backoffs.
    const slow = await createProfile({
      integrationType: "ldap",
      retryEnabled: true,
      retryMaxAttempts: 2,
      retryBackoffSeconds: 1,
      alertOnFailureCount: 99,
    });
    const normal = await createProfile({ integrationType: "internal_api" });

    const started = Date.now();
    const result = await runHealthChecksOnce({ force: true });
    const elapsedMs = Date.now() - started;

    const slowOutcome = result.outcomes.find((o) => o.profileId === slow.id);
    const normalOutcome = result.outcomes.find((o) => o.profileId === normal.id);
    expect(slowOutcome!.success).toBe(false);
    expect(normalOutcome!.success).toBe(true);

    // The sweep took at least the slow profile's backoff time...
    expect(elapsedMs).toBeGreaterThanOrEqual(1900);

    // ...but the normal profile's check completed (row updated) right at the
    // start of the sweep, not after the slow profile's retries.
    const [slowRow] = await db.select().from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, slow.id));
    const [normalRow] = await db.select().from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, normal.id));
    const normalDoneAfterMs = new Date(normalRow.updatedAt!).getTime() - started;
    const slowDoneAfterMs = new Date(slowRow.updatedAt!).getTime() - started;
    expect(normalDoneAfterMs).toBeLessThan(1000); // not held up by the slow profile
    expect(slowDoneAfterMs).toBeGreaterThanOrEqual(1900);
  });

  it("checks more profiles than the concurrency limit in one sweep, never exceeding the limit", async () => {
    // More profiles than the pool allows in flight at once.
    const profileCount = HEALTH_CHECK_CONCURRENCY_LIMIT + 3;
    const profiles = [];
    for (let i = 0; i < profileCount; i++) {
      profiles.push(await createProfile({ integrationType: "ldap" }));
    }
    const ids = new Set(profiles.map((p) => p.id));

    // Only these profiles may consume the mocked adapter — take earlier test
    // profiles out of the sweep.
    const others = createdProfileIds.filter((id) => !ids.has(id));
    if (others.length) {
      await db.update(integrationConnectionProfilesTable)
        .set({ isHealthMonitoringEnabled: false })
        .where(inArray(integrationConnectionProfilesTable.id, others));
    }

    // Instrument the adapter to record how many checks are in flight at once.
    let inFlight = 0;
    let maxInFlight = 0;
    const instrumented = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      inFlight--;
      return { success: true, message: "ok", latencyMs: 1, simulated: false as const };
    };
    // One-shot implementations (retries are disabled, so exactly one call per
    // profile) — later tests keep the real adapter behavior.
    const callsBefore = vi.mocked(testLdapConnection).mock.calls.length;
    for (let i = 0; i < profileCount; i++) {
      vi.mocked(testLdapConnection).mockImplementationOnce(instrumented);
    }

    const result = await runHealthChecksOnce({ force: true });

    // Every profile beyond the limit still got checked in this sweep...
    const checkedIds = new Set(result.outcomes.map((o) => o.profileId));
    for (const p of profiles) expect(checkedIds.has(p.id)).toBe(true);
    expect(vi.mocked(testLdapConnection).mock.calls.length - callsBefore).toBe(profileCount);

    // ...but never more than the limit ran concurrently.
    expect(maxInFlight).toBeGreaterThan(1); // still concurrent, not serialized
    expect(maxInFlight).toBeLessThanOrEqual(HEALTH_CHECK_CONCURRENCY_LIMIT);
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
