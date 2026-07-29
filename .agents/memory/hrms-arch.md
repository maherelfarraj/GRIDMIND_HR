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

## useQueryClient import
`useQueryClient` must be imported from `@tanstack/react-query` directly, NOT from `@workspace/api-client-react`. Subagents repeatedly import it from the wrong package.

**Why:** `@workspace/api-client-react` does not re-export `useQueryClient`.

**How to apply:** Whenever a page needs cache invalidation, add `import { useQueryClient } from '@tanstack/react-query';` separately.

## useListEmployees data shape
`useListEmployees()` returns `{ data: Employee[], total, page, limit }` — NOT a bare array. Any `.map()` on the result must use `employees?.data?.map(...)`.

**Why:** Subagents consistently treat it as an array; causes runtime `employees?.map is not a function` crash.

## Auth session gating
`use-auth.tsx` must check `localStorage.getItem('hrms-session')` before calling `/api/auth/me` on mount. Without this gate, the API always returns the first active user (demo server has no real session), so the login page never appears.

**Why:** The demo `/api/auth/me` always returns a user; session must be localStorage-gated.

## Sidebar desktop layout
The Sidebar must NOT use `fixed` positioning on desktop. Use `hidden md:flex` for desktop static layout, and only add `flex fixed inset-y-0 start-0 z-50` when `isMobileOpen` is true.

**Why:** Combining `md:static` and `fixed inset-y-0` with Tailwind doesn't correctly override — desktop sidebar was covering content.

## routes/index.ts must import all route files
`artifacts/api-server/src/routes/index.ts` is the single mount point for all domain routers. Adding a new route file requires importing it here with `router.use(...)`.

## Department list endpoint parentNameEn
The `GET /departments` list route had `parentNameEn: null` hardcoded. Must build a dept map first and resolve parent names inline (avoids N+1 queries).

**Why:** Frontend org tree and table both display parent names; null broke the tree view.

## New DB tables (v2)
- `device_employee_mappings` — device-to-employee enrollment (biometric type, access level, active flag)
- `attendance_corrections` — punch correction requests with approval workflow (pending/approved/rejected)
Both pushed and seeded.

## New API routes (v2)
- `GET/POST /devices/:id/mappings`, `DELETE /devices/:id/mappings/:employeeId`
- `GET /attendance/corrections`, `POST /attendance/:id/correction`, `PATCH /attendance/corrections/:id/decision`
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /device-mappings?deviceId=X` (global filter)

## Database seed state
DB is seeded with fictional data: 10 departments, 6 roles, 15 employees, 6 system users, 8 attendance devices, 13 documents, 10 approvals, attendance records for 2026-07-27/28/29, 8 security alerts, 15 audit log entries, 20 device-employee mappings, 6 attendance corrections.

## Design subagent job
The v2 design subagent ran as jobId `hrms-ui-v2:19` and completed. All 11 files built. Use `sendFollowup({ name: "hrms-ui-v2", message: "..." })` to continue it (do NOT use `subagent(...)` which starts a fresh one).

## Air-gap / deployment intent
No Replit/Supabase/cloud API deps. Auth: localStorage-gated session + POST /auth/login (any password accepted in demo). Keycloak/LDAP integration banner shown in UI. Biometric SDK callout on Devices page.
