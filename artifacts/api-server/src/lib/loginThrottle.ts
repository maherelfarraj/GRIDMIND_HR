/**
 * In-memory login throttling / temporary lockout.
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
 * In-memory state is intentional for this single-process pilot deployment:
 * it needs no schema change and resets on restart, which is an acceptable
 * failure mode for a brute-force throttle.
 */

export const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES) || 5;
export const IP_MAX_FAILURES = Number(process.env.LOGIN_IP_MAX_FAILURES) || 20;
export const LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000;

interface Entry {
  failures: number;
  lockedUntil: number | null; // epoch ms
}

const entries = new Map<string, Entry>();

function keyFor(kind: "user" | "ip", value: string): string {
  return `${kind}:${value.toLowerCase()}`;
}

function check(key: string, now: number): { locked: boolean; retryAfterMs: number } {
  const entry = entries.get(key);
  if (!entry || entry.lockedUntil === null) return { locked: false, retryAfterMs: 0 };
  if (entry.lockedUntil <= now) {
    // Lockout expired — reset automatically.
    entries.delete(key);
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
  entries.delete(keyFor("user", username));
  entries.delete(keyFor("ip", ip));
}

/** How many failures remain before this account locks (for tests/diagnostics). */
export function remainingAttempts(username: string): number {
  const entry = entries.get(keyFor("user", username));
  return Math.max(0, MAX_FAILURES - (entry?.failures ?? 0));
}

/** Test-only: wipe all throttle state. */
export function resetLoginThrottle(): void {
  entries.clear();
}
