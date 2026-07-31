import app from "./app";
import { logger } from "./lib/logger";
import { startHealthMonitor } from "./lib/health-monitor";
import { startGatewaySilenceMonitor } from "./lib/gatewayDeviceAlerts";
import { seedDemoPasswords } from "./lib/seed-passwords";
import { rotateLegacyGatewayKeys } from "./routes/attendanceGateway";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startHealthMonitor();
  startGatewaySilenceMonitor();
  seedDemoPasswords().catch((err) => {
    logger.error({ err }, "Failed to provision demo password hashes");
  });
  rotateLegacyGatewayKeys()
    .then((rotated) => {
      if (rotated > 0) logger.info({ rotated }, "Rotated legacy gateway signing keys into vault envelopes");
    })
    .catch((err) => {
      logger.error({ err }, "Failed to rotate legacy gateway signing keys");
    });
});
