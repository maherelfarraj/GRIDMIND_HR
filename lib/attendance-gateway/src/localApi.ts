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

  app.get("/status", async (_req, res) => {
    const status = await service.status();
    // Operator-facing one-liner so on-site troubleshooting never requires
    // HR-core access: "N delivered batches not yet confirmed / M missing…".
    const recon = status.lastReconcile;
    const outcome = recon
      ? `last reconcile at ${recon.at}: checked ${recon.checked}, ${recon.missing.length} missing${recon.missing.length > 0 ? ` (${recon.missing.join(", ")})` : ""}, ${recon.mismatched.length} mismatched${recon.mismatched.length > 0 ? ` (${recon.mismatched.join(", ")})` : ""}`
      : "no reconcile has run yet";
    res.json({
      ...status,
      delivery_confirmation: {
        unconfirmedSentBatches: status.unconfirmedSentBatches,
        lastReconcileAt: status.lastReconcileAt,
        missingBatchUuids: recon?.missing ?? [],
        mismatchedBatchUuids: recon?.mismatched ?? [],
        summary: `${status.unconfirmedSentBatches} delivered batch${status.unconfirmedSentBatches === 1 ? "" : "es"} not yet confirmed by the server — ${outcome}`,
      },
    });
  });
  // Operator-triggered reconcile: get an immediate verdict on delivered-but-
  // unconfirmed batches. Bypasses the local rate limit; server-side audit
  // dedupe still applies. Mutating (server audit row) → operator token.
  app.post("/reconcile", requireOperatorToken, async (_req, res) => {
    try {
      const summary = await service.reconcileNow();
      if (!summary) { res.json({ ok: true, checked: 0, missing: [], mismatched: [], message: "no unconfirmed delivered batches to reconcile" }); return; }
      res.json({ ok: true, ...summary });
    } catch (e) {
      res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  // Terminal batches: exhausted all delivery attempts, kept encrypted on disk.
  app.get("/terminal-batches", async (_req, res) => { res.json(await service.listTerminalBatches()); });

  // Last-resort recovery: export a stuck batch's punches as a CSV file that
  // the CSV import path accepts. The file contains decrypted punch data
  // (metadata only — never biometric fields), so unlike the other read-only
  // endpoints it requires the operator token.
  app.get("/terminal-batches/:uuid/export", requireOperatorToken, async (req, res) => {
    try {
      const exported = await service.exportBatchCsv(req.params.uuid);
      if (!exported) { res.status(404).json({ error: "unknown or non-terminal batchUuid" }); return; }
      res
        .set("content-type", "text/csv; charset=utf-8")
        .set("content-disposition", `attachment; filename="punch-batch-${exported.batchUuid}.csv"`)
        .send(exported.csv);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Operator discard: permanently retire a terminal batch once its punches have
  // been confirmed on the server (e.g. via CSV export → re-import). Requires
  // the operator token — this is a destructive, irreversible spool operation.
  // By default the endpoint first reconciles with the server and refuses when
  // the batch/punches are not confirmed (409). Pass ?force=true to skip the
  // safety check and discard unconditionally (e.g. punches already verified
  // out-of-band, or the server is temporarily unreachable).
  app.delete("/terminal-batches/:uuid", requireOperatorToken, async (req, res) => {
    const force = req.query.force === "true" || req.query.force === "1";
    try {
      const result = await service.discardBatch(req.params.uuid, { force });
      if (!result.ok) {
        if (result.reason === "NOT_FOUND") {
          res.status(404).json({ error: "unknown or non-terminal batchUuid" });
          return;
        }
        // NOT_CONFIRMED — server has not confirmed receipt; surface reason.
        res.status(409).json({
          error: "server has not confirmed receipt of this batch; pass ?force=true to discard anyway",
          serverStatus: result.serverStatus,
        });
        return;
      }
      res.json({ ok: true, batchUuid: req.params.uuid, punchCount: result.punchCount });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

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
