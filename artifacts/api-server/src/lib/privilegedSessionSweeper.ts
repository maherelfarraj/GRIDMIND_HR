/**
 * Privileged-session sweeper — periodically closes lapsed elevated-access
 * (break-glass) sessions server-side so records stay accurate even when no
 * security officer opens the Session Review screen. Reuses the same
 * idempotent, transactional sweep the review-list route runs lazily.
 *
 * Failure alerting: if the sweep fails several times in a row (e.g. DB
 * errors), records on the review screen may silently go stale. A streak of
 * failures past a threshold raises an audit event + in-app notifications for
 * Security Officer / Super Administrator roles, and a recovery notice is
 * raised when sweeps succeed again — via the shared background-job failure
 * alerter (see backgroundJobAlerts.ts for the audit-trail-derived state and
 * advisory-lock one-shot transition guarantees).
 */
import { sweepExpiredSessions } from "../routes/privilegedSessions.js";
import { logger } from "./logger.js";
import {
  createJobFailureAlerter,
  JOB_FAILURE_ALERT_THRESHOLD,
  type JobRunResult,
} from "./backgroundJobAlerts.js";

const SWEEP_INTERVAL_MS = 60_000;

/** Consecutive sweep failures before security officers are alerted. */
export const SWEEP_FAILURE_ALERT_THRESHOLD = JOB_FAILURE_ALERT_THRESHOLD;

// Audit-trail markers for the alert/recovery transition (entityId is null —
// the sweeper itself is the subject, not a particular session).
export const SWEEPER_ALERT_ACTION = "privileged_session_sweeper.alert";
export const SWEEPER_RECOVERED_ACTION = "privileged_session_sweeper.recovered";

const alerter = createJobFailureAlerter({
  entityType: "privileged_session_sweeper",
  alertAction: SWEEPER_ALERT_ACTION,
  recoveredAction: SWEEPER_RECOVERED_ACTION,
  // Arbitrary but stable app-defined advisory-lock key for this sweeper.
  lockKey: 0x5e55_10ce,
  threshold: SWEEP_FAILURE_ALERT_THRESHOLD,
  logLabel: "Privileged-session sweep",
  alertMessage: (failures, lastError) =>
    `The background privileged-session sweeper has failed ${failures} consecutive times. ` +
    `Lapsed elevated-access (break-glass) sessions may not be getting closed, so the Session ` +
    `Review screen may show stale records. Last error: ${lastError}`,
  recoveredMessage:
    "The background privileged-session sweeper has recovered and is closing lapsed " +
    "elevated-access sessions again. Session Review records are up to date as of the latest sweep.",
  notification: {
    alertTitleEn: "Privileged-session sweeper is failing",
    alertTitleAr: "توقف مُنهي الجلسات المميزة عن العمل",
    alertBodyAr: (failures) =>
      `فشل مُنهي الجلسات المميزة في الخلفية ${failures} مرات متتالية. قد لا يتم إغلاق جلسات الوصول المرتفع المنتهية، لذا قد تعرض شاشة مراجعة الجلسات سجلات قديمة.`,
    recoveredTitleEn: "Privileged-session sweeper recovered",
    recoveredTitleAr: "عاد مُنهي الجلسات المميزة إلى العمل",
    recoveredBodyAr:
      "عاد مُنهي الجلسات المميزة في الخلفية إلى العمل ويقوم بإغلاق الجلسات المنتهية مرة أخرى.",
    actionUrl: "/privileged-sessions",
    actionLabelEn: "Review privileged sessions",
  },
});

let timer: NodeJS.Timeout | null = null;
let sweeping = false;
/** In-progress sweep, so shutdown can await it instead of cutting it off mid-write. */
let inFlightSweep: Promise<void> | null = null;

/** Test-only: reset module state between test cases. */
export function _resetSweeperStateForTests(): void {
  alerter._resetForTests();
}

export type SweepRunResult = JobRunResult;

/**
 * Runs one sweep and updates the failure streak / alert state. Exported
 * separately from the scheduler so tests can drive it directly; `sweepFn`
 * is injectable so tests can simulate DB failures.
 */
export async function runSweepOnce(
  sweepFn: () => Promise<void> = sweepExpiredSessions,
): Promise<SweepRunResult> {
  return alerter.runMonitored(sweepFn);
}

/** Starts the background sweeper. Called from index.ts (not from tests). */
export function startPrivilegedSessionSweeper(): void {
  if (timer) return;
  // Close anything that lapsed while the server was down, right away.
  sweeping = true;
  inFlightSweep = runSweepOnce()
    .then(() => undefined)
    .catch((err) => logger.error({ err }, "Privileged-session startup sweep failed"))
    .finally(() => { sweeping = false; inFlightSweep = null; });
  timer = setInterval(() => {
    if (sweeping) return; // never overlap sweeps
    sweeping = true;
    inFlightSweep = runSweepOnce()
      .then(() => undefined)
      .catch((err) => logger.error({ err }, "Privileged-session sweep failed unexpectedly"))
      .finally(() => { sweeping = false; inFlightSweep = null; });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info({ sweepIntervalMs: SWEEP_INTERVAL_MS }, "Privileged-session sweeper started");
}

/**
 * Stops the sweeper: clears the interval (no new sweeps) and awaits any
 * sweep currently in flight so shutdown never cuts it off mid-write.
 */
export async function stopPrivilegedSessionSweeper(): Promise<void> {
  if (timer) { clearInterval(timer); timer = null; }
  if (inFlightSweep) await inFlightSweep;
}
