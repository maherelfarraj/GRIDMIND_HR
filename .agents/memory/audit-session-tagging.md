---
name: Privileged-session audit tagging
description: How audit rows get attributed to break-glass sessions — DB trigger, not app middleware.
---
**Rule:** audit_logs.privileged_session_id is filled by a BEFORE INSERT trigger (migration 006) matching the actor's session window on the row's created_at — never re-implement tagging in app code or add per-write-site tagging.

**Why:** there are 250+ direct `insert(auditLogsTable)` call sites with no shared helper; app-level middleware could not cover jobs/transactions, and the trigger keeps tagging atomic with the write.

**How to apply:** when adding audit writes, do nothing — the trigger tags them. When testing "untagged/legacy" behavior, insert then UPDATE the tag to NULL (the trigger is INSERT-only). The activity endpoint prefers tagged rows and falls back to time-window correlation only when a session has zero tagged entries.
