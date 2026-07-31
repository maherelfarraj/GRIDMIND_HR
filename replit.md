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

## Pilot auth password provisioning
- Demo accounts (admin, fatima.zahrani, omar.ghamdi, aisha.otaibi) have bcrypt password hashes stored in the DB; admins can set/reset any password from the System Users page.
- Optional re-provisioning at server boot is strictly opt-in: set `SEED_DEMO_PASSWORDS=true` and `DEMO_PILOT_PASSWORD=<value>` at runtime (never committed); it never overwrites an existing hash. In production it never provisions a known demo password: NULL-hash demo accounts get a random one-time password written to an operator-only 0600 handoff file (path via `ONE_TIME_PASSWORD_DIR`, default `.credentials/`; never logged) with must_change_password=true, and accounts still using the demo password are flagged to rotate at next login.
