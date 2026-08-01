/**
 * Privileged-session sweeper — periodically closes lapsed elevated-access
 * (break-glass) sessions server-side so records stay accurate even when no
 * security officer opens the Session Review screen. Reuses the same
 * idempotent, transactional sweep the review-list route runs lazily.
 *
 * Failure alerting: if the sweep fails several times in a row (e.g. DB
 * errors), records on the review screen may silently go stale. Following the
 * connection health monitor's pattern, a streak of failures past a threshold
 * raises an audit event + in-app notifications for Security Officer / Super
 * Administrator roles, and a recovery notice is raised when sweeps succeed
 * again. The outstanding-alert state is derived from the audit trail (latest
 * alert vs recovered event) and transitions are claimed under an advisory
 * lock, so concurrent paths can never emit duplicate notices.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  notificationsTable,
  systemUsersTable,
  rolesTable,
} from "@workspace/db";
import { sweepExpiredSessions } from "../routes/privilegedSessions.js";
import { logger } from "./logger.js";

const SWEEP_INTERVAL_MS = 60_000;

/** Consecutive sweep failures before security officers are alerted. */
export const SWEEP_FAILURE_ALERT_THRESHOLD = 3;

// Audit-trail markers for the alert/recovery transition (entityId is null —
// the sweeper itself is the subject, not a particular session).
export const SWEEPER_ALERT_ACTION = "privileged_session_sweeper.alert";
export const SWEEPER_RECOVERED_ACTION = "privileged_session_sweeper.recovered";
const SWEEPER_ENTITY_TYPE = "privileged_session_sweeper";

// Serializes alert/recovery transition claims across concurrent callers
// (arbitrary but stable app-defined advisory-lock key for this sweeper).
const SWEEPER_LOCK_KEY = 0x5e55_10ce;

// Roles that watch the Session Review screen and must know when its
// underlying sweeper stops working.
const SECURITY_ALERT_ROLES = ["Super Administrator", "Security Officer"] as const;

let timer: NodeJS.Timeout | null = null;
let sweeping = false;
// In-memory failure streak. Resets on restart, which is the right behavior:
// a fresh process hasn't failed yet, and the startup sweep immediately
// re-exercises the same path.
let consecutiveFailures = 0;

/** Test-only: reset module state between test cases. */
export function _resetSweeperStateForTests(): void {
  consecutiveFailures = 0;
}

async function getSecurityOfficerUserIds(
  tx: Pick<typeof db, "select"> = db,
): Promise<number[]> {
  const rows = await tx
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(
      eq(systemUsersTable.isActive, true),
      inArray(rolesTable.nameEn, [...SECURITY_ALERT_ROLES]),
    ));
  return rows.map((r) => r.id);
}

/**
 * Latest alert/recovered event decides whether an alert is outstanding —
 * derived from the audit trail, not from counters, so a recovery notice
 * fires only when an alert was actually raised.
 */
async function hasOutstandingAlert(tx: Pick<typeof db, "select">): Promise<boolean> {
  const [latest] = await tx
    .select({ action: auditLogsTable.action })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.entityType, SWEEPER_ENTITY_TYPE),
      inArray(auditLogsTable.action, [SWEEPER_ALERT_ACTION, SWEEPER_RECOVERED_ACTION]),
    ))
    .orderBy(desc(auditLogsTable.id))
    .limit(1);
  return latest?.action === SWEEPER_ALERT_ACTION;
}

/**
 * Raises the failure alert (audit event + notifications) unless one is
 * already outstanding. Claimed atomically under an advisory lock so two
 * concurrent failing paths emit exactly one alert.
 */
