---
name: HRMS Architecture Decisions
description: Key build constraints and conventions for the HRMS enterprise HR system (Phases 1–4)
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


## Orval hook options require queryKey
Passing `{ query: { enabled: ... } }` to generated query hooks fails typecheck (this Orval version's UseQueryOptions requires queryKey). Omit the options arg instead of using `enabled`.


## Approval-style endpoints: atomic claim + conditional deduction in one transaction
Any approve/decide endpoint must (1) claim the row with a conditional update (`WHERE status='pending'`, fail on 0 rows), (2) deduct quotas with a single atomic conditional SQL update (`SET used = used + n WHERE remaining >= n`), and (3) run all side effects in one `db.transaction`. Creation-time validation alone is insufficient — pending requests reserve nothing, and read-then-write balance updates race under concurrency.

**Why:** Concurrent approvals can otherwise overdraw entitlements or double-process a request.
**How to apply:** Applies to leave decisions and any future approval/quota flows (overtime, corrections, payroll adjustments).

## Payroll module (Phase 3)
- Canonical payroll implementation came from the leave-management branch: `salary_grades` (pct-based allowances, org type), `payroll_periods`, `payroll_runs` (per employee × period), `payroll_run_lines`, `pay_components`, `public_holidays`; routes salaryGrades/payComponents/payrollPeriods/payrollRuns; pages /payroll, /payroll/payslip/:id, /payroll/grades, /payroll/components.
- A parallel simpler payroll engine (payroll_entries + routes/payroll.ts + seed-payroll.ts) was dropped at merge time in favor of the leave-integrated one — do not reintroduce it.
- After adding schema files, run `npx tsc -b lib/db` — composite project; api-server typecheck reads stale dist/*.d.ts otherwise.

## Generated hook query options
Orval hooks type `options.query` as full `UseQueryOptions` (requires `queryKey`), so passing partial options like `{ query: { refetchInterval: 60000 } }` needs an `as any` cast.

## Dashboard history seed
`artifacts/api-server/src/lib/seed-dashboard-history.ts` backfills 30 days of attendance (idempotent, skips existing dates, Fri/Sat off) so 30-day analytics have data. Re-run if DB is reseeded.

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

## Phase 4 new DB tables (17 total)
systemConfig, militaryRanks, orgUnits, dutyStations, employeePostings, employeeTransfers, employeeSecondments, securityClearances, mobilizationStatuses, chainOfCommand, dualAuthRequests, breakGlassAccess, privilegedSessions, branchServers, syncQueue, backupRecords, licenseRecords — all in lib/db/src/schema/, exported from index.ts, pushed to DB, seeded via seed-phase4.ts.

**Why:** Phase 4 "Government / Military Readiness" layer on top of commercial HRMS.

**How to apply:** All defense features are gated by system_config key "org.type" (commercial/government/military). Seeded as "military" in demo. orgUnitsTable has self-referential parentId (plain integer, no FK constraint in Drizzle). backupRecords.fileSizeBytes is integer — values must be <2,147,483,647 (use numeric for larger values).

## Phase 4 seed pitfalls
orgUnitsTable inserts must use returned IDs for parentId — do NOT hardcode sequential IDs since postgres sequences don't reset on DELETE. employeePostings/transfers must reference these real IDs via the returned objects.

## Phase 4 org unit tree route ordering
GET /org-units/tree MUST be registered before GET /org-units/:id in Express, otherwise the string "tree" gets parsed as a numeric ID and returns 404.

## Phase 4 new frontend pages (8 total)
system-config, military-hierarchy, duty-stations, postings, security-clearances, mobilization, security-settings, admin-airgap — all in artifacts/hrms/src/pages/, lazy-imported in App.tsx, linked in Sidebar.tsx under "Military & Government" and "System Admin" sections.

## Phase 5 tables (19 schema files, all pushed + seeded via seed-phase5.ts)
jobRequisitions, jobPostings, applicants, applications, interviewScores, backgroundChecks, jobOffers, employmentContracts, onboardingTemplates, employeeOnboarding (+ onboardingTemplateItems + onboardingTasks), probationRecords, equipmentIssuances (+ idCardRecords), competencies (+ competencyFrameworks), goalCycles (+ employeeGoals), appraisals (+ appraisalRecords + appraisalCompetencyRatings + calibrationSessions), disciplinaryRecords (+ commendations + promotionRecommendations), training (7 tables), succession (4 tables), selfService (3 tables).

## Phase 5 seed
`artifacts/api-server/src/lib/seed-phase5.ts` — requires `import { db } from "@workspace/db"` (not `"../lib/db.js"`). Map callbacks need explicit type annotations: `(item: typeof templateItems[0], idx: number)`.

## Phase 5 frontend pages (11 total)
recruitment, recruitment-application, onboarding, probation, performance, disciplinary, training, skills, succession, my-portal, manager-portal. All in artifacts/hrms/src/pages/, registered in App.tsx and Sidebar.tsx. Key type fixes: Employee has no `fullNameEn` (use firstNameEn+lastNameEn), no `badgeNumber` (use employeeNumber); LeaveBalance has no `.balance` (use `available ?? openingBalance`).

## Phase 5 task implementations (tasks #8, #9, #10)
- **#8 medical cert gating**: POST /leave-requests/:id/submit returns 422 ATTACHMENT_REQUIRED if leaveType.requiresAttachment=true and no attachments. Frontend shows cert upload panel.
- **#9 revoke approved leave**: POST /leave-requests/:id/revoke restores balance (subtracts from used), resets roster rows status="scheduled", sets request status="cancelled".
- **#10 annual leave reset**: POST /leave-balances/annual-reset iterates all employees × active leave types, skips existing rows for target year, computes carryover = min(available_prev_year, maxCarryoverDays).

## zod.int() runtime crash fix
After any codegen run, scan `lib/api-zod/src/generated/*.ts` and `lib/api-client-react/src/generated/*.ts` for `zod.int()` and replace with `zod.number()`. The codegen post-processor should handle it but a subagent's partial regeneration can miss the step. Command: `python3 -c "import glob; [open(f,'w').write(open(f).read().replace('zod.int()','zod.number()')) for f in glob.glob('lib/api-zod/src/generated/*.ts')]"`

## Phase 6 tables (4 schema files, all pushed + seeded via seed-phase6.ts)
- `lib/db/src/schema/documentManagement.ts` — documentCategories, enterpriseDocuments, documentVersions, documentAccessLogs, documentAcknowledgements, documentTemplates
- `lib/db/src/schema/reporting.ts` — reportDefinitions, savedReportFilters, reportSchedules, reportOutputs
- `lib/db/src/schema/notifications.ts` — notifications, notificationPreferences, escalationRules, approvalInboxItems
- `lib/db/src/schema/deploymentOps.ts` — healthChecks, updatePackages, deploymentEvents, installationReadiness

## Phase 6 routes (15 files, all mounted in routes/index.ts)
documentCategories, enterpriseDocuments, documentTemplates, reportDefinitions, savedReportFilters, reportSchedules, reportOutputs, notifications, notificationPreferences, escalationRules, approvalInbox, healthChecks, updatePackages, deploymentEvents, installationReadiness. Key ordering: `POST /mark-all-read` before `/:id` in notifications; `GET /results` and `POST /run` before `/:id` in healthChecks; `POST /run` before `/:id` in installationReadiness.

## Phase 6 frontend pages (4 total)
document-management (3 tabs: Documents/Templates/Categories), reports (3 tabs: Run Reports/Scheduled/Output History), notifications (2 tabs: Inbox/Escalation Rules), deployment (4 tabs: Health Checks/Update Packages/Deployment Events/Readiness). Sidebar sections added: "Documents & Reports" and "System".

## OpenAPI spec size history
Phase 3: ~3,200 lines → Phase 4: ~5,300 → Phase 5: ~9,485 → Phase 6: ~11,068 lines, 401 operationIds, 4 new tags (Documents, Reports, Notifications, DeploymentOps).
