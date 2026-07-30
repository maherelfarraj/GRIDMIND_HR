import app from "./app";
import { logger } from "./lib/logger";
import { startHealthMonitor } from "./lib/health-monitor";
import { seedDemoPasswords } from "./lib/seed-passwords";

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
  seedDemoPasswords().catch((err) => {
    logger.error({ err }, "Failed to provision demo password hashes");
  });
});
