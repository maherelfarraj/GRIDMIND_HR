---
name: Attendance gateway machine auth & pipeline
description: Design decisions for the HMAC gateway API, credential handling, and offline queue — keep consistent when extending device integration.
---

## Machine auth scheme
- Gateway requests sign `${timestamp}.${sha256(rawBody)}` with HMAC-SHA256; key = sha256(plaintext secret). Server stores ONLY sha256(secret) and uses it directly as the verification key.
- **Why:** the plaintext secret is shown once at registration and never persisted; ±5 min window + timing-safe compare block replay/oracle attacks. Tradeoff (documented, accepted): a DB read of secret_hash grants signing capability — mitigate later with KMS if needed.
- Raw body must be captured via express.json `verify` hook — re-serializing JSON breaks signatures.
- Machine endpoints mount BEFORE the session gate; admin endpoints that mint machine credentials require a real session UNCONDITIONALLY, even in demo mode (PILOT_AUTH off) where normal routes stay open. Review flagged this; don't regress.

## Data-integrity rules
- attendance_records has unique (employee_id, date); punch materialization must be a single atomic INSERT..ON CONFLICT with LEAST/GREATEST on "HH:MM" strings — select-then-write races create duplicate daily rows.
- Punch dedupe: per-event sha256 dedupe key + unique index + onConflictDoNothing; batch UUID replay returns the stored result (idempotent).
- No raw biometric templates may enter HR core — ingestion rejects payloads with template-like fields (422).

## Offline queue
- Encrypted spool (AES-256-GCM per batch file) with persisted attempts, nextAttemptAtMs (exponential backoff), and terminal flag kept on disk for operator recovery. Flush must skip not-due and terminal batches — "retry everything each flush" fails review.

## Cross-package test imports
- api-server tests that import lib/* TS sources directly violate its tsconfig rootDir; such test files are excluded from the tsc program (vitest still transpiles/runs them). OpenAPI drift test requires new tables to get spec schemas (or explicit opt-outs) and secret columns to be listed in ALLOWED_MISSING_COLUMNS.
