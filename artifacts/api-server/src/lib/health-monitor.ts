/**
 * Connection health monitor — periodically runs the existing connection tests
 * for integration connection profiles that have health monitoring enabled,
 * tracks consecutive failures, and alerts admins (in-app notification +
 * integration audit "health_alert" event) when the failure streak reaches the
 * profile's alertOnFailureCount threshold.
 *
 * Air-gap safe: uses only the local adapters (LDAP/AD, SMTP, attendance
 * device) and the local DB. No external cloud dependencies.
 */
import { and, desc, eq, ilike, inArray, ne } from "drizzle-orm";
import {
  db,
  integrationConnectionProfilesTable,
  integrationAuditLogTable,
  notificationsTable,
  systemUsersTable,
  rolesTable,
  type IntegrationConnectionProfile,
} from "@workspace/db";
import { testLdapConnection, type AdapterResult } from "./ldap-adapter.js";
import { testSmtpConnection } from "./smtp-adapter.js";
import { testDeviceConnection } from "./device-adapter.js";
import { logger } from "./logger.js";

export interface HealthCheckOutcome {
  profileId: number;
  profileName: string;
  integrationType: string;
  success: boolean;
  simulated: boolean;
  message: string;
  latencyMs: number;
  consecutiveFailures: number;
  alertRaised: boolean;
  recoveryRaised: boolean;
}

export interface HealthMonitorRunResult {
  checked: number;
  passed: number;
  failed: number;
  alertsRaised: number;
  recoveriesRaised: number;
  outcomes: HealthCheckOutcome[];
}

/** Runs the same adapter logic as the manual Test button. */
export async function runConnectionTest(
  profile: Pick<IntegrationConnectionProfile, "integrationType" | "governanceStatus">,
): Promise<{ success: boolean; message: string; latencyMs: number; simulated: boolean }> {
  if (profile.governanceStatus === "suspended") {
    return { success: false, message: "Profile is suspended", latencyMs: 0, simulated: false };
  }
  let result: AdapterResult | null = null;
  switch (profile.integrationType) {
    case "ldap":
    case "active_directory":
      result = await testLdapConnection();
      break;
    case "smtp":
      result = await testSmtpConnection();
      break;
    case "attendance_device":
      result = await testDeviceConnection();
      break;
  }
  if (result) {
    return { success: result.success, message: result.message, latencyMs: result.latencyMs, simulated: false };
  }
  // No real adapter for this integration type yet — simulated (air-gap safe).
  return {
    success: true,
    message: "Connection test simulated successfully (no real adapter for this integration type)",
    latencyMs: Math.floor(Math.random() * 200) + 50,
    simulated: true,
  };
}

/** Active system users whose role name contains "admin" (System Administrator, HR Admin, ...). */
async function getAdminUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
  return rows.map((r) => r.id);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Atomically claims and closes an outstanding health alert for a profile.
 *
 * The alerted state is derived from the audit trail (its most recent
 * health_alert / health_recovered event is a health_alert), NOT from
 * comparing the failure count against the current threshold — so recovery
 * notices fire only when an alert was actually raised, even if the threshold
 * has been edited since.
 *
 * Runs inside a transaction that takes a row lock on the profile before
 * re-checking the alert state, so concurrent successful checks (scheduled
 * sweep overlapping a manual test, or two manual tests) serialize and only
 * one of them emits the "health_recovered" audit event + admin notifications.
 *
 * Returns true when this call raised the recovery notice. Shared by the
 * scheduled health monitor and the manual connection-test endpoint so a
 * recovery is never silently lost, whichever path clears the streak.
 */
