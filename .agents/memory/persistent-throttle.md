---
name: Persisting in-memory security state
description: Pattern for durably persisting in-memory counters (login throttle) without breaking the sync hot path.
---
**Rule:** when write-through persisting in-memory state (e.g. login throttle), fire-and-forget DB writes are not enough — serialize writes per key via a promise chain (out-of-order upsert/delete on separate pool connections resurrects stale state), and gate enforcement on an awaited one-time hydration promise so persisted state applies from the first request after restart.

**Why:** a plain fire-and-forget implementation has two real races — out-of-order writes can resurrect cleared state, and pre-hydration requests bypass persisted lockouts.

**How to apply:** any future feature that mirrors in-memory counters/flags to the DB (rate limits, sessions, caches) — keep the sync in-memory API, per-key queue for writes, exported `ready` promise awaited in the route.
