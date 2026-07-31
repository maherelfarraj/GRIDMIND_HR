import { EncryptedQueue } from "./queue.js";
import { HrClient } from "./hrClient.js";
import { GatewayService } from "./service.js";
import { deriveSigningKey } from "./signing.js";
import { SimulatorAdapter } from "./adapters/simulator.js";
import { GenericRestAdapter } from "./adapters/genericRest.js";
import { CsvAdapter } from "./adapters/csv.js";
import { ZktecoAdapter, SupremaAdapter, zktecoConfigFromEnv, supremaConfigFromEnv } from "./adapters/vendorStubs.js";
import { ZktecoNativeAdapter, zktecoNativeConfigFromEnv } from "./adapters/zktecoNative.js";
import { SupremaNativeAdapter, supremaNativeConfigFromEnv } from "./adapters/supremaNative.js";
import type { DeviceAdapter } from "./types.js";
import { buildLocalApi } from "./localApi.js";

/**
 * Attendance Gateway entrypoint — runs inside the customer network.
 *
 * Required environment:
 *   HR_API_URL          e.g. http://hr-core.local:8080/api
 *   GATEWAY_ID          registration id issued by the HR core admin screen
 *   GATEWAY_SECRET      one-time secret shown at registration
 *   GATEWAY_QUEUE_KEY   local encryption key for the punch spool
 * Optional:
 *   GATEWAY_ADAPTER     SIMULATOR | GENERIC_REST | CSV | ZKTECO | SUPREMA | ZKTECO_NATIVE | SUPREMA_NATIVE
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
    case "ZKTECO_NATIVE":
      return new ZktecoNativeAdapter(zktecoNativeConfigFromEnv());
    case "SUPREMA_NATIVE":
      return new SupremaNativeAdapter(supremaNativeConfigFromEnv());
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
    // service.tick() heartbeats even when poll/flush fail, so connection
    // failures still reach the HR core admin screen.
    const { pollError, heartbeatError } = await service.tick();
    if (pollError) console.error("[gateway] poll/flush failed:", pollError);
    if (heartbeatError) console.error("[gateway] heartbeat failed:", heartbeatError);
  };
  setInterval(tick, pollIntervalMs);
  void tick();

  // Local operator API: loopback-only by default; mutating endpoints require
  // the operator token (see localApi.ts).
  const app = buildLocalApi({ service, adapter, adminToken: requiredEnv("GATEWAY_ADMIN_TOKEN") });
  const port = parseInt(process.env.PORT ?? "9800", 10);
  const host = process.env.GATEWAY_BIND_HOST ?? "127.0.0.1";
  app.listen(port, host, () => console.log(`[gateway] status API on ${host}:${port}, adapter=${adapter.type}`));
}

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
