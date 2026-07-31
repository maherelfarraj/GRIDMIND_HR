import express, { type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import type { GatewayService } from "./service.js";
import type { DeviceAdapter } from "./types.js";
import type { CsvAdapter } from "./adapters/csv.js";

/**
 * Local operator/status API for the gateway.
 *
 * Security model:
 *  - The server binds to loopback by default (see index.ts) — it is an
 *    operator control plane, not a network service.
 *  - Mutating endpoints (/flush, /requeue, /import-csv) additionally require
 *    the operator token (GATEWAY_ADMIN_TOKEN) via `x-gateway-admin-token`,
 *    compared timing-safely. Read-only endpoints stay open on loopback.
 */
export function buildLocalApi(opts: { service: GatewayService; adapter: DeviceAdapter; adminToken: string }): express.Express {
  const { service, adapter, adminToken } = opts;
  if (!adminToken) throw new Error("buildLocalApi requires a non-empty adminToken (GATEWAY_ADMIN_TOKEN)");

  const expectedDigest = createHash("sha256").update(adminToken).digest();
  const requireOperatorToken = (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header("x-gateway-admin-token");
    if (!provided) {
      res.status(401).json({ error: "x-gateway-admin-token required" });
      return;
    }
    const providedDigest = createHash("sha256").update(provided).digest();
    if (!timingSafeEqual(providedDigest, expectedDigest)) {
      res.status(401).json({ error: "invalid operator token" });
      return;
    }
    next();
  };

  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/status", async (_req, res) => { res.json(await service.status()); });
  // Terminal batches: exhausted all delivery attempts, kept encrypted on disk.
  app.get("/terminal-batches", async (_req, res) => { res.json(await service.listTerminalBatches()); });

  app.post("/flush", requireOperatorToken, async (_req, res) => { res.json(await service.flush()); });
  // Operator requeue: reset attempts/terminal so the next flush retries the batch.
  app.post("/requeue", requireOperatorToken, async (req, res) => {
    const { batchUuid } = req.body as { batchUuid?: string };
    if (!batchUuid) { res.status(400).json({ error: "batchUuid required" }); return; }
    const requeued = await service.requeueBatch(batchUuid);
    if (!requeued) { res.status(404).json({ error: "unknown batchUuid" }); return; }
    res.json({ ok: true, ...requeued });
  });
  app.post("/import-csv", requireOperatorToken, async (req, res) => {
    if (adapter.type !== "CSV") { res.status(400).json({ error: "gateway not configured with CSV adapter" }); return; }
    const { content } = req.body as { content?: string };
    if (!content) { res.status(400).json({ error: "content required" }); return; }
    (adapter as CsvAdapter).loadContent(content);
    const polled = await service.pollOnce();
    const flushed = await service.flush();
    res.json({ queued: polled.queued, batchUuid: polled.batchUuid, flush: flushed });
  });

  return app;
}
