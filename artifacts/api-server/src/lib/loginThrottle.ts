/**
 * Login throttling / temporary lockout with persistent state.
 *
 * Tracks failed login attempts per account (username) and per source IP.
 * After MAX_FAILURES consecutive failures a key is locked out for
 * LOCKOUT_MS; the lockout expires automatically and the counter resets.
 * A successful login clears the counters for that username/IP pair.
 *
 * Config is read at module load (same convention as PILOT_AUTH):
 *  - LOGIN_MAX_FAILURES     (default 5)   — per-account threshold
 *  - LOGIN_IP_MAX_FAILURES  (default 20)  — per-IP threshold (covers
 *                                           attacks spraying many usernames)
 *  - LOGIN_LOCKOUT_MS       (default 15 minutes)
 *
 * Persistence: the in-memory Map remains the synchronous source of truth
 * (so the hot login path never blocks on the DB), and every mutation is
 * written through to the login_throttle table. Two ordering guarantees
 * keep the persisted copy consistent with memory:
 *  - writes are serialized PER KEY through a promise queue, so an upsert
 *    and a later delete for the same key can never land out of order on
 *    different pool connections;
 *  - state is hydrated from the table once at process start, and callers
 *    (the login route) await `loginThrottleReady` before enforcing, so a
 *    persisted lockout applies from the very first request after restart.
 *
 * Persistence failures are logged and swallowed — the in-memory throttle
 * keeps protecting the running process even if the DB write fails.
 */
import { db, loginThrottleTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

export const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES) || 5;
export const IP_MAX_FAILURES = Number(process.env.LOGIN_IP_MAX_FAILURES) || 20;
export const LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000;

interface Entry {
  failures: number;
  lockedUntil: number | null; // epoch ms
}

const entries = new Map<string, Entry>();

function logPersistError(op: string, err: unknown): void {
  console.error(`[loginThrottle] failed to ${op} persistent state:`, err);
}

// ---------------------------------------------------------------------------
// Per-key serialized write-through
// ---------------------------------------------------------------------------

/** Tail of the pending write chain for each key. */
const writeQueues = new Map<string, Promise<void>>();

/** Last pending wipe from resetLoginThrottle (tracked so flush covers it). */
let pendingReset: Promise<unknown> = Promise.resolve();

/** Chain an async op after all previously enqueued ops for the same key. */
function enqueue(key: string, op: () => Promise<unknown>, label: string): void {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev
    .then(op)
    .catch((err) => logPersistError(label, err))
    .then(() => {
      // Drop the queue entry once drained so the map does not grow forever.
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    });
  writeQueues.set(key, next);
}

function persistUpsert(key: string, entry: Entry): void {
  // Snapshot NOW — the mutable entry may change before the write runs.
  const failures = entry.failures;
  const lockedUntil = entry.lockedUntil;
  enqueue(key, () =>
    db.insert(loginThrottleTable)
      .values({ key, failures, lockedUntil, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: loginThrottleTable.key,
        set: { failures, lockedUntil, updatedAt: new Date() },
      }),
  "upsert");
}

function persistDelete(keys: string[]): void {
  for (const key of keys) {
    enqueue(key, () =>
      db.delete(loginThrottleTable).where(inArray(loginThrottleTable.key, [key])),
    "delete");
  }
}

