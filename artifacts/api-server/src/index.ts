import app from "./app";
import { logger } from "./lib/logger";
import { startHealthMonitor } from "./lib/health-monitor";
import { startGatewaySilenceMonitor } from "./lib/gatewayDeviceAlerts";
import { startBackupScheduler } from "./lib/backupScheduler";
import { startPrivilegedSessionSweeper } from "./lib/privilegedSessionSweeper";
import { seedDemoPasswords } from "./lib/seed-passwords";
import { rotateLegacyGatewayKeys, rewrapGatewayKeysForPepperRotation } from "./routes/attendanceGateway";
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
      })
      .catch((err) => {
        logger.error({ err }, "Failed to re-wrap gateway key envelopes for pepper rotation");
      });
  });
}

await main();
