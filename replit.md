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
