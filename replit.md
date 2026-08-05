# HRMS Command — Enterprise HR Management System

A production-grade, offline-first Human Resources Management System built for commercial companies, government organizations, and military institutions.

## Architecture

- **Monorepo**: pnpm workspaces
- **Frontend**: `artifacts/hrms` — React + Vite, TypeScript, Tailwind CSS, Recharts, Framer Motion
- **Backend**: `artifacts/api-server` — Express, TypeScript, Drizzle ORM, Zod validation
- **Database**: PostgreSQL (Replit managed)
- **Shared libs**: `lib/api-spec` (OpenAPI), `lib/api-zod` (generated Zod schemas), `lib/api-client-react` (React Query hooks), `lib/db` (Drizzle schema)

## Key Features

- **Bilingual EN/AR** with full RTL layout support
- **Dark executive + light operational** theme modes
- **12 modules**: Dashboard, Employee Directory, Org Chart, Roles & Permissions, Documents, Approvals, Attendance, Attendance Devices, Audit Log, Security Alerts, System Users
- **Coming soon placeholders**: Payroll, Leave Management, Recruitment
- **Air-gap / data-center ready**: no cloud service dependencies
- **Attendance hardware integration**: ZKTeco, Hikvision, Suprema, Virdi devices (REST/OSDP/ZKAccess/Wiegand)
- **Integration placeholders**: Keycloak/LDAP banner (IdP), Biometric SDK callout

## Running the App

Both workflows must be running:
1. `artifacts/api-server: API Server` — Express API on port 8080
2. `artifacts/hrms: web` — Vite dev server

## Database

Seeded with fictional data:
- 10 departments (military org structure)
- 6 roles with permission sets
- 15 employees
- 6 system users
- 8 attendance devices
- 13 documents
- 10 approval requests
- Attendance records for 3 days
- 8 security alerts
- 15 audit log entries

## User Preferences

- Fictional/synthetic seed data only — no real PII
- No Replit/Kimi/Supabase cloud API dependencies
- PostgreSQL backend (Drizzle ORM)
- All `integer` types in OpenAPI spec use `number` (Zod v3 compatibility — avoids `zod.int()`)
- Bilingual labels on all UI elements

## Smoke Suite

Headless-browser smoke suite that catches admin-screen breakages after API changes.

### Files

```
scripts/run-smoke.sh          — entry point (resolves Chromium, installs deps, runs Playwright)
scripts/smoke/
  package.json                — standalone npm package (NOT in pnpm workspace)
  playwright.config.ts        — baseURL=localhost:80, nix Chromium, global-setup
  global-setup.ts             — API-context login → auth.json (handles mustChangePassword)
  tests/admin-smoke.spec.ts   — 5 page tests with mutation + cleanup
```

### Prerequisites

1. `artifacts/api-server: API Server` workflow must be running
2. `artifacts/hrms: web` workflow must be running
3. At least one of these env vars must hold a working admin password:
   - `ADMIN_RESET_PASSWORD` ← preferred (already configured as a secret)
   - `DEMO_PILOT_PASSWORD`
   - `SMOKE_ADMIN_PASSWORD`

### Run command

```bash
bash scripts/run-smoke.sh
# or via the 'smoke' Replit workflow
```

Pass extra Playwright flags directly: `bash scripts/run-smoke.sh --headed`, `--grep "Pilot"`, etc.

### What it covers

| Page | Path | Mutation exercised |
|---|---|---|
| Pilot Control Center | `/pilot-control-center` | Evaluate All Gates (idempotent re-eval) |
| Policy Governance | `/policy-governance` | Create draft PCR → withdraw (cleaned up in test) |
| Policy Localization | `/policy-localization` | Create numbering scheme → deleted in afterAll |
| Attendance Gateway | `/attendance-gateway` | Create `smoke-test-*` registration → revoked in afterAll |
| Integration Governance | `/integration-governance` | Walk all 4 tabs + Run health checks now |

### Failure modes detected

- **Console errors**: any `console.error()` emitted by the page fails the test
- **Failed API requests**: any HTTP 4xx/5xx response fails the test (Vite HMR noise filtered)
- **Stuck loading**: test fails if `animate-pulse.rounded-md` skeleton loaders are still visible after `networkidle`

### Credentials required

The suite needs exactly one of these env vars set to a working admin password
(tried in this order by `global-setup.ts`):

| Env var | Purpose |
|---|---|
| `SMOKE_ADMIN_PASSWORD` | Dedicated smoke credential — preferred for ongoing use |
| `ADMIN_RESET_PASSWORD` | Operator-supplied reset password (already set in this env) |
| `DEMO_PILOT_PASSWORD` | Dev seeding password |

No password is ever hard-coded in the suite source. `auth.json` (session cookie + localStorage)
is written at runtime and listed in `.gitignore` — it must never be committed.

### mustChangePassword — fail-safe by default

If every candidate either fails to authenticate or returns `mustChangePassword=true`,
global-setup **fails immediately** with a clear, actionable error. It never silently changes
credentials.

**Why:** a smoke run silently calling `change-password` would consume a one-time-password the
operator hasn't collected yet (Task #341 — OTP onboarding flow). This fail-safe preserves that.

**When you see a mustChangePassword error:**

Option A (preferred) — use the credential normally:
1. Check `.credentials/one-time-passwords-*.json` for the admin OTP.
2. Sign in, change the password via the UI.
3. Re-run — global-setup will now authenticate cleanly.

Option B (isolated dev/CI only) — opt-in rotation:
```bash
SMOKE_ALLOW_PASSWORD_ROTATION=true \
SMOKE_ROTATION_PASSWORD=<new-strong-password> \
bash scripts/run-smoke.sh
```
Guards: refused when `NODE_ENV=production` or `REPLIT_DEPLOYMENT` is set.
`SMOKE_ROTATION_PASSWORD` is required (no default, no fallback). Every mutation is logged loudly.
After rotation, set `SMOKE_ADMIN_PASSWORD=<SMOKE_ROTATION_PASSWORD value>` for subsequent runs.

### Resetting the admin account

To force-reset (e.g. after a DB wipe): set `FORCE_ADMIN_PASSWORD_RESET=true` +
`ADMIN_RESET_PASSWORD=<strong-pw>`, restart the API server, collect the OTP from
`.credentials/`, sign in, change the password, then re-run the smoke suite.

### Run before/after redeploys

Run `bash scripts/run-smoke.sh` before and after any deployment or API change that touches
admin routes to catch regressions early. The suite is intentionally NOT wired into `regression.sh`
because it requires both app workflows running; `regression.sh` runs standalone.

## Pilot auth password provisioning
- Demo accounts (admin, fatima.zahrani, omar.ghamdi, aisha.otaibi) have bcrypt password hashes stored in the DB; admins can set/reset any password from the System Users page.
- Optional re-provisioning at server boot is strictly opt-in: set `SEED_DEMO_PASSWORDS=true` and `DEMO_PILOT_PASSWORD=<value>` at runtime (never committed); it never overwrites an existing hash. In production it never provisions a known demo password: NULL-hash demo accounts get a random one-time password written to an operator-only 0600 handoff file (path via `ONE_TIME_PASSWORD_DIR`, default `.credentials/`; never logged) with must_change_password=true, and accounts still using the demo password are flagged to rotate at next login.
