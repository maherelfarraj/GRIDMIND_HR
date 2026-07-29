---
name: HRMS Architecture Decisions
description: Key build constraints and conventions for the HRMS enterprise HR system (Phase 1 + Phase 2)
---

## OpenAPI / Zod v3 compatibility
All `integer` types in `lib/api-spec/openapi.yaml` must use `number` — Orval 8.x generates `zod.int()` for `integer`, which is Zod v4 syntax and breaks the workspace (Zod v3). The codegen script in `lib/api-spec/package.json` also post-processes the output to replace any remaining `zod.int()` → `zod.number()`.

**Why:** Workspace uses Zod v3; Orval 8.x emits Zod v4 syntax for integer types.

**How to apply:** Any new integer fields in the OpenAPI spec must be declared as `type: number` (not `type: integer`).

## OpenAPI YAML — new paths must go in the paths section, NOT components
When adding new path blocks to `lib/api-spec/openapi.yaml`, the paths section ends just before `components:` at the top level. New paths (`/foo:`, `/foo/{id}:`) must be inserted within the `paths:` block (before the `components:` key), NOT inside `components:` or `components.schemas`.

**Why:** When using Edit tool anchored on a schema name inside `components.schemas`, the new content gets inserted as siblings of that schema (inside components), not inside paths. This breaks Orval codegen.

**How to apply:** Always anchor edits on content that is clearly inside the paths section, or use the Python split-and-reinsert technique if the YAML gets corrupted.

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

**Why:** Combining `md:static` and `fixed inset-y-0` with Tailwind doesn't correctly override.

## routes/index.ts must import all route files
`artifacts/api-server/src/routes/index.ts` is the single mount point for all domain routers. Adding a new route file requires importing it here with `router.use(...)`.

## Department list endpoint parentNameEn
The `GET /departments` list route resolves parent names inline using a dept map (no N+1). `parentNameEn` and `parentNameAr` both populated.

## Phase 2 new tables (all seeded)
- `shifts` — 8 shift definitions (AM/DS/PM/NS/XOP/ADM/FLX/ONC)
- `rosters` — employee-shift assignments (195 entries, 13 days × 15 employees)
- `overtime_rules` — 3 rules (Standard / Operations / Medical)
- `punch_events` — 164 events (CLOCK_IN, CLOCK_OUT, BREAK_START/END, OVERTIME_START/END, missing flagged)

## Phase 2 new API routes
- `/shifts` — CRUD + `/shifts/:id/roster` (GET with weekStart/weekEnd)
- `/rosters` — GET with filters, POST (upsert), POST /bulk, GET /summary, DELETE /:id
- `/overtime-rules` — CRUD
- `/punch-events` — GET with filters, POST, GET /missing, GET /:id, PATCH /:id

## Phase 2 new frontend pages
- `src/pages/shifts.tsx` — shift cards grid with color-bordered cards, new shift dialog
- `src/pages/rosters.tsx` — weekly grid table (employees × 7 days) with shift chips, week navigator
- `src/pages/overtime.tsx` — 2-tab: OT rules cards + OT report with recharts BarChart
- `src/pages/punch-events.tsx` — biometric audit log with event type/source badges, missing punch highlighting

## Seed script
Phase 2 seed is at `artifacts/api-server/src/lib/seed-phase2.ts`. Run via: `npx tsx artifacts/api-server/src/lib/seed-phase2.ts`

## Codegen command
`pnpm --filter @workspace/api-spec run codegen` — runs Orval → post-processes zod.int() → runs typecheck:libs. Must be run after any OpenAPI spec change.

## Database seed state
DB is seeded with fictional data: 10 departments, 6 roles, 15 employees, 6 system users, 8 attendance devices, 13 documents, 10 approvals, attendance records for 2026-07-27/28/29, 8 security alerts, 15 audit log entries, 20 device-employee mappings, 6 attendance corrections, 8 shifts, 195 roster entries, 3 overtime rules, 164 punch events.

## Air-gap / deployment intent
No Replit/Supabase/cloud API deps. Auth: localStorage-gated session + POST /auth/login (any password accepted in demo). All API routes at /api/* proxied by Vite dev server.

## Phase 3 tables + seed (all pushed to DB)
12 new tables: leaveTypes, leaveBalances, leaveRequests, leaveApprovalSteps, leaveAttachments, leaveDelegations, publicHolidays, salaryGrades, payComponents, payrollPeriods, payrollRuns, payrollRunLines. Seed script: `artifacts/api-server/src/lib/seed-phase3.ts`.
Employee `grade` field (G6–G12) must match salary grade `gradeCode` exactly — mismatch causes 100% payroll exceptions. Salary grades G6–G12 are now seeded.

## Leave approve/decide endpoint — decision values
The `/leave-requests/:id/decide` route normalizes decision to `"approved"` / `"rejected"`. It accepts both the canonical form (`"approved"`) and shorthand (`"approve"`). Always pass `stepId` (the DB record id), not `stepNumber`. The route now accepts both `stepId` and legacy `stepNumber` for lookup.

**Why:** Original route only accepted `"approve"`/`"reject"` shorthand but the frontend sends `"approved"`/`"rejected"`. Using `stepNumber` requires knowing the sequence; `stepId` is safer from the frontend.

## Payroll calculate — Drizzle timestamp vs string date
The `gte`/`lte` comparison for `punchEventsTable.eventTime` (a Drizzle `timestamp` column) requires a `Date` object, not a string. Pass `new Date(period.startDate)` and `new Date(period.endDate + "T23:59:59Z")` to avoid `value.toISOString is not a function`.

**Why:** Drizzle's `PgTimestamp.mapToDriverValue` calls `.toISOString()` on the value, failing if it's a string.

## Leave request steps key
`enrichRequest()` returns steps under the key `steps` (not `approvalSteps`). Frontend uses `req?.steps ?? []`.

## Phase 3 new frontend pages (7 total)
leave.tsx, leave-balances.tsx, leave-config.tsx, payroll.tsx, payroll-payslip.tsx, salary-grades.tsx, pay-components.tsx — all registered in App.tsx and Sidebar.tsx.

## Pre-existing TypeScript fixes applied
- `approvals.tsx`: mutation body key `data` (not `decision`), status values `approved`/`rejected` (not `approve`/`reject`), field `decisionNote` (not `notes`), field `assignedToUserName` (not `decidedByUsername`)
- `attendance.tsx`: `AttendanceRecord` has no `employeeNumber` (use `departmentNameEn`); `lateMinutes` is nullable (use `?? 0`)
- `departments.tsx`: `DepartmentNode` has no `organizationType` — TreeNode uses optional field with `?? 'commercial'` fallback
- `devices.tsx`: `DeviceHealth` fields are `signalStrength`, `recordsToday`, `errorLog.length`, `lastPingAt` (not `scanSuccessRate`, `totalScansToday`, `failedAttempts`, `lastHeartbeat`)
