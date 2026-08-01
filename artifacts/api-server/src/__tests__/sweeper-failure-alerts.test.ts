/**
 * Privileged-session sweeper failure alerting — repeated sweep failures past
 * the threshold raise an audit event + notifications for Security Officer /
 * Super Administrator roles, and a recovery notice is raised (exactly once)
 * when sweeps succeed again.
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
  runSweepOnce,
  SWEEP_FAILURE_ALERT_THRESHOLD,
  SWEEPER_ALERT_ACTION,
  SWEEPER_RECOVERED_ACTION,
  _resetSweeperStateForTests,
} from "../lib/privilegedSessionSweeper";

const ENTITY_TYPE = "privileged_session_sweeper";

const failingSweep = () => Promise.reject(new Error("TEST-SWEEP: db unavailable"));
const passingSweep = () => Promise.resolve();

async function cleanupSweeperRecords() {
  await db.delete(notificationsTable).where(eq(notificationsTable.entityType, ENTITY_TYPE));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.entityType, ENTITY_TYPE));
}

async function sweeperAuditEvents() {
  return db.select().from(auditLogsTable).where(and(
    eq(auditLogsTable.entityType, ENTITY_TYPE),
    inArray(auditLogsTable.action, [SWEEPER_ALERT_ACTION, SWEEPER_RECOVERED_ACTION]),
  ));
}

async function sweeperNotifications() {
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
  _resetSweeperStateForTests();
  await cleanupSweeperRecords();
});

afterAll(cleanupSweeperRecords);

describe("privileged-session sweeper failure alerting", () => {
  it("alerts security officers only once the failure streak reaches the threshold", async () => {
    // Failures below the threshold: no alert.
    for (let i = 1; i < SWEEP_FAILURE_ALERT_THRESHOLD; i++) {
      const r = await runSweepOnce(failingSweep);
      expect(r.success).toBe(false);
      expect(r.consecutiveFailures).toBe(i);
      expect(r.alertRaised).toBe(false);
    }
    expect(await sweeperAuditEvents()).toHaveLength(0);
    expect(await sweeperNotifications()).toHaveLength(0);

    // Threshold reached: exactly one alert event + notifications to officers.
    const r = await runSweepOnce(failingSweep);
    expect(r.alertRaised).toBe(true);

    const events = await sweeperAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(SWEEPER_ALERT_ACTION);
    const meta = JSON.parse(events[0].changesJson ?? "{}");
    expect(meta.consecutiveFailures).toBe(SWEEP_FAILURE_ALERT_THRESHOLD);
    expect(meta.lastError).toContain("TEST-SWEEP");

    const officers = await securityOfficerIds();
    expect(officers.length).toBeGreaterThan(0);
    const notifications = await sweeperNotifications();
    expect(notifications.map((n) => n.recipientUserId).sort((a, b) => a - b)).toEqual(officers);
    for (const n of notifications) {
      expect(n.notificationType).toBe("security_alert");
      expect(n.severity).toBe("urgent");
      expect(n.requiresAction).toBe(true);
    }
  });

  it("does not re-alert on further failures while an alert is outstanding", async () => {
    for (let i = 0; i < SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runSweepOnce(failingSweep);
    expect(await sweeperAuditEvents()).toHaveLength(1);

    // Two more failures past the threshold — still one alert, no new notifications.
    const before = (await sweeperNotifications()).length;
    for (let i = 0; i < 2; i++) {
      const r = await runSweepOnce(failingSweep);
      expect(r.alertRaised).toBe(false);
    }
    expect(await sweeperAuditEvents()).toHaveLength(1);
    expect(await sweeperNotifications()).toHaveLength(before);
  });

  it("raises a recovery notice once sweeps succeed again, and only once", async () => {
    for (let i = 0; i < SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runSweepOnce(failingSweep);

    const recovered = await runSweepOnce(passingSweep);
    expect(recovered.success).toBe(true);
    expect(recovered.recoveryRaised).toBe(true);

    const events = await sweeperAuditEvents();
    expect(events.map((e) => e.action)).toEqual([SWEEPER_ALERT_ACTION, SWEEPER_RECOVERED_ACTION]);

    const officers = await securityOfficerIds();
    const recoveryNotes = (await sweeperNotifications()).filter((n) => n.severity === "success");
    expect(recoveryNotes.map((n) => n.recipientUserId).sort((a, b) => a - b)).toEqual(officers);

    // Subsequent successes are quiet — no duplicate recovery.
    const again = await runSweepOnce(passingSweep);
    expect(again.recoveryRaised).toBe(false);
    expect(await sweeperAuditEvents()).toHaveLength(2);
  });

  it("raises a recovery after restart even though the in-memory streak was reset", async () => {
    for (let i = 0; i < SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runSweepOnce(failingSweep);
    // Simulate a process restart: in-memory streak gone, alert still in audit trail.
    _resetSweeperStateForTests();

    const r = await runSweepOnce(passingSweep);
    expect(r.recoveryRaised).toBe(true);
  });

  it("emits exactly one recovery when concurrent successful sweeps race", async () => {
    for (let i = 0; i < SWEEP_FAILURE_ALERT_THRESHOLD; i++) await runSweepOnce(failingSweep);

    const results = await Promise.all([
      runSweepOnce(passingSweep),
      runSweepOnce(passingSweep),
      runSweepOnce(passingSweep),
    ]);
    expect(results.filter((r) => r.recoveryRaised)).toHaveLength(1);
    const events = await sweeperAuditEvents();
    expect(events.filter((e) => e.action === SWEEPER_RECOVERED_ACTION)).toHaveLength(1);
  });

  it("keeps a successful sweep quiet when no alert was ever raised", async () => {
    const r = await runSweepOnce(passingSweep);
    expect(r).toEqual({ success: true, consecutiveFailures: 0, alertRaised: false, recoveryRaised: false });
    expect(await sweeperAuditEvents()).toHaveLength(0);
  });
});
