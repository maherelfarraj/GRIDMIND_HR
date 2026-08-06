/**
 * Scheduled backup failure alerting — a single backup failure raises an
 * audit event + notifications for Security Officer / Super Administrator
 * roles (threshold is 1 because the job runs nightly — one missed backup
 * is a day of missing coverage). Repeated failures don't re-alert. A
 * recovery notice is raised exactly once when a backup completes successfully
 * again after an alert was outstanding.
 *
 * Mirrors sweeper-failure-alerts.test.ts via the shared background-job
 * failure alerter (backgroundJobAlerts.ts).
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
  runMonitoredBackupCycle,
  BACKUP_FAILURE_ALERT_THRESHOLD,
  BACKUP_ALERT_ACTION,
  BACKUP_RECOVERED_ACTION,
  _resetBackupAlerterForTests,
} from "../lib/backupScheduler.js";

const ENTITY_TYPE = "scheduled_backup";

const failingBackup = () => Promise.reject(new Error("TEST-BACKUP: pg_dump unavailable"));
const passingBackup = () => Promise.resolve();

async function cleanupRecords() {
  await db.delete(notificationsTable).where(eq(notificationsTable.entityType, ENTITY_TYPE));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.entityType, ENTITY_TYPE));
}

async function backupAuditEvents() {
  return db.select().from(auditLogsTable).where(and(
    eq(auditLogsTable.entityType, ENTITY_TYPE),
    inArray(auditLogsTable.action, [BACKUP_ALERT_ACTION, BACKUP_RECOVERED_ACTION]),
  ));
}

async function backupNotifications() {
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
  _resetBackupAlerterForTests();
  await cleanupRecords();
});

afterAll(cleanupRecords);

describe("scheduled backup failure alerting", () => {
  it("alerts security officers on the first failure (threshold is 1 for nightly jobs)", async () => {
    expect(BACKUP_FAILURE_ALERT_THRESHOLD).toBe(1);

    const r = await runMonitoredBackupCycle(failingBackup);
    expect(r.success).toBe(false);
    expect(r.consecutiveFailures).toBe(1);
    expect(r.alertRaised).toBe(true);

    const events = await backupAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(BACKUP_ALERT_ACTION);
    const meta = JSON.parse(events[0].changesJson ?? "{}");
    expect(meta.consecutiveFailures).toBe(1);
    expect(meta.lastError).toContain("TEST-BACKUP");

    const officers = await securityOfficerIds();
    expect(officers.length).toBeGreaterThan(0);
    const notifications = await backupNotifications();
    expect(notifications.map((n) => n.recipientUserId).sort((a, b) => a - b)).toEqual(officers);
    for (const n of notifications) {
      expect(n.notificationType).toBe("security_alert");
      expect(n.severity).toBe("urgent");
      expect(n.requiresAction).toBe(true);
      expect(n.actionUrl).toBe("/admin/backups");
    }
  });

  it("does not re-alert on further failures while an alert is outstanding", async () => {
    // First failure raises the alert.
    await runMonitoredBackupCycle(failingBackup);
    expect(await backupAuditEvents()).toHaveLength(1);
    const notifsBefore = (await backupNotifications()).length;

    // Two more failures — still one alert event, no new notifications.
    for (let i = 0; i < 2; i++) {
      const r = await runMonitoredBackupCycle(failingBackup);
      expect(r.alertRaised).toBe(false);
    }
    expect(await backupAuditEvents()).toHaveLength(1);
    expect(await backupNotifications()).toHaveLength(notifsBefore);
  });

  it("raises a recovery notice once backups succeed again, and only once", async () => {
    await runMonitoredBackupCycle(failingBackup);

    const recovered = await runMonitoredBackupCycle(passingBackup);
    expect(recovered.success).toBe(true);
    expect(recovered.recoveryRaised).toBe(true);

    const events = await backupAuditEvents();
    expect(events.map((e) => e.action)).toEqual([BACKUP_ALERT_ACTION, BACKUP_RECOVERED_ACTION]);

    const officers = await securityOfficerIds();
    const recoveryNotes = (await backupNotifications()).filter((n) => n.severity === "success");
    expect(recoveryNotes.map((n) => n.recipientUserId).sort((a, b) => a - b)).toEqual(officers);

    // Subsequent successes are quiet — no duplicate recovery.
    const again = await runMonitoredBackupCycle(passingBackup);
    expect(again.recoveryRaised).toBe(false);
    expect(await backupAuditEvents()).toHaveLength(2);
  });

  it("raises a recovery after restart even though the in-memory streak was reset", async () => {
    await runMonitoredBackupCycle(failingBackup);
    // Simulate a process restart: in-memory streak gone, alert still in audit trail.
    _resetBackupAlerterForTests();

    const r = await runMonitoredBackupCycle(passingBackup);
    expect(r.recoveryRaised).toBe(true);
  });

  it("emits exactly one recovery when concurrent successful cycles race", async () => {
    await runMonitoredBackupCycle(failingBackup);

    const results = await Promise.all([
      runMonitoredBackupCycle(passingBackup),
      runMonitoredBackupCycle(passingBackup),
      runMonitoredBackupCycle(passingBackup),
    ]);
    expect(results.filter((r) => r.recoveryRaised)).toHaveLength(1);
    const events = await backupAuditEvents();
    expect(events.filter((e) => e.action === BACKUP_RECOVERED_ACTION)).toHaveLength(1);
  });

  it("keeps a successful cycle quiet when no alert was ever raised", async () => {
    const r = await runMonitoredBackupCycle(passingBackup);
    expect(r).toEqual({ success: true, consecutiveFailures: 0, alertRaised: false, recoveryRaised: false });
    expect(await backupAuditEvents()).toHaveLength(0);
  });

  it("keeps backup alert state independent from other background jobs", async () => {
    const { runSweepOnce, _resetSweeperStateForTests } = await import(
      "../lib/privilegedSessionSweeper.js"
    );
    _resetSweeperStateForTests();

    // Raise a backup alert.
    await runMonitoredBackupCycle(failingBackup);
    expect(await backupAuditEvents()).toHaveLength(1);

    // A successful privileged-session sweep must NOT claim the backup alert.
    const r = await runSweepOnce(() => Promise.resolve());
    expect(r.recoveryRaised).toBe(false);
    const events = await backupAuditEvents();
    expect(events.filter((e) => e.action === BACKUP_RECOVERED_ACTION)).toHaveLength(0);
  });
});
