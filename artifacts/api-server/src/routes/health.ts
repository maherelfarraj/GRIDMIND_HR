import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isShuttingDown } from "../lib/shutdownState";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  // Readiness: once shutdown begins, tell load balancers to stop routing
  // new traffic here (503) while in-flight requests drain.
  if (isShuttingDown()) {
    const data = HealthCheckResponse.parse({ status: "shutting_down" });
    res.status(503).json(data);
    return;
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Test-only latency endpoint used by the graceful-shutdown drain test to hold
// a request in flight across SIGTERM. Never registered in production; requires
// an explicit env opt-in so it does not exist in normal dev runs either.
if (process.env.NODE_ENV !== "production" && process.env.SHUTDOWN_SLOW_ENDPOINT === "true") {
  router.get("/healthz/slow", (req, res) => {
    const ms = Math.min(Number(req.query["ms"]) || 1_000, 30_000);
    // Handshake: flush the status line + a first chunk immediately so the
    // client can OBSERVE the request is in flight (headers received) before
    // it delivers SIGTERM. The body completes after the delay.
    res.status(200).type("text/plain");
    res.write("started\n");
    setTimeout(() => {
      res.end("done\n");
    }, ms);
  });
}

export default router;
