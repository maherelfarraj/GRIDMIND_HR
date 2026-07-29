---
name: HRMS Architecture Decisions
description: Key build constraints and conventions for the HRMS enterprise HR system
---

## OpenAPI / Zod v3 compatibility
All `integer` types in `lib/api-spec/openapi.yaml` must use `number` — Orval 8.x generates `zod.int()` for `integer`, which is Zod v4 syntax and breaks the workspace (Zod v3). The codegen script in `lib/api-spec/package.json` also post-processes the output to replace any remaining `zod.int()` → `zod.number()`.

**Why:** Workspace uses Zod v3; Orval 8.x emits Zod v4 syntax for integer types.

**How to apply:** Any new integer fields in the OpenAPI spec must be declared as `type: number` (not `type: integer`).

## lib/api-zod index re-export
`lib/api-zod/src/index.ts` must export ONLY from `./generated/api` — not from a types re-export. A types re-export causes TS2308 collision on `GetEmployeeAttendanceParams` (and likely other params).

**Why:** The generated file and the types file both export the same symbol names.

## routes/index.ts must import all route files
`artifacts/api-server/src/routes/index.ts` is the single mount point for all 11 domain routers. Adding a new route file requires importing it here with `router.use(...)`.

## Database seed state
DB is seeded with fictional data: 10 departments, 6 roles, 15 employees, 6 system users, 8 attendance devices, 13 documents, 10 approvals, attendance records for 2026-07-27/28/29, 8 security alerts, 15 audit log entries.

## Design subagent job
The initial design subagent ran as jobId `initial-design:1` and completed. All 12 pages built. Use `sendFollowup({ name: "initial-design", message: "..." })` to continue it (do NOT use `subagent(...)` which starts a fresh one).

## Air-gap / deployment intent
No Replit/Supabase/cloud API deps. Auth placeholder: `/auth/me` returns first active system user (Keycloak/LDAP integration banner shown in UI). Biometric SDK callout shown on Devices page.
