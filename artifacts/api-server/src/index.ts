import app from "./app";
import { logger } from "./lib/logger";
import { startHealthMonitor, stopHealthMonitor } from "./lib/health-monitor";
import { startGatewaySilenceMonitor, stopGatewaySilenceMonitor } from "./lib/gatewayDeviceAlerts";
import {
  backfillMissedCommandOutcomeNotifications,
  flushDeferredCommandNotificationsWithTimeout,
  pendingDeferredCommandNotificationCount,
} from "./lib/deviceCommandNotifications";
import { startBackupScheduler, stopBackupScheduler } from "./lib/backupScheduler";
import { startPrivilegedSessionSweeper, stopPrivilegedSessionSweeper } from "./lib/privilegedSessionSweeper";
import { seedDemoPasswords } from "./lib/seed-passwords";
import { rotateLegacyGatewayKeys, rewrapGatewayKeysForPepperRotation, getPepperRotationStatus, sweepUnusableGatewayCredentials } from "./routes/attendanceGateway";
import { runStartupMigrations } from "./lib/startupMigrations";
import { markShuttingDown } from "./lib/shutdownState";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Schema must be in place before we accept any traffic.
await runStartupMigrations();

/** Upper bound on how long a graceful shutdown waits for deferred writes. */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

/** Upper bound on how long shutdown waits for in-flight HTTP requests to finish. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

/** Upper bound on how long shutdown waits for in-progress background sweeps to finish. */
const SHUTDOWN_MONITOR_STOP_TIMEOUT_MS = 10_000;

/**
 * Grace window between flipping /api/healthz to 503 and closing the listener,
 * so load balancers polling the health endpoint can observe "not ready" and
 * stop routing new traffic before connections start being refused.
 */
const SHUTDOWN_READINESS_GRACE_MS = 3_000;

/** Bounded sleep used for the readiness grace window. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * Stop every background monitor/scheduler: each stop clears its timer
 * immediately (no new sweeps start) and resolves once any in-progress sweep
 * has finished, so a redeploy never cuts a sweep off mid-database-write.
 * Bounded: resolves true when all stops finished within the timeout, false
 * if we gave up waiting on a long-running sweep.
 */
function stopBackgroundMonitors(timeoutMs: number): Promise<boolean> {
  const stops = Promise.all([
    stopHealthMonitor().catch((err) => logger.error({ err }, "Health monitor stop failed")),
    stopGatewaySilenceMonitor().catch((err) => logger.error({ err }, "Gateway silence monitor stop failed")),
    stopBackupScheduler().catch((err) => logger.error({ err }, "Backup scheduler stop failed")),
    stopPrivilegedSessionSweeper().catch((err) => logger.error({ err }, "Privileged-session sweeper stop failed")),
  ]).then(() => true);
  const timeout = new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    t.unref?.();
  });
  return Promise.race([stops, timeout]);
}

let shuttingDown = false;

/** HTTP listener handle, captured in main() so shutdown can drain it. */
let httpServer: import("node:http").Server | null = null;

/**
 * Stop accepting new connections and wait (bounded) for in-flight requests
 * to finish. Resolves true if the listener closed cleanly within the
 * timeout, false if we gave up waiting (or there was no listener yet).
 */
function drainHttpServer(timeoutMs: number): Promise<boolean> {
  const server = httpServer;
  if (!server) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    // Stops the listener from accepting new connections; the callback fires
    // once all existing connections (in-flight requests) have ended.
    server.close(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    });
    // Proactively end idle keep-alive connections so close() isn't held
    // open by sockets with no active request.
    server.closeIdleConnections?.();
  });
}

/**
 * Graceful shutdown (SIGTERM during a redeploy, SIGINT locally):
 * 1. Close the HTTP listener and drain in-flight requests (bounded) so a
 *    redeploy doesn't cut off responses mid-flight.
 * 2. Stop the background monitors/schedulers (bounded): clear their timers
 *    and await any sweep that is mid-database-write, so a redeploy doesn't
 *    leave partial state behind for the next run to clean up.
 * 3. Flush deferred command-outcome notification writes (bounded), which are
 *    scheduled off the request path and could otherwise be lost until the
 *    next boot's backfill sweep. The sweep remains the crash safety net.
 */
