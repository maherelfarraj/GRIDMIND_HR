# GRIDMIND HR — Enterprise HR Management System

![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/license-MIT-blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)

A production-grade, offline-first Human Resources Management System built for commercial companies, government organizations, and military institutions. Bilingual (English / Arabic with full RTL), dark-executive and light-operational theme modes, and deployable in air-gapped data-center environments.

---

## Screenshot

![HRMS Login Screen](screenshots/login.jpg)

---

## Key Features

| Category | Details |
|---|---|
| **Bilingual** | English + Arabic, full RTL layout |
| **Themes** | Dark executive + light operational |
| **Modules** | Dashboard, Employee Directory, Org Chart, Roles & Permissions, Documents, Approvals, Attendance, Attendance Devices, Audit Log, Security Alerts, System Users |
| **Coming soon** | Payroll, Leave Management, Recruitment |
| **Air-gap ready** | No mandatory cloud-service dependencies |
| **Attendance hardware** | ZKTeco, Hikvision, Suprema, Virdi (REST / OSDP / ZKAccess / Wiegand) |
| **IdP placeholder** | Keycloak / LDAP banner for enterprise SSO |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | pnpm workspaces |
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, Recharts, Framer Motion |
| **Backend** | Express, TypeScript, Drizzle ORM, Zod validation |
| **Database** | PostgreSQL (managed) |
| **API contract** | OpenAPI 3 spec → generated Zod schemas → React Query hooks |
| **Mobile** | Expo (React Native) |
| **Testing** | Vitest (unit + integration), Playwright (smoke / e2e) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser / Mobile                     │
│   artifacts/hrms  (React + Vite, port $PORT / 24170)        │
│   artifacts/mobile  (Expo React Native)                     │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP (JSON / REST)
┌────────────────────────▼────────────────────────────────────┐
│              artifacts/api-server  (Express, port 8080)     │
│   • Session auth (cookie + Bearer-shim for mobile)          │
│   • Zod request validation                                  │
│   • Drizzle ORM queries                                     │
│   • Attendance gateway (HMAC machine-auth, encrypted queue) │
│   • Audit log (DB trigger-based break-glass tagging)        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    PostgreSQL database                      │
└─────────────────────────────────────────────────────────────┘

Shared libraries (lib/)
  ├── api-spec          — OpenAPI 3 source of truth
  ├── api-zod           — generated Zod schemas (from spec)
  ├── api-client-react  — React Query hooks (from spec)
  ├── db                — Drizzle schema & migrations
  ├── attendance-gateway — HMAC auth + queue helpers
  └── session-activity  — session tracking utilities
```

---

## Repository Layout

```
.
├── artifacts/
│   ├── api-server/       Express REST API
│   ├── hrms/             React web front-end
│   ├── mobile/           Expo mobile app
│   └── mockup-sandbox/   Design canvas (internal)
├── lib/
│   ├── api-spec/         OpenAPI 3 definition
│   ├── api-zod/          Generated Zod schemas
│   ├── api-client-react/ React Query hooks
│   ├── db/               Drizzle ORM schema
│   ├── attendance-gateway/
│   └── session-activity/
├── scripts/
│   ├── regression.sh     Full regression suite
│   ├── run-smoke.sh      Playwright smoke suite
│   └── smoke/            Playwright config + tests
├── package.json          pnpm workspace root
└── pnpm-workspace.yaml
```

---

## Prerequisites

- **Node.js ≥ 24** (tested on v24)
- **pnpm ≥ 9** — install with `npm i -g pnpm`
- **PostgreSQL** — connection string supplied via environment variables

---

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/maherelfarraj/GRIDMIND_HR.git
cd GRIDMIND_HR

# 2. Install all workspace dependencies
pnpm install

# 3. Copy and fill in the environment variables (see section below)
cp .env.example .env
$EDITOR .env

# 4. Push the database schema
cd artifacts/api-server
npx drizzle-kit push
cd ../..

# 5. Start the API server
pnpm --filter @workspace/api-server run dev   # listens on :8080

# 6. In a second terminal, start the web front-end
pnpm --filter @workspace/hrms run dev         # listens on $PORT (default 24170)
```

Open your browser at `http://localhost:24170` (or whatever `$PORT` is set to).

### Mobile app

```bash
pnpm --filter @workspace/mobile run dev
# Follow the Expo QR-code / development build instructions
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in every value.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `PGDATABASE` | ✅ | PostgreSQL database name |
| `PGHOST` | ✅ | PostgreSQL host |
| `PGPORT` | ✅ | PostgreSQL port (typically `5432`) |
| `PGUSER` | ✅ | PostgreSQL user |
| `PGPASSWORD` | ✅ | PostgreSQL password |
| `SESSION_SECRET` | ✅ | Long random string used to sign session cookies |
| `ADMIN_RESET_PASSWORD` | ✅ | Temporary password for the `admin` account on first boot |
| `NODE_ENV` | — | `development` (default) or `production` |
| `PORT` | — | Port for the API server (default `8080`) |
| `FORCE_ADMIN_PASSWORD_RESET` | — | Set to `true` to force the admin account to re-provision on next boot |
| `SEED_DEMO_PASSWORDS` | — | Set to `true` + provide `DEMO_PILOT_PASSWORD` to seed demo accounts (dev only) |
| `DEMO_PILOT_PASSWORD` | — | Password applied to demo accounts when `SEED_DEMO_PASSWORDS=true` |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | — | Object-storage bucket for document uploads |
| `PUBLIC_OBJECT_SEARCH_PATHS` | — | Comma-separated paths served as public storage |
| `PRIVATE_OBJECT_DIR` | — | Server-side directory for private files |
| `ONE_TIME_PASSWORD_DIR` | — | Directory where operator OTP handoff files are written (default `.credentials/`) |

> **Security note:** `ADMIN_RESET_PASSWORD` and `SESSION_SECRET` must be strong, random values in production. One-time passwords are written to an operator-only `0600` file and **never** appear in logs.

---

## Running Tests

```bash
# Full type-check + unit tests
pnpm test

# Schema-drift guard (OpenAPI ↔ Drizzle ↔ Zod)
pnpm run typecheck:libs
cd artifacts/api-server
npx vitest run src/__tests__/schema-drift.test.ts \
               src/__tests__/openapi-drift.test.ts \
               src/__tests__/codegen-drift.test.ts

# Regression suite (standalone, no app workflows needed)
bash scripts/regression.sh

# Playwright smoke suite (requires both workflows running + admin password)
bash scripts/run-smoke.sh
```

### Smoke suite requirements

The smoke suite requires:
1. `artifacts/api-server: API Server` workflow running
2. `artifacts/hrms: web` workflow running  
3. At least one of: `SMOKE_ADMIN_PASSWORD`, `ADMIN_RESET_PASSWORD`, or `DEMO_PILOT_PASSWORD` set to a working admin password

---

## Seeded Demo Data

The database ships with fictional data:

- 10 departments (military org structure)
- 6 roles with permission sets
- 15 employees, 6 system users
- 8 attendance devices
- 13 documents, 10 approval requests
- Attendance records (3 days), 8 security alerts, 15 audit entries

Default demo accounts: `admin`, `fatima.zahrani`, `omar.ghamdi`, `aisha.otaibi`

---

## License

MIT © [maherelfarraj](https://github.com/maherelfarraj)
