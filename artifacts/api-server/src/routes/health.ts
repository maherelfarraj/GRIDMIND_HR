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

export default router;
