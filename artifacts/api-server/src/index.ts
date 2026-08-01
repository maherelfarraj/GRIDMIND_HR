import app from "./app";
import { logger } from "./lib/logger";
import { startHealthMonitor } from "./lib/health-monitor";
import { startGatewaySilenceMonitor } from "./lib/gatewayDeviceAlerts";
import {
  backfillMissedCommandOutcomeNotifications,
  flushDeferredCommandNotificationsWithTimeout,
  pendingDeferredCommandNotificationCount,
} from "./lib/deviceCommandNotifications";
import { startBackupScheduler } from "./lib/backupScheduler";
import { startPrivilegedSessionSweeper } from "./lib/privilegedSessionSweeper";
import { seedDemoPasswords } from "./lib/seed-passwords";
import { rotateLegacyGatewayKeys, rewrapGatewayKeysForPepperRotation, getPepperRotationStatus, sweepUnusableGatewayCredentials } from "./routes/attendanceGateway";
import { runStartupMigrations } from "./lib/startupMigrations";

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

let shuttingDown = false;

/**
 * Graceful shutdown (SIGTERM during a redeploy, SIGINT locally): deferred
 * command-outcome notification writes are scheduled off the request path, so
 * the process could otherwise exit with inserts still pending — leaving the
 * requester waiting for the next boot's backfill sweep. Flush them (bounded
 * by a short timeout) before exiting; the sweep remains the crash safety net.
 */
function handleShutdownSignal(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  const pending = pendingDeferredCommandNotificationCount();
  logger.info({ signal, pendingDeferredNotifications: pending }, "Shutdown signal received — flushing deferred command notifications");
  flushDeferredCommandNotificationsWithTimeout(SHUTDOWN_FLUSH_TIMEOUT_MS)
    .then((flushed) => {
      if (!flushed) {
        logger.warn(
          { timeoutMs: SHUTDOWN_FLUSH_TIMEOUT_MS, remaining: pendingDeferredCommandNotificationCount() },
          "Deferred notification flush timed out at shutdown — remaining writes will be backfilled on next boot",
        );
      }
    })
    .catch((err) => logger.error({ err }, "Deferred notification flush failed at shutdown"))
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

  app.listen(port, (err) => {
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