async function raiseSweepFailureAlert(failures: number, lastError: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SWEEPER_LOCK_KEY})`);
    if (await hasOutstandingAlert(tx)) return false;

    const message =
      `The background privileged-session sweeper has failed ${failures} consecutive times. ` +
      `Lapsed elevated-access (break-glass) sessions may not be getting closed, so the Session ` +
      `Review screen may show stale records. Last error: ${lastError}`;

    await tx.insert(auditLogsTable).values({
      actorUserId: null,
      action: SWEEPER_ALERT_ACTION,
      entityType: SWEEPER_ENTITY_TYPE,
      entityId: null,
      entityLabel: "sweep failures",
      changesJson: JSON.stringify({
        consecutiveFailures: failures,
        threshold: SWEEP_FAILURE_ALERT_THRESHOLD,
        lastError,
      }),
    });

    const officerIds = await getSecurityOfficerUserIds(tx);
    if (officerIds.length) {
      await tx.insert(notificationsTable).values(officerIds.map((userId) => ({
        recipientUserId: userId,
        notificationType: "security_alert",
        titleEn: "Privileged-session sweeper is failing",
        titleAr: "توقف مُنهي الجلسات المميزة عن العمل",
        bodyEn: message,
        bodyAr: `فشل مُنهي الجلسات المميزة في الخلفية ${failures} مرات متتالية. قد لا يتم إغلاق جلسات الوصول المرتفع المنتهية، لذا قد تعرض شاشة مراجعة الجلسات سجلات قديمة.`,
        severity: "urgent",
        actionUrl: "/privileged-sessions",
        actionLabelEn: "Review privileged sessions",
        entityType: SWEEPER_ENTITY_TYPE,
        entityId: null,
        requiresAction: true,
      })));
    }
    return true;
  });
}

/**
 * Raises the recovery notice iff an alert is actually outstanding (atomic
 * claim under the same advisory lock). Returns true when this call raised it.
 */
async function raiseSweepRecoveryIfAlerted(): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SWEEPER_LOCK_KEY})`);
    if (!(await hasOutstandingAlert(tx))) return false;

    const message =
      "The background privileged-session sweeper has recovered and is closing lapsed " +
      "elevated-access sessions again. Session Review records are up to date as of the latest sweep.";

    await tx.insert(auditLogsTable).values({
      actorUserId: null,
      action: SWEEPER_RECOVERED_ACTION,
      entityType: SWEEPER_ENTITY_TYPE,
      entityId: null,
      entityLabel: "sweep recovered",
      changesJson: JSON.stringify({ threshold: SWEEP_FAILURE_ALERT_THRESHOLD }),
    });

    const officerIds = await getSecurityOfficerUserIds(tx);
    if (officerIds.length) {
      await tx.insert(notificationsTable).values(officerIds.map((userId) => ({
        recipientUserId: userId,
        notificationType: "security_alert",
        titleEn: "Privileged-session sweeper recovered",
        titleAr: "عاد مُنهي الجلسات المميزة إلى العمل",
        bodyEn: message,
        bodyAr: "عاد مُنهي الجلسات المميزة في الخلفية إلى العمل ويقوم بإغلاق الجلسات المنتهية مرة أخرى.",
        severity: "success",
        actionUrl: "/privileged-sessions",
        actionLabelEn: "Review privileged sessions",
        entityType: SWEEPER_ENTITY_TYPE,
        entityId: null,
        requiresAction: false,
      })));
    }
    return true;
  });
}

export interface SweepRunResult {
  success: boolean;
  consecutiveFailures: number;
  alertRaised: boolean;
  recoveryRaised: boolean;
}

/**
 * Runs one sweep and updates the failure streak / alert state. Exported
 * separately from the scheduler so tests can drive it directly; `sweepFn`
 * is injectable so tests can simulate DB failures.
 */
export async function runSweepOnce(
  sweepFn: () => Promise<void> = sweepExpiredSessions,
): Promise<SweepRunResult> {
  try {
    await sweepFn();
  } catch (err) {
    consecutiveFailures += 1;
    logger.error({ err, consecutiveFailures }, "Privileged-session sweep failed");
    let alertRaised = false;
    // Alert once when the streak reaches the threshold; the outstanding-alert
    // check keeps later failures from re-alerting even after a restart.
    if (consecutiveFailures >= SWEEP_FAILURE_ALERT_THRESHOLD) {
      try {
        alertRaised = await raiseSweepFailureAlert(
          consecutiveFailures,
          err instanceof Error ? err.message : String(err),
        );
        if (alertRaised) {
          logger.warn({ consecutiveFailures }, "Privileged-session sweeper failure alert raised");
        }
      } catch (alertErr) {
        // Likely the same DB outage that broke the sweep — the next failing
        // sweep retries the alert (streak stays past the threshold).
        logger.error({ err: alertErr }, "Failed to raise privileged-session sweeper alert");
      }
    }
    return { success: false, consecutiveFailures, alertRaised, recoveryRaised: false };
  }

  const hadFailures = consecutiveFailures > 0;
  consecutiveFailures = 0;
  let recoveryRaised = false;
  // Check even without in-memory failures: after a restart the streak resets
  // but an alert raised by the previous process may still be outstanding.
  try {
    recoveryRaised = await raiseSweepRecoveryIfAlerted();
    if (recoveryRaised) {
      logger.info({ hadFailures }, "Privileged-session sweeper recovery notice raised");
    }
  } catch (recoveryErr) {
    logger.error({ err: recoveryErr }, "Failed to raise privileged-session sweeper recovery notice");
  }
  return { success: true, consecutiveFailures: 0, alertRaised: false, recoveryRaised };
}

/** Starts the background sweeper. Called from index.ts (not from tests). */
export function startPrivilegedSessionSweeper(): void {
  if (timer) return;
  // Close anything that lapsed while the server was down, right away.
  runSweepOnce().catch((err) =>
    logger.error({ err }, "Privileged-session startup sweep failed"),
  );
  timer = setInterval(() => {
    if (sweeping) return; // never overlap sweeps
    sweeping = true;
    runSweepOnce()
      .catch((err) => logger.error({ err }, "Privileged-session sweep failed unexpectedly"))
      .finally(() => { sweeping = false; });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info({ sweepIntervalMs: SWEEP_INTERVAL_MS }, "Privileged-session sweeper started");
}
