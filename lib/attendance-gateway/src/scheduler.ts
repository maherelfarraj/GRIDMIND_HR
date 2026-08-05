/**
 * runScheduler — self-scheduling tick loop for the attendance gateway.
 *
 * Design goals:
 *  - No double-scheduling: a single pending setTimeout at a time; each tick
 *    schedules exactly one successor.
 *  - On-demand nudge: when tick() reports testRequested=true, the next tick
 *    fires after nudgeIntervalMs instead of pollIntervalMs, so an admin-
 *    requested connection test resolves in seconds rather than waiting a full
 *    poll cycle.
 *  - No tight loop: nudgeIntervalMs is floored at MIN_NUDGE_INTERVAL_MS (5 s).
 *    If the server keeps reporting testRequested the gateway keeps nudging at
 *    that bounded rate, never faster.
 *  - Clean resumption: once tick() returns testRequested=false the normal
 *    pollIntervalMs cadence is restored automatically.
 */

export const MIN_NUDGE_INTERVAL_MS = 5_000;

export interface SchedulerHandle {
  stop(): void;
}

export function runScheduler(
  tick: () => Promise<{ testRequested: boolean }>,
  pollIntervalMs: number,
  nudgeIntervalMs: number,
): SchedulerHandle {
  // Apply the floor so callers cannot accidentally create a hot loop through
  // configuration, even when nudgeIntervalMs comes from a user-supplied env var.
  const effectiveNudgeMs = Math.max(nudgeIntervalMs, MIN_NUDGE_INTERVAL_MS);

  let stopped = false;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<void> => {
    pending = null;
    if (stopped) return;

    let testRequested = false;
    try {
      ({ testRequested } = await tick());
    } catch {
      // tick() is responsible for its own error handling and logging; we
      // absorb any leakage here so the scheduler loop never crashes.
    }

    if (!stopped) {
      const delay = testRequested ? effectiveNudgeMs : pollIntervalMs;
      pending = setTimeout(() => void run(), delay);
    }
  };

  // First tick fires immediately; subsequent ticks are self-scheduled.
  pending = setTimeout(() => void run(), 0);

  return {
    stop() {
      stopped = true;
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
    },
  };
}
