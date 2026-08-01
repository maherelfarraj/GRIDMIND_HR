/**
 * Privileged-session sweeper — periodically closes lapsed elevated-access
 * (break-glass) sessions server-side so records stay accurate even when no
 * security officer opens the Session Review screen. Reuses the same
 * idempotent, transactional sweep the review-list route runs lazily.
 */
import { sweepExpiredSessions } from "../routes/privilegedSessions.js";
import { logger } from "./logger.js";

const SWEEP_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let sweeping = false;

/** Starts the background sweeper. Called from index.ts (not from tests). */
export function startPrivilegedSessionSweeper(): void {
  if (timer) return;
  // Close anything that lapsed while the server was down, right away.
  sweepExpiredSessions().catch((err) =>
    logger.error({ err }, "Privileged-session startup sweep failed"),
  );
  timer = setInterval(() => {
    if (sweeping) return; // never overlap sweeps
    sweeping = true;
    sweepExpiredSessions()
      .catch((err) => logger.error({ err }, "Privileged-session sweep failed"))
      .finally(() => { sweeping = false; });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info({ sweepIntervalMs: SWEEP_INTERVAL_MS }, "Privileged-session sweeper started");
}
