/**
 * Health monitor sweep-loop failure alerting — repeated sweep failures past
 * the threshold raise an audit event + notifications for Security Officer /
 * Super Administrator roles, and a recovery notice is raised (exactly once)
 * when sweeps succeed again. Mirrors sweeper-failure-alerts.test.ts via the
 * shared background-job failure alerter.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  notificationsTable,
  systemUsersTable,
  rolesTable,
} from "@workspace/db";
import {
  runMonitoredHealthSweep,
  HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD,
  HEALTH_SWEEP_ALERT_ACTION,
  HEALTH_SWEEP_RECOVERED_ACTION,
  _resetHealthSweepStateForTests,
} from "../lib/health-monitor";

const ENTITY_TYPE = "health_monitor_sweep";

const failingSweep = () => Promise.reject(new Error("TEST-HEALTH-SWEEP: db unavailable"));
const passingSweep = () => Promise.resolve();

async function cleanupRecords() {
  await db.delete(notificationsTable).where(eq(notificationsTable.entityType, ENTITY_TYPE));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.entityType, ENTITY_TYPE));
}

async function sweepAuditEvents() {
  return db.select().from(auditLogsTable).where(and(
    eq(auditLogsTable.entityType, ENTITY_TYPE),
    inArray(auditLogsTable.action, [HEALTH_SWEEP_ALERT_ACTION, HEALTH_SWEEP_RECOVERED_ACTION]),
  ));
}

async function sweepNotifications() {
  return db.select().from(notificationsTable).where(eq(notificationsTable.entityType, ENTITY_TYPE));
}

/** Active users holding roles that must be alerted. */
async function securityOfficerIds(): Promise<number[]> {
  const rows = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(
      eq(systemUsersTable.isActive, true),
      inArray(rolesTable.nameEn, ["Super Administrator", "Security Officer"]),
    ));
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

beforeEach(async () => {
  _resetHealthSweepStateForTests();
  await cleanupRecords();
});

afterAll(cleanupRecords);

describe("health monitor sweep-loop failure alerting", () => {
  it("alerts security officers only once the failure streak reaches the threshold", async () => {
    // Failures below the threshold: no alert.
    for (let i = 1; i < HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD; i++) {
      const r = await runMonitoredHealthSweep(failingSweep);
      expect(r.success).toBe(false);
      expect(r.consecutiveFailures).toBe(i);
      expect(r.alertRaised).toBe(false);
    }
    expect(await sweepAuditEvents()).toHaveLength(0);
    expect(await sweepNotifications()).toHaveLength(0);

    // Threshold reached: exactly one alert event + notifications to officers.
    const r = await runMonitoredHealthSweep(failingSweep);
    expect(r.alertRaised).toBe(true);

    const events = await sweepAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(HEALTH_SWEEP_ALERT_ACTION);
    const meta = JSON.parse(events[0].changesJson ?? "{}");
    expect(meta.consecutiveFailures).toBe(HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD);
    expect(meta.lastError).toContain("TEST-HEALTH-SWEEP");

    const officers = await securityOfficerIds();
    expect(officers.length).toBeGreaterThan(0);
    const notifications = await sweepNotifications();
    expect(notifications.map((n) => n.recipientUserId).sort((a, b) => a - b)).toEqual(officers);
    for (const n of notifications) {
      expect(n.notificationType).toBe("security_alert");
      expect(n.severity).toBe("urgent");
      expect(n.requiresAction).toBe(true);
      expect(n.actionUrl).toBe("/integration-governance");
    }
  });

  it("does not re-alert on further failures while an alert is outstanding", async () => {
    for (let i = 0; i < HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runMonitoredHealthSweep(failingSweep);
    expect(await sweepAuditEvents()).toHaveLength(1);

    // Two more failures past the threshold — still one alert, no new notifications.
    const before = (await sweepNotifications()).length;
    for (let i = 0; i < 2; i++) {
      const r = await runMonitoredHealthSweep(failingSweep);
      expect(r.alertRaised).toBe(false);
    }
    expect(await sweepAuditEvents()).toHaveLength(1);
    expect(await sweepNotifications()).toHaveLength(before);
  });

  it("raises a recovery notice once sweeps succeed again, and only once", async () => {
    for (let i = 0; i < HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runMonitoredHealthSweep(failingSweep);

    const recovered = await runMonitoredHealthSweep(passingSweep);
    expect(recovered.success).toBe(true);
    expect(recovered.recoveryRaised).toBe(true);

    const events = await sweepAuditEvents();
    expect(events.map((e) => e.action)).toEqual([HEALTH_SWEEP_ALERT_ACTION, HEALTH_SWEEP_RECOVERED_ACTION]);

    const officers = await securityOfficerIds();
    const recoveryNotes = (await sweepNotifications()).filter((n) => n.severity === "success");
    expect(recoveryNotes.map((n) => n.recipientUserId).sort((a, b) => a - b)).toEqual(officers);

    // Subsequent successes are quiet — no duplicate recovery.
    const again = await runMonitoredHealthSweep(passingSweep);
    expect(again.recoveryRaised).toBe(false);
    expect(await sweepAuditEvents()).toHaveLength(2);
  });

  it("raises a recovery after restart even though the in-memory streak was reset", async () => {
    for (let i = 0; i < HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runMonitoredHealthSweep(failingSweep);
    // Simulate a process restart: in-memory streak gone, alert still in audit trail.
    _resetHealthSweepStateForTests();

    const r = await runMonitoredHealthSweep(passingSweep);
    expect(r.recoveryRaised).toBe(true);
  });

  it("emits exactly one recovery when concurrent successful sweeps race", async () => {
    for (let i = 0; i < HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runMonitoredHealthSweep(failingSweep);

    const results = await Promise.all([
      runMonitoredHealthSweep(passingSweep),
      runMonitoredHealthSweep(passingSweep),
      runMonitoredHealthSweep(passingSweep),
    ]);
    expect(results.filter((r) => r.recoveryRaised)).toHaveLength(1);
    const events = await sweepAuditEvents();
    expect(events.filter((e) => e.action === HEALTH_SWEEP_RECOVERED_ACTION)).toHaveLength(1);
  });

  it("keeps a successful sweep quiet when no alert was ever raised", async () => {
    const r = await runMonitoredHealthSweep(passingSweep);
    expect(r).toEqual({ success: true, consecutiveFailures: 0, alertRaised: false, recoveryRaised: false });
    expect(await sweepAuditEvents()).toHaveLength(0);
  });

  it("keeps the two jobs' alert states independent (health sweep alert doesn't affect privileged-session sweeper)", async () => {
    const { runSweepOnce, _resetSweeperStateForTests } = await import("../lib/privilegedSessionSweeper");
    _resetSweeperStateForTests();

    for (let i = 0; i < HEALTH_SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runMonitoredHealthSweep(failingSweep);
    expect(await sweepAuditEvents()).toHaveLength(1);

    // A successful privileged-session sweep must NOT claim the health sweep's alert.
    const r = await runSweepOnce(passingSweep);
    expect(r.recoveryRaised).toBe(false);
    const events = await sweepAuditEvents();
    expect(events.filter((e) => e.action === HEALTH_SWEEP_RECOVERED_ACTION)).toHaveLength(0);
  });
});
