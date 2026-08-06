import { describe, it, expect, beforeAll } from "vitest";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * End-to-end proof that a redeploy drains cleanly with zero dropped requests.
 *
 * Spawns the BUILT server (dist/index.mjs — exactly what `pnpm run start`
 * runs), holds a slow request in flight, delivers SIGTERM, and asserts the
 * full ordering:
 *
 *   signal → healthz 503 (listener still open through the 3s grace window) →
 *   listener close (new connections REFUSED while the slow request is still
 *   pending) → in-flight request completes → process exits 0
 *
 * The slow endpoint (/api/healthz/slow) only exists when the spawned server
 * is started with SHUTDOWN_SLOW_ENDPOINT=true outside production. It flushes
 * its response headers immediately (handshake proving the request is in
 * flight) and completes the body after the requested delay.
 */

const serverRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/** Matches SHUTDOWN_READINESS_GRACE_MS in src/index.ts. */
const GRACE_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { connection: "close" } });
  return { status: res.status, body: await res.json() };
}

/** True when a fresh TCP connection to the listener is refused. */
async function connectionRefused(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { connection: "close" } });
    await res.arrayBuffer();
    return false;
  } catch {
    return true;
  }
}

async function waitForReady(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const { status } = await fetchJson(`${base}/api/healthz`);
      if (status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("server never became ready");
    await sleep(250);
  }
}