function handleShutdownSignal(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // Flip readiness FIRST: /api/healthz now answers 503 while the listener is
  // still open, so load balancers stop routing new traffic here before we
  // close the socket.
  markShuttingDown();
  const pending = pendingDeferredCommandNotificationCount();
  logger.info(
    { signal, pendingDeferredNotifications: pending },
    "Shutdown signal received — draining in-flight requests, stopping background monitors, then flushing deferred command notifications",
  );
  // Stop the monitors' timers right away (concurrently with the HTTP drain)
  // so no NEW sweep starts during shutdown; the promise resolves once any
  // in-progress sweep has finished its writes.
  const monitorsStopped = stopBackgroundMonitors(SHUTDOWN_MONITOR_STOP_TIMEOUT_MS);
  // Readiness grace: keep serving (healthz already 503) for a short window so
  // routers observe the not-ready state before the listener stops accepting.
  delay(SHUTDOWN_READINESS_GRACE_MS)
    .then(() => drainHttpServer(SHUTDOWN_DRAIN_TIMEOUT_MS))
    .then((drained) => {
      if (!drained) {
        logger.warn(
          { timeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
          "HTTP listener did not drain within the shutdown timeout — proceeding to flush and exit",
        );
      }
      return monitorsStopped;
    })
    .then((stopped) => {
      if (!stopped) {
        logger.warn(
          { timeoutMs: SHUTDOWN_MONITOR_STOP_TIMEOUT_MS },
          "Background monitors did not stop within the shutdown timeout — an in-progress sweep may be cut off; the next run will reconcile",
        );
      }
      return flushDeferredCommandNotificationsWithTimeout(SHUTDOWN_FLUSH_TIMEOUT_MS);
    })
    .then((flushed) => {
      if (!flushed) {
        logger.warn(
          { timeoutMs: SHUTDOWN_FLUSH_TIMEOUT_MS, remaining: pendingDeferredCommandNotificationCount() },
          "Deferred notification flush timed out at shutdown — remaining writes will be backfilled on next boot",
        );
      }
    })
    .catch((err) => logger.error({ err }, "Graceful shutdown drain/flush failed"))
    .finally(() => process.exit(0));
}

process.on("SIGTERM", handleShutdownSignal);
process.on("SIGINT", handleShutdownSignal);

async function main() {
  if (process.env.NODE_ENV === "production") {
    // Fail-closed: production credential hardening (random one-time
    // passwords + forced rotation of legacy demo credentials) must fully
    // succeed BEFORE the server accepts any traffic. If it fails — e.g.
    // the operator handoff file cannot be written — startup aborts and
    // the listener is never opened.
    try {
      await seedDemoPasswords();
    } catch (err) {
      logger.error({ err }, "Production credential hardening failed — aborting startup; the listener was not opened");
      process.exit(1);
    }
  }

  httpServer = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startHealthMonitor();
    startGatewaySilenceMonitor();
    startBackupScheduler();
    startPrivilegedSessionSweeper();
    // Restart-outcome notifications lost to a crash/restart between the
    // response and the deferred insert are backfilled from the command rows.
    backfillMissedCommandOutcomeNotifications()
      .then((backfilled) => {
        if (backfilled > 0) logger.info({ backfilled }, "Backfilled command outcome notifications missed across restart");
      })
      .catch((err) => logger.error({ err }, "Startup command outcome notification backfill failed"));
    if (process.env.NODE_ENV !== "production") {
      // Dev/demo provisioning is best-effort and non-blocking.
      seedDemoPasswords().catch((err) => {
        logger.error({ err }, "Failed to provision demo password hashes");
      });
    }
    rotateLegacyGatewayKeys()
      .then((rotated) => {
        if (rotated > 0) logger.info({ rotated }, "Rotated legacy gateway signing keys into vault envelopes");
      })
      .catch((err) => {
        logger.error({ err }, "Failed to rotate legacy gateway signing keys");
      });
    // Pepper rotation window: when GATEWAY_KEY_PEPPER_PREVIOUS is set,
    // re-wrap envelopes from the old pepper under the new one so gateways
    // keep authenticating without re-registration.
    rewrapGatewayKeysForPepperRotation()
      .then(({ rewrapped, unrecoverable }) => {
        if (rewrapped > 0) logger.info({ rewrapped }, "Re-wrapped gateway key envelopes under the new pepper");
        if (unrecoverable.length > 0) {
          logger.error(
            { registrationIds: unrecoverable },
            "Gateway key envelopes unrecoverable under current or previous pepper — these gateways must be re-registered",
          );
        }
        // Rotation-window hygiene: if the PREVIOUS pepper is still configured
        // but nothing needs it any more, the window has been left open — the
        // old pepper stays live and weakens the rotation until it is removed.
        return getPepperRotationStatus().then((status) => {
          if (status.windowOpen && status.rotationComplete) {
            logger.warn(
              { rewrappedThisStartup: rewrapped },
              "Gateway pepper rotation complete — all key envelopes are wrapped under the current pepper. Remove GATEWAY_KEY_PEPPER_PREVIOUS to close the rotation window; leaving it set keeps the old pepper live.",
            );
          }
        });
      })
      .catch((err) => {
        logger.error({ err }, "Failed to re-wrap gateway key envelopes for pepper rotation");
      })
      // After rotation/rewrap settle, persist the credential-unusable verdict
      // per registration so the admin gateway page can surface
      // "credential unusable — re-register" instead of a silent 401 loop.
      .then(() => sweepUnusableGatewayCredentials())
      .then(({ marked, cleared }) => {
        if (marked.length > 0) {
          logger.error(
            { registrationIds: marked },
            "Marked gateway registrations with unrecoverable credential envelopes — visible on the admin gateway page; these gateways must be re-registered",
          );
        }
        if (cleared.length > 0) {
          logger.info({ registrationIds: cleared }, "Cleared credential-unusable flag on gateway registrations whose envelopes decrypt again");
        }
      })
      .catch((err) => {
        logger.error({ err }, "Failed to sweep gateway registrations for unusable credentials");
      });
  });
}

await main();