export async function raiseHealthRecoveryIfAlerted(
  profile: IntegrationConnectionProfile,
  details: { message: string; latencyMs: number; simulated: boolean; actorUserId?: number | null },
): Promise<boolean> {
  const raised = await db.transaction(async (tx) => {
    // Serialize concurrent recovery attempts on this profile.
    await tx
      .select({ id: integrationConnectionProfilesTable.id })
      .from(integrationConnectionProfilesTable)
      .where(eq(integrationConnectionProfilesTable.id, profile.id))
      .for("update");

    // Re-check the outstanding-alert state under the lock.
    const [latest] = await tx
      .select({ eventType: integrationAuditLogTable.eventType })
      .from(integrationAuditLogTable)
      .where(and(
        eq(integrationAuditLogTable.profileId, profile.id),
        inArray(integrationAuditLogTable.eventType, ["health_alert", "health_recovered"]),
      ))
      .orderBy(desc(integrationAuditLogTable.id))
      .limit(1);
    if (latest?.eventType !== "health_alert") return false;

    const recoveryMessage = `Connection "${profile.profileName}" (${profile.integrationType}) has recovered after ${profile.consecutiveFailures} consecutive failed health checks. Latest check passed: ${details.message}`;

    await tx.insert(integrationAuditLogTable).values({
      profileId: profile.id,
      integrationType: profile.integrationType,
      eventType: "health_recovered",
      outcome: "success",
      message: recoveryMessage,
      metadataJson: JSON.stringify({
        previousConsecutiveFailures: profile.consecutiveFailures,
        alertOnFailureCount: profile.alertOnFailureCount,
        latencyMs: details.latencyMs,
        simulated: details.simulated,
        source: details.actorUserId ? "manual_test" : "health_monitor",
      }),
      actorUserId: details.actorUserId ?? null,
    });

    const adminRows = await tx
      .select({ id: systemUsersTable.id })
      .from(systemUsersTable)
      .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
      .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
    if (adminRows.length) {
      await tx.insert(notificationsTable).values(adminRows.map(({ id: userId }) => ({
        recipientUserId: userId,
        notificationType: "security_alert",
        titleEn: `Integration recovered: ${profile.profileName}`,
        titleAr: `تعافى التكامل: ${profile.profileNameAr}`,
        bodyEn: recoveryMessage,
        bodyAr: `تعافى الاتصال "${profile.profileNameAr}" (${profile.integrationType}) بعد ${profile.consecutiveFailures} فحوصات صحية فاشلة متتالية.`,
        severity: "success",
        actionUrl: "/integration-governance",
        actionLabelEn: "View connection profiles",
        entityType: "connection_profile",
        entityId: profile.id,
        requiresAction: false,
      })));
    }
    return true;
  });

  if (raised) {
    logger.info(
      { profileId: profile.id, previousConsecutiveFailures: profile.consecutiveFailures },
      "Integration health recovery notice raised",
    );
  }
  return raised;
}

/**
 * Runs the connection test, honoring the profile's retry policy: when the
 * initial attempt fails and retryEnabled is true, retries up to
 * retryMaxAttempts with retryBackoffSeconds between attempts. Each retry
 * logs a "retry_triggered" integration audit event. Only if every attempt
 * fails does the sweep count the check as a failure.
 */
async function runConnectionTestWithRetry(
  profile: IntegrationConnectionProfile,
): Promise<{ success: boolean; message: string; latencyMs: number; simulated: boolean; attempts: number }> {
  let attempt = await runConnectionTest(profile);
  let attempts = 1;
  if (attempt.success || !profile.retryEnabled) return { ...attempt, attempts };

  const maxRetries = Math.max(0, profile.retryMaxAttempts);
  const backoffMs = Math.max(0, profile.retryBackoffSeconds) * 1000;

  for (let retry = 1; retry <= maxRetries; retry++) {
    await db.insert(integrationAuditLogTable).values({
      profileId: profile.id,
      integrationType: profile.integrationType,
      eventType: "retry_triggered",
      outcome: "success",
      message: `Health check failed ("${attempt.message}") — retry ${retry} of ${maxRetries} scheduled with ${profile.retryBackoffSeconds}s backoff`,
      metadataJson: JSON.stringify({
        retryAttempt: retry,
        retryMaxAttempts: maxRetries,
        retryBackoffSeconds: profile.retryBackoffSeconds,
        source: "health_monitor",
      }),
      actorUserId: null,
    });
    logger.info({ profileId: profile.id, retry, maxRetries }, "Health check retry triggered");

    if (backoffMs > 0) await sleep(backoffMs);
    attempt = await runConnectionTest(profile);
    attempts += 1;
    if (attempt.success) break;
  }
  return { ...attempt, attempts };
}

function isDue(profile: IntegrationConnectionProfile, now: Date): boolean {
  if (!profile.lastTestedAt) return true;
  const intervalMs = Math.max(1, profile.healthCheckIntervalMinutes) * 60_000;
  return now.getTime() - new Date(profile.lastTestedAt).getTime() >= intervalMs;
}

/**
 * Runs one sweep of health checks over all monitored profiles that are due.
 * Exported separately from the scheduler so it can be triggered manually
 * (POST /integration-governance/health-checks/run) and tested directly.
 */
export async function runHealthChecksOnce(
  options: { force?: boolean } = {},
): Promise<HealthMonitorRunResult> {
  const now = new Date();
  const profiles = await db
    .select()
    .from(integrationConnectionProfilesTable)
    .where(and(
      eq(integrationConnectionProfilesTable.isHealthMonitoringEnabled, true),
      ne(integrationConnectionProfilesTable.governanceStatus, "suspended"),
    ));

  const due = profiles.filter((profile) => options.force || isDue(profile, now));

  // Check profiles concurrently so one slow profile (e.g. a failing connection
  // retrying with long backoffs) cannot delay health checks for the others.
  // Sweeps still never overlap each other (see startHealthMonitor).
  const settled = await Promise.all(due.map(async (profile): Promise<HealthCheckOutcome | null> => {
    try {
      return await checkProfile(profile, now);
    } catch (err) {
      logger.error({ err, profileId: profile.id }, "Health check failed for profile");
      return null;
    }
  }));

  const outcomes = settled.filter((o): o is HealthCheckOutcome => o !== null);

  return {
    checked: outcomes.length,
    passed: outcomes.filter((o) => o.success).length,
    failed: outcomes.filter((o) => !o.success).length,
    alertsRaised: outcomes.filter((o) => o.alertRaised).length,
    recoveriesRaised: outcomes.filter((o) => o.recoveryRaised).length,
    outcomes,
  };
}

