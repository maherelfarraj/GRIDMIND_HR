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
- Route audit (July 2026): 42 routes smoke-tested, 0 returned 5xx. Route aliases: `/api/audit-logs` (not /audit), `/api/users` (not /system-users), `/api/attendance/corrections` (not /attendance-corrections).
- Schema drift test: `schema-drift.test.ts` compares live DB information_schema to Drizzle declarations. Run via `schema-drift` workflow.

## Honest production state (July 2026)
- REAL: payroll calculation, 3-tier OT from punch events, leave balances, LDAP/SMTP/device adapters, connection health monitor, config package HMAC, policy maker-checker, audit logging, proration.
- SIMULATED: backup execution (records only, no pg_dump), restore tests, system health checks, software update apply, report execution, local AI (all 4 endpoints), non-LDAP/SMTP/device connection tests.
- BLOCKED: authentication guards (PILOT_AUTH=false by default), RBAC, cross-org isolation, Keycloak SSO.
- MISSING: docker-compose, Keycloak config, air-gap deployment docs, biometric vendor SDK protocols.

## Pages added (Phase 10 + audit)
- `/readiness` — Module Readiness Report with static blockers list (never misleads even if API down)
- `/pilot-control-center` — live go-live gate evaluation from DB
- `/uat-scripts` — 30 scripts × 9 roles, step-by-step runner
- `/security-tests` — automated security scenario runner
