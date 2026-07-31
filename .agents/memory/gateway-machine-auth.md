---
name: Attendance gateway machine auth & pipeline
description: Design decisions for the HMAC gateway API, credential handling, and offline queue — keep consistent when extending device integration.
---

## Machine auth scheme
- Gateway requests sign `${timestamp}.${sha256(rawBody)}` with HMAC-SHA256; key = sha256(plaintext secret), unchanged on the wire.
- Server no longer stores the verification key in the clear: gateway_registrations.secret_hash holds an AES-256-GCM envelope (`v2:iv:tag:ct`) wrapped with a pepper from GATEWAY_KEY_PEPPER (fallback SESSION_SECRET) via the key-vault module — a DB leak alone can't forge punches. Legacy bare-hash rows verify once then rotate in place; startup runs an idempotent eager rotation.
- **Why:** the plaintext secret is shown once at registration and never persisted; ±5 min window + timing-safe compare block replay/oracle attacks. Note: rotating the pepper (or SESSION_SECRET when no dedicated pepper is set) makes existing envelopes undecryptable — gateways must re-register unless a re-wrap path is added.
- Raw body must be captured via express.json `verify` hook — re-serializing JSON breaks signatures.
- Machine endpoints mount BEFORE the session gate; admin endpoints that mint machine credentials require a real session UNCONDITIONALLY, even in demo mode (PILOT_AUTH off) where normal routes stay open. Review flagged this; don't regress.

## Remote device commands
- Commands (RESTART) queue PENDING per device+registration; the heartbeat delivers them via a single atomic `UPDATE ... RETURNING` (PENDING→DELIVERED) so each command reaches exactly one heartbeat response; acks come over a signed machine endpoint and only the owning registration can ack, only from DELIVERED. Stale PENDING/DELIVERED commands expire on read (15 min TTL) so the queue can't wedge; adapters without a reboot call ack FAILED with an explanatory message instead of dropping the command.

## Data-integrity rules
- attendance_records has unique (employee_id, date); punch materialization must be a single atomic INSERT..ON CONFLICT with LEAST/GREATEST on "HH:MM" strings — select-then-write races create duplicate daily rows.
- Punch dedupe: per-event sha256 dedupe key + unique index + onConflictDoNothing; batch UUID replay returns the stored result (idempotent).
- No raw biometric templates may enter HR core — ingestion rejects payloads with template-like fields (422).

## Offline queue
- Encrypted spool (AES-256-GCM per batch file) with persisted attempts, nextAttemptAtMs (exponential backoff), and terminal flag kept on disk for operator recovery. Flush must skip not-due and terminal batches — "retry everything each flush" fails review.

- Terminal batches (attempts exhausted) are excluded from pending counts and only recover via an explicit operator requeue that resets attempts/terminal.
- The gateway's local operator API must bind loopback by default and require a shared operator token (timing-safe compare) on all mutating endpoints — review rejects unauthenticated local control planes even with a "bind to localhost" comment.

## Cross-package test imports
- api-server tests that import lib/* TS sources directly violate its tsconfig rootDir; such test files are excluded from the tsc program (vitest still transpiles/runs them). OpenAPI drift test requires new tables to get spec schemas (or explicit opt-outs) and secret columns to be listed in ALLOWED_MISSING_COLUMNS.