/** Runs the full check → persist → alert/recover pipeline for one profile. */
async function checkProfile(
  profile: IntegrationConnectionProfile,
  now: Date,
): Promise<HealthCheckOutcome> {
  {
    const { success, message, latencyMs, simulated, attempts } = await runConnectionTestWithRetry(profile);
    const consecutiveFailures = success ? 0 : profile.consecutiveFailures + 1;
    // Alert exactly when the streak reaches the threshold (avoid re-alerting
    // on every subsequent failed sweep).
    const alertRaised = !success && consecutiveFailures === profile.alertOnFailureCount;

    await db.update(integrationConnectionProfilesTable).set({
      lastTestResult: success ? "success" : "failure",
      lastTestMessage: message,
      lastTestedAt: now,
      lastTestedByUserId: null, // automated check — no human actor
      lastTestLatencyMs: latencyMs,
      lastTestSimulated: simulated,
      status: success ? "active" : "error",
      consecutiveFailures,
      updatedAt: new Date(),
    }).where(eq(integrationConnectionProfilesTable.id, profile.id));

    await db.insert(integrationAuditLogTable).values({
      profileId: profile.id,
      integrationType: profile.integrationType,
      eventType: success ? "test_passed" : "test_failed",
      outcome: success ? "success" : "failure",
      message,
      metadataJson: JSON.stringify({ latencyMs, simulated, source: "health_monitor", consecutiveFailures, attempts }),
      actorUserId: null,
    });

    if (alertRaised) {
      const alertMessage = `Connection "${profile.profileName}" (${profile.integrationType}) failed ${consecutiveFailures} consecutive health checks. Last error: ${message}`;

      await db.insert(integrationAuditLogTable).values({
        profileId: profile.id,
        integrationType: profile.integrationType,
        eventType: "health_alert",
        outcome: "failure",
        message: alertMessage,
        metadataJson: JSON.stringify({ consecutiveFailures, alertOnFailureCount: profile.alertOnFailureCount, source: "health_monitor" }),
        actorUserId: null,
      });

      const adminIds = await getAdminUserIds();
      if (adminIds.length) {
        await db.insert(notificationsTable).values(adminIds.map((userId) => ({
          recipientUserId: userId,
          notificationType: "security_alert",
          titleEn: `Integration health alert: ${profile.profileName}`,
          titleAr: `تنبيه صحة التكامل: ${profile.profileNameAr}`,
          bodyEn: alertMessage,
          bodyAr: `فشل الاتصال "${profile.profileNameAr}" (${profile.integrationType}) في ${consecutiveFailures} فحوصات صحية متتالية.`,
          severity: "urgent",
          actionUrl: "/integration-governance",
          actionLabelEn: "View connection profiles",
          entityType: "connection_profile",
          entityId: profile.id,
          requiresAction: true,
        })));
      }
      logger.warn({ profileId: profile.id, consecutiveFailures }, "Integration health alert raised");
    }

    // Recovery closes the loop: raised only when this profile has an actual
    // outstanding health alert (atomic claim — safe against a concurrent
    // manual test racing this sweep).
    const recoveryRaised = success
      ? await raiseHealthRecoveryIfAlerted(profile, { message, latencyMs, simulated })
      : false;

    return {
      profileId: profile.id,
      profileName: profile.profileName,
      integrationType: profile.integrationType,
      success, simulated, message, latencyMs, consecutiveFailures, alertRaised, recoveryRaised,
    };
  }
}

const SWEEP_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let sweeping = false;

/** Starts the background scheduler. Called from index.ts (not from tests). */
export function startHealthMonitor(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (sweeping) return; // never overlap sweeps
    sweeping = true;
    runHealthChecksOnce()
      .then((r) => {
        if (r.checked > 0) logger.info({ checked: r.checked, failed: r.failed, alertsRaised: r.alertsRaised }, "Health monitor sweep completed");
      })
      .catch((err) => logger.error({ err }, "Health monitor sweep failed"))
      .finally(() => { sweeping = false; });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info({ sweepIntervalMs: SWEEP_INTERVAL_MS }, "Connection health monitor started");
}

export function stopHealthMonitor(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
