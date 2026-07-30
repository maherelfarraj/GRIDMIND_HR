---
name: Auto-merge corruption in hot files
description: Rebases of heavily-contended files (esp. the payroll calculate route) often auto-merge with silent corruption; how to detect and recover.
---

Rebases touching heavily-contended files (many concurrent tasks edit the payroll calculate route) frequently produce **silently corrupted auto-merges**: orphaned declarations after `export default`, missing loop headers, duplicated statements, cross-contaminated route handlers (wrong body under wrong route), variables renamed to undefined identifiers. Corruption has even landed on main itself via another task's merge — do not assume `main-repl/main` compiles.

**Why:** these files are long and repetitive (several near-identical Express handlers), so 3-way merges misalign hunks without conflict markers.

**How to apply:** after any rebase/merge touching such a file, always run typecheck before trusting it — a clean `git status` proves nothing. Recovery that works: take the last known-good full version (or reconstruct each feature commit's *intent* from its tests, since a parent may itself be corrupted), rewrite the file wholesale, run typecheck + full sequential test suite, then continue the merge. Verify main's copy compiles before using it as a base. Test files can be corrupted the same way (destroyed fixture setup, duplicated tests) — restore or rebuild them from the last known-good version plus the incoming intent.
