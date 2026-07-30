---
name: Auto-merge corruption in hot payroll route
description: Rebases of the payroll calculate route often auto-merge with silent corruption; how to detect and recover.
---
Rebases touching the payroll calculate route (many concurrent tasks edit it) frequently produce **silently corrupted auto-merges**: orphaned declarations after `export default`, missing `for (const emp of employees)` loop headers, cross-contaminated route handlers (wrong body under wrong route), `periodId` renamed to undefined `id`. Corruption has even landed on main itself via another task's merge.

**Why:** the file is long and repetitive (several near-identical Express handlers), so 3-way merges misalign hunks without conflict markers.

**How to apply:** after any rebase/merge touching this file, always run typecheck before trusting it — a clean `git status` proves nothing. Recovery that works: take the last known-good full version (or reconstruct from each feature commit's *intent*, since a parent may itself be corrupted), rewrite the file wholesale, run typecheck + full sequential test suite, then continue the merge. Verify main's copy compiles before using it as a base.
