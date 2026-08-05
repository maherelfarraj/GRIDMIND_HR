---
name: Privileged-session audit tagging
description: How audit rows get attributed to break-glass sessions — DB trigger, not app middleware.
---
**Rule:** the audit table's privileged-session reference is filled by a DB BEFORE-INSERT trigger matching the actor's session window — never re-implement tagging in app code or add per-write-site tagging.

**Why:** there are 250+ direct `insert(auditLogsTable)` call sites with no shared helper; app-level middleware could not cover jobs/transactions, and the trigger keeps tagging atomic with the write.

**Overlap semantics:** when several session windows contain a write, the most recently started one wins, tie-broken by higher session id; window bounds are inclusive at both started_at and ended_at/scheduled_end_at. Tests for overlap/boundary cases live in the privileged-sessions suite.

**How to apply:** when adding audit writes, do nothing — the trigger tags them. When testing "untagged/legacy" behavior, insert then UPDATE the tag to NULL (the trigger is INSERT-only). The activity endpoint prefers tagged rows and falls back to time-window correlation only when a session has zero tagged entries.
