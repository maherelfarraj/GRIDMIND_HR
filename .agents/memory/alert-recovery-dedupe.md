---
name: Alert/recovery transition dedupe
description: How to emit one-shot state-transition notifications (alert raised / recovered) without duplicates or false positives.
---
Rule: for one-shot transition notices (e.g. connection health alert → recovered), (1) derive the "outstanding" state from the audit trail (latest alert vs recovered event), not from counters vs current thresholds — threshold edits otherwise cause false recoveries; (2) claim the transition atomically: transaction + SELECT ... FOR UPDATE on the owning row, re-check state under the lock, then write the event + notifications in the same tx.

**Why:** review rejected both a threshold-comparison recovery check (false positives after threshold edits) and a non-atomic check-then-insert (duplicate notices when a scheduled sweep races a manual test).

**How to apply:** any time two paths (scheduler + manual endpoint) can both complete the same transition — share one exported claim primitive and call it from both; add a Promise.all concurrency test asserting exactly one event.
