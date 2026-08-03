/**
 * Process-wide readiness flag flipped at the start of graceful shutdown.
 *
 * Load balancers / the Replit proxy poll `/api/healthz`; once a shutdown
 * signal arrives we report 503 there BEFORE closing the listener, so routers
 * stop sending new traffic instead of hitting refused connections mid-drain.
 */
let shuttingDown = false;

/** Flip the readiness flag; healthz returns 503 from this point on. */
export function markShuttingDown(): void {
  shuttingDown = true;
}

/** True once a shutdown signal has been received. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}
