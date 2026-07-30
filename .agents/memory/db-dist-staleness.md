---
name: DB package staleness & schema drift
description: Two failure modes after editing lib/db schema — stale dist d.ts and unpushed DB columns.
---
Update: `lib/db` now has `build`/`typecheck` scripts (`tsc -b`), and root `typecheck` and `test` both build libs first (`typecheck:libs`), so staleness only bites when running a single artifact's typecheck in isolation.

Rule: after any change to `lib/db/src/schema/*`, (1) run `pnpm exec tsc -b` in `lib/db` — a stale `dist/*.d.ts` shadows the source exports and downstream typechecks fail with "property does not exist" even though the column is in src; (2) run `pnpm run push` in `lib/db` — schema columns can exist in code but not in the live DB, making every select on that table fail at runtime with a generic "Failed query" error that hides the missing-column cause.

**Why:** hit both at once — api-server typecheck failed on a column present in src, and the connection-profiles endpoint 500'd because two lastTest columns were never pushed.

**How to apply:** whenever a drizzle select fails with "Failed query" and no reason, `\d <table>` via psql first; whenever @workspace/db types look wrong, rebuild lib/db before debugging.

Update (Jul 2026): `pnpm run push` in lib/db now prompts to DROP the live `session` table (managed by connect-pg-simple, outside drizzle) and dies without a TTY. For additive column changes, apply `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` via psql instead, and let the schema-drift test confirm parity. Also: orval codegen emits zod-v4-only `zod.looseObject(` under zod v3 — the codegen script's postprocess now rewrites it to `zod.object(`.