describe("graceful shutdown drain (spawned built server)", () => {
  beforeAll(
    () => {
      // Build the production bundle once for the entire suite.
      // All four tests spawn from the same dist/index.mjs — rebuilding per
      // test is wasted work since the output is identical each time.
      execSync("node ./build.mjs", { cwd: serverRoot, stdio: "ignore" });
    },
    120_000,
  );

  it(
    "SIGTERM flips healthz to 503, closes the listener after the grace window, and completes in-flight requests",
    { timeout: 180_000 },
    async () => {
      const port = 38000 + Math.floor(Math.random() * 1000);
      const base = `http://127.0.0.1:${port}`;
      let child: ChildProcess | null = null;
      let output = "";
      try {
        child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
          cwd: serverRoot,
          env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            PILOT_AUTH: "false",
            SHUTDOWN_SLOW_ENDPOINT: "true",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout!.on("data", (d) => (output += d.toString()));
        child.stderr!.on("data", (d) => (output += d.toString()));
        const exited = new Promise<number | null>((resolve) => {
          child!.on("exit", (code) => resolve(code));
        });

        await waitForReady(base, 90_000);

        // Baseline: readiness is green before the signal.
        const before = await fetchJson(`${base}/api/healthz`);
        expect(before.status).toBe(200);

        // Hold a request in flight: 8s > 3s grace window, so the listener
        // must close while this response is still pending.
        // Handshake: the endpoint flushes its headers + first chunk
        // immediately, so awaiting the fetch (headers received, "started"
        // chunk pending in the body) PROVES the handler is running before we
        // deliver SIGTERM — no arbitrary sleep involved.
        const slowRes = await fetch(`${base}/api/healthz/slow?ms=8000`);
        expect(slowRes.status).toBe(200);
        const slowBody = slowRes.text(); // resolves only when the body completes
        let slowDone = false;
        void slowBody.then(() => (slowDone = true));

        const sigtermAt = Date.now();
        child.kill("SIGTERM");

        // 1. healthz flips to 503 promptly — the socket still ACCEPTS the
        //    connection (a refused connection would throw instead).
        let after: { status: number; body: unknown } | null = null;
        while (Date.now() - sigtermAt < 2_000) {
          after = await fetchJson(`${base}/api/healthz`);
          if (after.status === 503) break;
          await sleep(100);
        }
        expect(after?.status).toBe(503);
        expect((after?.body as { status: string }).status).toBe("shutting_down");

        // 2. Grace window is observable: well inside the 3s window the
        //    listener still answers (503) rather than refusing connections.
        await sleep(Math.max(0, sigtermAt + 1_500 - Date.now()));
        const midGrace = await fetchJson(`${base}/api/healthz`);
        expect(midGrace.status).toBe(503);

        // 3. Shortly after the grace deadline the listener must be CLOSED:
        //    new connections are refused WHILE the slow request is still
        //    pending. Poll from just after the deadline with tolerance for
        //    scheduling jitter, and record when refusal is first observed.
        await sleep(Math.max(0, sigtermAt + GRACE_MS + 200 - Date.now()));
        let refusedAt: number | null = null;
        while (Date.now() - sigtermAt < GRACE_MS + 3_000) {
          if (await connectionRefused(`${base}/api/healthz`)) {
            refusedAt = Date.now();
            break;
          }
          await sleep(100);
        }
        expect(refusedAt).not.toBeNull();
        // The listener closed at the grace boundary — not because the slow
        // request finished: the in-flight response is still pending here.
        expect(slowDone).toBe(false);
        expect(refusedAt! - sigtermAt).toBeGreaterThanOrEqual(GRACE_MS - 200);
        expect(refusedAt! - sigtermAt).toBeLessThan(8_000);

        // 4. The in-flight request completes successfully even though the
        //    listener already refuses new connections.
        const bodyText = await slowBody;
        expect(bodyText).toContain("started");
        expect(bodyText).toContain("done");

        // 5. The process exits cleanly once the drain finishes.
        const code = await Promise.race([exited, sleep(30_000).then(() => "timeout" as const)]);
        expect(code).toBe(0);
      } finally {
        // Kill any child that is still alive (exitCode is null until exit),
        // regardless of whether a signal was already sent, and await its exit.
        if (child && child.exitCode === null && child.signalCode === null) {
          const gone = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
          child.kill("SIGKILL");
          await Promise.race([gone, sleep(5_000)]);
        }
        if (process.env["DEBUG_SHUTDOWN_TEST"]) {
          console.log(output);
        }
      }
    },
  );

  it(
    "a stuck request cannot hold up shutdown forever: SIGTERM still exits 0 after the drain timeout, with a warning",
    { timeout: 180_000 },
    async () => {
      // Shorten the drain timeout (test-only env override) so the give-up
      // path is provable quickly; the stuck request (25s) far exceeds it.
      const DRAIN_MS = 2_000;
      const port = 39000 + Math.floor(Math.random() * 1000);
      const base = `http://127.0.0.1:${port}`;
      let child: ChildProcess | null = null;
      let output = "";
      try {
        child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
          cwd: serverRoot,
          env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            PILOT_AUTH: "false",
            SHUTDOWN_SLOW_ENDPOINT: "true",
            SHUTDOWN_DRAIN_TIMEOUT_MS: String(DRAIN_MS),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout!.on("data", (d) => (output += d.toString()));
        child.stderr!.on("data", (d) => (output += d.toString()));
        const exited = new Promise<number | null>((resolve) => {
          child!.on("exit", (code) => resolve(code));
        });

        await waitForReady(base, 90_000);

        // Hold a request that will NOT finish within the drain timeout:
        // 25s ≫ 3s grace + 2s drain. The headers-received handshake proves
        // the handler is running before SIGTERM is delivered.
        const stuckRes = await fetch(`${base}/api/healthz/slow?ms=25000`);
        expect(stuckRes.status).toBe(200);
        // Consume the body so the connection stays genuinely in-flight; it is
        // expected to error when the process exits mid-response.
        const stuckBody = stuckRes.text().catch(() => "aborted");

        const sigtermAt = Date.now();
        child.kill("SIGTERM");

        // The process must still exit 0 — the stuck connection may not stall
        // the redeploy. Budget: 3s grace + 2s drain + flush/monitor slack.
        const code = await Promise.race([exited, sleep(20_000).then(() => "timeout" as const)]);
        const exitedAt = Date.now();
        expect(code).toBe(0);

        // It exited BECAUSE the drain timed out, not because the request
        // finished: well before the stuck request's 25s completion.
        expect(exitedAt - sigtermAt).toBeLessThan(20_000);
        expect(exitedAt - sigtermAt).toBeGreaterThanOrEqual(GRACE_MS + DRAIN_MS - 500);

        // The give-up path is observable in the logs.
        expect(output).toContain("did not drain within the shutdown timeout");

        // The stuck response never completed cleanly.
        const bodyText = await stuckBody;
        expect(bodyText).not.toContain("done");
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          const gone = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
          child.kill("SIGKILL");
          await Promise.race([gone, sleep(5_000)]);
        }
        if (process.env["DEBUG_SHUTDOWN_TEST"]) {
          console.log(output);
        }
      }
    },
  );

  it(
    "a stuck background sweep cannot stall a redeploy: SIGTERM still exits 0 after the monitor-stop timeout, with a warning",
    { timeout: 180_000 },
    async () => {
      // Shorten the monitor-stop timeout (test-only env override) and inject
      // a simulated sweep stuck mid-database-write far past it.
      const MONITOR_STOP_MS = 1_000;
      const port = 40000 + Math.floor(Math.random() * 1000);
      const base = `http://127.0.0.1:${port}`;
      let child: ChildProcess | null = null;
      let output = "";
      try {
        child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
          cwd: serverRoot,
          env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            PILOT_AUTH: "false",
            SHUTDOWN_MONITOR_STOP_TIMEOUT_MS: String(MONITOR_STOP_MS),
            SHUTDOWN_STALL_MONITOR_STOP_MS: "60000",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout!.on("data", (d) => (output += d.toString()));
        child.stderr!.on("data", (d) => (output += d.toString()));
        const exited = new Promise<number | null>((resolve) => {
          child!.on("exit", (code) => resolve(code));
        });

        await waitForReady(base, 90_000);

        const sigtermAt = Date.now();
        child.kill("SIGTERM");

        // The process must still exit 0 well before the 60s stuck sweep
        // would finish. Budget: 3s grace + fast drain + 1s monitor timeout
        // + flush slack.
        const code = await Promise.race([exited, sleep(20_000).then(() => "timeout" as const)]);
        const exitedAt = Date.now();
        expect(code).toBe(0);
        expect(exitedAt - sigtermAt).toBeLessThan(20_000);
        // The monitor-stop timer starts at the signal, CONCURRENTLY with the
        // readiness grace window, so with a 1s timeout the bound on total
        // shutdown time is the 3s grace window itself. Waiting at least that
        // long (rather than exiting instantly) plus the warning below proves
        // the give-up path ran rather than the wait being skipped.
        expect(exitedAt - sigtermAt).toBeGreaterThanOrEqual(GRACE_MS - 500);

        // The give-up path is observable in the logs.
        expect(output).toContain("Background monitors did not stop within the shutdown timeout");
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          const gone = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
          child.kill("SIGKILL");
          await Promise.race([gone, sleep(5_000)]);
        }
        if (process.env["DEBUG_SHUTDOWN_TEST"]) {
          console.log(output);
        }
      }
    },
  );

  it(
    "a stuck deferred-notification flush cannot stall a redeploy: SIGTERM still exits 0 after the flush timeout, with a warning",
    { timeout: 180_000 },
    async () => {
      // Shorten the flush timeout (test-only env override) and inject a
      // simulated deferred write that stays pending far past it.
      const FLUSH_MS = 1_000;
      const port = 41000 + Math.floor(Math.random() * 1000);
      const base = `http://127.0.0.1:${port}`;
      let child: ChildProcess | null = null;
      let output = "";
      try {
        child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
          cwd: serverRoot,
          env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            PILOT_AUTH: "false",
            SHUTDOWN_FLUSH_TIMEOUT_MS: String(FLUSH_MS),
            SHUTDOWN_STALL_FLUSH_MS: "60000",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout!.on("data", (d) => (output += d.toString()));
        child.stderr!.on("data", (d) => (output += d.toString()));
        const exited = new Promise<number | null>((resolve) => {
          child!.on("exit", (code) => resolve(code));
        });

        await waitForReady(base, 90_000);

        const sigtermAt = Date.now();
        child.kill("SIGTERM");

        // The process must still exit 0 well before the 60s stuck flush
        // would finish. Budget: 3s grace + fast drain + monitor stop
        // + 1s flush timeout + slack.
        const code = await Promise.race([exited, sleep(20_000).then(() => "timeout" as const)]);
        const exitedAt = Date.now();
        expect(code).toBe(0);
        expect(exitedAt - sigtermAt).toBeLessThan(20_000);
        // It waited at least the grace window + flush timeout — i.e. it
        // genuinely gave up on the flush rather than never waiting at all.
        expect(exitedAt - sigtermAt).toBeGreaterThanOrEqual(GRACE_MS + FLUSH_MS - 500);

        // The give-up path is observable in the logs.
        expect(output).toContain("Deferred notification flush timed out at shutdown");
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          const gone = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
          child.kill("SIGKILL");
          await Promise.race([gone, sleep(5_000)]);
        }
        if (process.env["DEBUG_SHUTDOWN_TEST"]) {
          console.log(output);
        }
      }
    },
  );
});