/** Await all pending write-through operations (tests / graceful shutdown). */
export async function flushLoginThrottle(): Promise<void> {
  // New writes may be enqueued while we wait; loop until the queues drain.
  await pendingReset;
  while (writeQueues.size > 0) {
    await Promise.allSettled([...writeQueues.values()]);
  }
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/**
 * Load persisted throttle state into memory. Runs once at module load;
 * the login route awaits `loginThrottleReady` so persisted lockouts are
 * enforced from the first request after a restart. In-memory entries
 * created before hydration completes win (they are newer). Expired
 * lockout rows are pruned from the DB instead of loaded.
 */
export async function hydrateLoginThrottle(now: number = Date.now()): Promise<void> {
  try {
    const rows = await db.select().from(loginThrottleTable);
    const expired: string[] = [];
    for (const row of rows) {
      if (row.lockedUntil !== null && row.lockedUntil <= now) {
        expired.push(row.key);
        continue;
      }
      if (!entries.has(row.key) && !writeQueues.has(row.key)) {
        entries.set(row.key, { failures: row.failures, lockedUntil: row.lockedUntil });
      }
    }
    persistDelete(expired);
  } catch (err) {
    logPersistError("hydrate", err);
  }
}

/** Resolves once persisted state has been loaded (never rejects). */
export const loginThrottleReady: Promise<void> = hydrateLoginThrottle();

// ---------------------------------------------------------------------------
// Throttle logic (unchanged semantics)
// ---------------------------------------------------------------------------

function keyFor(kind: "user" | "ip", value: string): string {
  return `${kind}:${value.toLowerCase()}`;
}

function check(key: string, now: number): { locked: boolean; retryAfterMs: number } {
  const entry = entries.get(key);
  if (!entry || entry.lockedUntil === null) return { locked: false, retryAfterMs: 0 };
  if (entry.lockedUntil <= now) {
    // Lockout expired — reset automatically.
    entries.delete(key);
    persistDelete([key]);
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - now };
}

/** Is this username or IP currently locked out? */
export function isLockedOut(
  username: string,
  ip: string,
  now: number = Date.now(),
): { locked: boolean; retryAfterMs: number } {
  const byUser = check(keyFor("user", username), now);
  if (byUser.locked) return byUser;
  return check(keyFor("ip", ip), now);
}

/** Returns true when this bump newly triggered a lockout for the key. */
function bump(key: string, max: number, now: number): boolean {
  const entry = entries.get(key) ?? { failures: 0, lockedUntil: null };
  // If a previous lockout expired, start counting fresh.
  if (entry.lockedUntil !== null && entry.lockedUntil <= now) {
    entry.failures = 0;
    entry.lockedUntil = null;
  }
  const wasLocked = entry.lockedUntil !== null;
  entry.failures += 1;
  if (entry.failures >= max) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  entries.set(key, entry);
  persistUpsert(key, entry);
  return !wasLocked && entry.lockedUntil !== null;
}

export interface FailureResult {
  /** This failure just tripped the per-account lockout. */
  accountLockedNow: boolean;
  /** This failure just tripped the per-IP lockout. */
  ipLockedNow: boolean;
}

/** Record a failed login attempt for both the account and the source IP. */
export function recordFailure(
  username: string,
  ip: string,
  now: number = Date.now(),
): FailureResult {
  const accountLockedNow = bump(keyFor("user", username), MAX_FAILURES, now);
  const ipLockedNow = bump(keyFor("ip", ip), IP_MAX_FAILURES, now);
  return { accountLockedNow, ipLockedNow };
}

/** Clear counters after a successful login. */
export function recordSuccess(username: string, ip: string): void {
  const keys = [keyFor("user", username), keyFor("ip", ip)];
  for (const key of keys) entries.delete(key);
  persistDelete(keys);
}

/** How many failures remain before this account locks (for tests/diagnostics). */
export function remainingAttempts(username: string): number {
  const entry = entries.get(keyFor("user", username));
  return Math.max(0, MAX_FAILURES - (entry?.failures ?? 0));
}

/** Test-only: wipe all throttle state (memory and persisted). */
export function resetLoginThrottle(): void {
  entries.clear();
  const pending = [...writeQueues.values()];
  writeQueues.clear();
  // Delete all rows only after in-flight writes settle, so a straggling
  // upsert cannot land after the wipe and resurrect state. Tracked in
  // pendingReset so flushLoginThrottle waits for the wipe too.
  pendingReset = Promise.allSettled(pending)
    .then(() => db.execute(sql`DELETE FROM ${loginThrottleTable}`))
    .catch((err) => logPersistError("reset", err));
}
