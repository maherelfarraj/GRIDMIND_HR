import express from "express";
import { EncryptedQueue } from "./queue.js";
import { HrClient } from "./hrClient.js";
import { GatewayService } from "./service.js";
import { deriveSigningKey } from "./signing.js";
import { SimulatorAdapter } from "./adapters/simulator.js";
import { GenericRestAdapter } from "./adapters/genericRest.js";
import { CsvAdapter } from "./adapters/csv.js";
import { ZktecoAdapter, SupremaAdapter, zktecoConfigFromEnv, supremaConfigFromEnv } from "./adapters/vendorStubs.js";
import type { DeviceAdapter } from "./types.js";

/**
 * Attendance Gateway entrypoint — runs inside the customer network.
 *
 * Required environment:
 *   HR_API_URL          e.g. http://hr-core.local:8080/api
 *   GATEWAY_ID          registration id issued by the HR core admin screen
 *   GATEWAY_SECRET      one-time secret shown at registration
 *   GATEWAY_QUEUE_KEY   local encryption key for the punch spool
 * Optional:
 *   GATEWAY_ADAPTER     SIMULATOR | GENERIC_REST | CSV | ZKTECO | SUPREMA
 *   DEVICE_API_URL/KEY  for GENERIC_REST
 *   ZKTECO_API_URL/ZKTECO_USERNAME/ZKTECO_PASSWORD    for ZKTECO (ZKBioTime/BioTime middleware)
 *   SUPREMA_API_URL/SUPREMA_LOGIN_ID/SUPREMA_PASSWORD for SUPREMA (BioStar 2 server)
 *   GATEWAY_QUEUE_DIR   spool directory (default ./gateway-queue)
 *   POLL_INTERVAL_MS    device poll cadence (default 60000)
 *   PORT                local admin/status HTTP port
 */
function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function buildAdapter(): DeviceAdapter {
  const kind = (process.env.GATEWAY_ADAPTER ?? "SIMULATOR").toUpperCase();
  switch (kind) {
    case "GENERIC_REST":
      return new GenericRestAdapter(requiredEnv("DEVICE_API_URL"), process.env.DEVICE_API_KEY);
    case "CSV":
      return new CsvAdapter();
    case "ZKTECO":
      return new ZktecoAdapter(zktecoConfigFromEnv());
    case "SUPREMA":
      return new SupremaAdapter(supremaConfigFromEnv());
    default:
      return new SimulatorAdapter();
  }
}

async function main(): Promise<void> {
  const adapter = buildAdapter();
  const queue = new EncryptedQueue(process.env.GATEWAY_QUEUE_DIR ?? "./gateway-queue", requiredEnv("GATEWAY_QUEUE_KEY"));
  await queue.init();
  const hr = new HrClient({
    hrApiUrl: requiredEnv("HR_API_URL"),
    gatewayId: parseInt(requiredEnv("GATEWAY_ID"), 10),
    signingKey: deriveSigningKey(requiredEnv("GATEWAY_SECRET")),
  });
  const queueDir = process.env.GATEWAY_QUEUE_DIR ?? "./gateway-queue";
  const service = new GatewayService(queue, hr, adapter, { cursorPath: `${queueDir}/device-cursor.json` });
  await service.init();

  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS ?? "60000", 10);
  const tick = async (): Promise<void> => {
    try {
      await service.pollOnce();
      await service.flush();
      await hr.heartbeat((await adapter.testConnection()).message);
    } catch (e) {
      console.error("[gateway] tick failed:", e instanceof Error ? e.message : e);
    }
  };
  setInterval(tick, pollIntervalMs);
  void tick();

  // Minimal local status/admin API (bind to localhost in production).
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.get("/status", async (_req, res) => { res.json(await service.status()); });
  app.post("/flush", async (_req, res) => { res.json(await service.flush()); });
  app.post("/import-csv", async (req, res) => {
    if (adapter.type !== "CSV") { res.status(400).json({ error: "gateway not configured with CSV adapter" }); return; }
    const { content } = req.body as { content?: string };
    if (!content) { res.status(400).json({ error: "content required" }); return; }
    (adapter as CsvAdapter).loadContent(content);
    const polled = await service.pollOnce();
    const flushed = await service.flush();
    res.json({ queued: polled.queued, batchUuid: polled.batchUuid, flush: flushed });
  });

  const port = parseInt(process.env.PORT ?? "9800", 10);
  app.listen(port, () => console.log(`[gateway] status API on :${port}, adapter=${adapter.type}`));
}

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
