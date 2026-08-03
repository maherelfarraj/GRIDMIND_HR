import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { isShuttingDown, markShuttingDown } from "../lib/shutdownState";

// Readiness endpoint behavior around graceful shutdown: /api/healthz must
// flip to 503 as soon as shutdown is signalled so load balancers stop
// routing new traffic before the listener closes.
describe("healthz readiness during shutdown", () => {
  it("returns 200 ok before shutdown", async () => {
    expect(isShuttingDown()).toBe(false);
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns 503 once shutdown has been signalled", async () => {
    markShuttingDown();
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("shutting_down");
  });

  afterAll(() => {
    // Module-level flag is process-wide; vitest runs each file in its own
    // worker, so no reset hook is needed — this note documents the intent.
  });
});
