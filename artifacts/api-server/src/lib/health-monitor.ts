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
import { and, eq, ilike, ne } from "drizzle-orm";
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
}

export interface HealthMonitorRunResult {
  checked: number;
  passed: number;
  failed: number;
  alertsRaised: number;
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

  const outcomes: HealthCheckOutcome[] = [];
  let alertsRaised = 0;

  for (const profile of profiles) {
    if (!options.force && !isDue(profile, now)) continue;

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
      alertsRaised += 1;
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

    outcomes.push({
      profileId: profile.id,
      profileName: profile.profileName,
      integrationType: profile.integrationType,
      success, simulated, message, latencyMs, consecutiveFailures, alertRaised,
    });
  }

  return {
    checked: outcomes.length,
    passed: outcomes.filter((o) => o.success).length,
    failed: outcomes.filter((o) => !o.success).length,
    alertsRaised,
    outcomes,
  };
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
