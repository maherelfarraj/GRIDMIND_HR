---
name: HRMS Architecture Decisions
description: Key build constraints and conventions for the HRMS enterprise HR system (Phases 1–10 + audit)
---

## Monorepo layout
- `lib/db` — Drizzle + PostgreSQL, `composite: true` + `emitDeclarationOnly`. Must rebuild dist after any schema change: `pnpm --filter @workspace/db exec tsc --project tsconfig.json`. esbuild reads TS source directly, so runtime is fine before rebuild; `tsc --noEmit` will report stale dist errors.
- `artifacts/api-server` — Express, port 8080, esbuild bundle via `build.mjs`. All handlers: `async (req, res): Promise<void>` with `return void res.json(...)`. Static routes before `/:id`.
- `artifacts/hrms` — React + Vite. Routes via wouter. Dark theme bg-slate-900. i18n via `t(en, ar)`.
- `artifacts/mobile` — Expo React Native.
- Seed runner: `scripts/node_modules/.bin/tsx artifacts/api-server/src/lib/seed-phaseN.ts`

## Auth pattern (Phase 10 audit)
- `express-session` + `connect-pg-simple` wired in `app.ts` (uses `pool` from `@workspace/db`, NOT a new `pg.Pool` — direct `pg` import fails because pg is only in lib/db/node_modules).
- `artifacts/api-server/src/middleware/requireAuth.ts` exports `requireAuth()` and `getActorUserId()`.
- `PILOT_AUTH=true` → requireAuth returns 401 for unauthenticated mutations. Default false = demo mode (`?? 1` fallback via getActorUserId).
- Session augmentation in `src/types/session.d.ts`: userId, userRole, username.
- Frontend: `credentials: 'include'` on all auth fetch calls in `use-auth.tsx`. `artifacts/hrms/src/lib/api.ts` is a centralized fetch helper with 401 redirect.
- CORS in app.ts reflects origin + `credentials: true`.

## Weekend config
- `payroll.weekendDays` in `system_config` — JSON array, default `[5,6]` (Fri/Sat Saudi standard).
- Tests that depend on weekend config MUST set it in beforeAll and restore in afterAll (payroll-proration.test.ts shows the pattern). Seeded value may differ from test expectation.
- `getWeekendDays()` in `lib/weekend.ts` reads from DB, falls back to [5,6].

## Route & test patterns
- Test files are sequential (`--sequence`). Self-cleaning: insert → test → delete in beforeAll/afterAll.
- Schema drift test: `schema-drift.test.ts` compares live DB information_schema to Drizzle declarations. Run via `schema-drift` workflow.
- Durable rule: several modules are intentionally simulated (backups, health checks, report execution, local AI, most connection tests); check whether a module is real or simulated before asserting behavior — don't assume a feature is wired to real infrastructure just because a UI exists.
