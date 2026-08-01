---
name: Alert/recovery transition dedupe
description: How to emit one-shot state-transition notifications (alert raised / recovered) without duplicates or false positives.
---
Rule: for one-shot transition notices (e.g. connection health alert → recovered), (1) derive the "outstanding" state from the audit trail (latest alert vs recovered event), not from counters vs current thresholds — threshold edits otherwise cause false recoveries; (2) claim the transition atomically: transaction + SELECT ... FOR UPDATE on the owning row, re-check state under the lock, then write the event + notifications in the same tx.

**Why:** review rejected both a threshold-comparison recovery check (false positives after threshold edits) and a non-atomic check-then-insert (duplicate notices when a scheduled sweep races a manual test).

**How to apply:** any time two paths (scheduler + manual endpoint) can both complete the same transition — share one exported claim primitive and call it from both; add a Promise.all concurrency test asserting exactly one event.

Update (Aug 2026): for deferred/off-request-path notification writes, the claim pattern is a nullable `*_notified_at` column on the source row — set from NULL inside the same transaction as the notification insert, with a startup/periodic backfill sweep selecting terminal rows where it's NULL. This survives restarts (deferred write lost mid-crash) with zero duplicates; the migration must pre-claim rows whose notifications already exist.
