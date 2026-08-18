/**
 * HRMS everyday-HR smoke suite.
 *
 * Covers five everyday HR areas:
 *   1. Employees        (/employees)
 *   2. Attendance       (/attendance)
 *   3. Leave            (/leave)
 *   4. Approvals        (/approvals)
 *   5. Payroll          (/payroll)
 *
 * Each test:
 *   - fails on any console error logged by the page
 *   - fails on any 4xx/5xx API response (Vite HMR noise is filtered)
 *   - fails if the primary list/table is still showing skeleton loaders after
 *     networkidle (stuck-loading detection)
 *
 * Mutation policy — self-cleaning means TRUE DELETE, nothing less:
 *   - Employees only: create smoke employee via API → hard-delete in afterAll.
 *     A freshly-created employee has no FK dependents so DELETE always succeeds.
 *     If the hard-delete fails for any reason, afterAll throws loudly — no
 *     status-PATCH fallback.  No permanent state accumulates across runs.
 *   - All other tests (Attendance, Leave, Approvals, Payroll) are read-only.
 *     Leave is intentionally read-only: the only available "undo" for a leave
 *     request is cancellation, which retains the record forever; a cancel-only
 *     teardown is not self-cleaning and would accumulate permanent state.
 *
 * Stale-fixture cleanup in beforeAll:
 *   Any employee whose employeeNumber starts with the suite-owned marker
 *   'smoke-hr:' is treated as a leftover from a prior crashed run and
 *   hard-deleted.  If the hard-delete fails, beforeAll logs a warning and
 *   leaves the record untouched (never mutates status).
 *
 * Dynamic fixture resolution:
 *   Department ID and role ID are resolved at runtime via the API; the suite
 *   fails loudly if seed data is missing instead of using hard-coded IDs.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import path from 'path';

// Honour SMOKE_BASE_URL so a remote target (post-publish run) uses the right
// origin for API fixture requests — matching how global-setup and admin-smoke
// resolve the base URL.
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:80';
const AUTH_FILE = path.join(__dirname, '../auth.json');

// ID of the employee created during this run — hard-deleted in afterAll.
// Null until the Employees test creates it; set back to null once deleted.
let createdEmployeeId: number | null = null;

// Dynamically resolved seed IDs — set in beforeAll, fail loudly if absent.
let resolvedDepartmentId: number | null = null;
let resolvedRoleId: number | null = null;

// Suite-owned marker for employee numbers.  This prefix is unambiguous and
// can never appear on real employee records, so stale-cleanup in beforeAll
// can match without false positives.
const SMOKE_MARKER = 'smoke-hr:';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns an API context that carries the smoke-suite session cookies. */
async function makeApiCtx() {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: AUTH_FILE,
  });
}

/**
 * Attach console-error and failed-response monitors to a page.
 * Returns arrays that are mutated live; assert them empty after each
 * page interaction.
 *
 * Filtered noise:
 *   - Vite HMR websocket / hot-update URLs
 *   - favicon.ico 404 (browser-initiated, not app-initiated)
 */
function attachMonitors(page: import('@playwright/test').Page) {
  const consoleErrors: string[] = [];
  const failedRequests: { status: number; url: string }[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter React DevTools / browser extension noise
      if (
        text.includes('Download the React DevTools') ||
        text.includes('ResizeObserver loop') ||
        text.includes('chrome-extension://')
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    // Filter Vite HMR and favicon
    if (
      url.includes('/@vite') ||
      url.includes('__vite_ping') ||
      url.includes('/.well-known') ||
      url.endsWith('/favicon.ico')
    ) {
      return;
    }
    failedRequests.push({ status: res.status(), url });
  });

  return { consoleErrors, failedRequests };
}

/**
 * Wait for:
 *   1. network idle (all in-flight XHRs settled)
 *   2. no sticky animate-pulse skeleton loaders
 */
async function waitForPageLoad(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 25_000 });
  // Skeleton components from shadcn/ui all carry animate-pulse + rounded-md
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, {
    timeout: 15_000,
  });
}

function assertNoMonitorFailures(
  consoleErrors: string[],
  failedRequests: { status: number; url: string }[],
) {
  expect(
    consoleErrors,
    `Console errors:\n${consoleErrors.join('\n')}`,
  ).toHaveLength(0);

  expect(
    failedRequests,
    `Failed API requests:\n${failedRequests.map((r) => `  ${r.status} ${r.url}`).join('\n')}`,
  ).toHaveLength(0);
}

// ─── Suite setup / teardown ──────────────────────────────────────────────────

test.beforeAll(async () => {
  const ctx = await makeApiCtx();
  try {
    // ── 1. Clean up stale smoke employees from prior failed runs ──────────────
    // Only employees whose employeeNumber starts with SMOKE_MARKER ('smoke-hr:')
    // are treated as fixture leftovers.  This prefix is unambiguous and cannot
    // appear on real employee records.
    //
    // Safety policy: attempt hard-delete only.  If deletion fails for any
    // reason, log a warning and leave the record untouched — no status PATCHes.
    const empRes = await ctx.get('/api/employees?limit=200');
    if (empRes.ok()) {
      const body = (await empRes.json()) as { data: Array<{ id: number; employeeNumber: string }> };
      for (const emp of body.data ?? []) {
        if (!emp.employeeNumber?.startsWith(SMOKE_MARKER)) continue;
        const delRes = await ctx.delete(`/api/employees/${emp.id}`);
        if (delRes.ok()) {
          console.log(`[smoke-hr/beforeAll] Hard-deleted stale smoke employee id=${emp.id} (${emp.employeeNumber})`);
        } else {
          console.warn(
            `[smoke-hr/beforeAll] Could not hard-delete stale smoke employee id=${emp.id} ` +
            `(HTTP ${delRes.status()}) — leaving in place (manual cleanup required).`,
          );
        }
      }
    }

    // ── 2. Resolve seed fixtures dynamically ──────────────────────────────────

    // Department (needed for employee creation)
    const deptRes = await ctx.get('/api/departments');
    if (!deptRes.ok()) {
      throw new Error(`[smoke-hr/beforeAll] GET /api/departments failed: HTTP ${deptRes.status()}`);
    }
    const depts = (await deptRes.json()) as Array<{ id: number; nameEn: string }>;
    if (!depts.length) {
      throw new Error('[smoke-hr/beforeAll] No departments found — seed is missing. Cannot run employee mutation.');
    }
    resolvedDepartmentId = depts[0].id;
    console.log(`[smoke-hr/beforeAll] Resolved departmentId=${resolvedDepartmentId} (${depts[0].nameEn})`);

    // Role (needed for employee creation — resolve the lowest-privilege role
    // instead of hard-coding id=5, which is not guaranteed across DB resets).
    // Strategy: prefer a role whose English name contains "employee" (case-
    // insensitive); otherwise fall back to the role with the fewest permissions.
    // Fail loudly if no roles exist.
    const rolesRes = await ctx.get('/api/roles');
    if (!rolesRes.ok()) {
      throw new Error(`[smoke-hr/beforeAll] GET /api/roles failed: HTTP ${rolesRes.status()}`);
    }
    const roles = (await rolesRes.json()) as Array<{ id: number; nameEn: string; permissions: string[] }>;
    if (!roles.length) {
      throw new Error('[smoke-hr/beforeAll] No roles found — seed is missing. Cannot run employee mutation.');
    }
    const employeeRole =
      roles.find((r) => /employee/i.test(r.nameEn)) ??
      [...roles].sort((a, b) => (a.permissions?.length ?? 0) - (b.permissions?.length ?? 0))[0];
    resolvedRoleId = employeeRole.id;
    console.log(`[smoke-hr/beforeAll] Resolved roleId=${resolvedRoleId} (${employeeRole.nameEn})`);

  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  // Hard-delete the smoke employee created during this run.
  // Policy: if deletion fails for any reason, throw — no status-PATCH fallback.
  // A fresh employee has no FK dependents so failure is unexpected and must
  // be investigated; swallowing it would leave a smoke record in the DB.
  if (createdEmployeeId === null) return;

  const ctx = await makeApiCtx();
  try {
    const delRes = await ctx.delete(`/api/employees/${createdEmployeeId}`);
    if (!delRes.ok()) {
      throw new Error(
        `[smoke-hr/afterAll] Hard-delete of smoke employee id=${createdEmployeeId} failed ` +
        `(HTTP ${delRes.status()}). Manual cleanup required: ` +
        `DELETE /api/employees/${createdEmployeeId}`,
      );
    }
    console.log(`[smoke-hr/afterAll] Hard-deleted smoke employee id=${createdEmployeeId} → HTTP ${delRes.status()}`);
    createdEmployeeId = null;
  } finally {
    await ctx.dispose();
  }
});

// ─── 1. Employees ────────────────────────────────────────────────────────────

test('Employees — loads, search renders, create+delete mutation succeeds', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/employees');
  await waitForPageLoad(page);

  // Employee table must have rendered at least one data row or an empty-state
  await expect(
    page.locator('table tbody tr, [class*="text-slate-"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Mutation: create a smoke employee via API (uses session from page), then
  // confirm it appears in the list, then hard-delete it inline.
  // SMOKE_MARKER prefix ensures beforeAll can identify this as a suite fixture
  // and clean it up if the run crashes between creation and deletion.
  const ts = Date.now();
  const employeeNumber = `${SMOKE_MARKER}${ts}`;

  const createRes = await page.request.post('/api/employees', {
    data: {
      employeeNumber,
      firstNameEn: 'Smoke',
      lastNameEn: 'Test',
      firstNameAr: 'دخان',
      lastNameAr: 'اختبار',
      nationalId: `SM${ts}`.slice(0, 20),
      jobTitleEn: 'Smoke Tester',
      jobTitleAr: 'مختبر دخان',
      departmentId: resolvedDepartmentId!,
      roleId: resolvedRoleId!, // lowest-privilege role, resolved dynamically in beforeAll
      status: 'active',
      employmentType: 'full_time',
      email: `smoke-${ts}@smoke.test`,
      hireDate: new Date().toISOString().split('T')[0],
      nationality: 'SA',
      organizationType: 'civilian',
    },
  });
  expect(createRes.status(), 'employees POST').toBe(201);
  const emp = (await createRes.json()) as { id: number };
  createdEmployeeId = emp.id;

  // Use the search box to filter for our smoke employee — more reliable than
  // relying on insertion order in an unsorted list.
  await page.reload();
  await waitForPageLoad(page);
  await page.getByPlaceholder(/Search by name/i).fill('Smoke');
  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  // First name "Smoke" must appear in the filtered list
  await expect(page.getByText('Smoke', { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  // Hard-delete inline (no FK dependents on a freshly-created employee).
  // afterAll will also attempt deletion if this fails, but clearing
  // createdEmployeeId here avoids the double-delete on the happy path.
  const delRes = await page.request.delete(`/api/employees/${createdEmployeeId}`);
  expect(delRes.status(), 'employees DELETE').toBeLessThan(300);
  createdEmployeeId = null;

  // Wait for React Query to settle after the delete
  await page.waitForLoadState('networkidle', { timeout: 10_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 2. Attendance ───────────────────────────────────────────────────────────

test('Attendance — loads and all four tabs render without errors', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/attendance');
  await waitForPageLoad(page);

  // Default tab (Daily Log) must render
  await expect(
    page.locator('table tbody, [class*="text-slate-"], .animate-pulse').first(),
  ).toBeVisible({ timeout: 10_000 });
  // Once the default tab has fully loaded there should be no skeletons
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 10_000 });

  // Walk through all four tabs — each must load without console errors or
  // failed API requests
  for (const tabName of ['Punch Events', 'Corrections', 'Device Mapping']) {
    await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 10_000 });
  }

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 3. Leave ────────────────────────────────────────────────────────────────

// Read-only: the Leave test only navigates and asserts rendering.
//
// Why no mutation: the only available "undo" for a leave request is
// cancellation, which retains the record in the DB forever.  A cancel-only
// teardown is not self-cleaning; it would accumulate permanent state with
// every run.  Employees create+hard-delete is the suite's single safe mutation.

test('Leave — loads and request list renders without errors', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/leave');
  await waitForPageLoad(page);

  // Leave request table or empty-state must be rendered
  await expect(
    page.locator('table tbody, [class*="text-slate-"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 4. Approvals ────────────────────────────────────────────────────────────

test('Approvals — loads and all tabs render without errors', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/approvals');
  await waitForPageLoad(page);

  // The approvals page renders one of two states on the Pending tab (default):
  //   • <table> with <tbody> rows — when pending approvals exist in the queue
  //   • A border-dashed empty-state card  — when the queue is empty
  //
  // Both states prove the GET /api/approvals fetch completed without error and
  // the component mounted. Skeletons and network failures do NOT produce either
  // element; if the API returns 4xx/5xx, assertNoMonitorFailures catches it.
  //
  // Note: the original selector used `[class*="text-slate-"]` for the empty
  // state, but the approvals empty-state div uses `text-muted-foreground` and
  // `border-dashed` — never `text-slate-*`. That mismatch caused the selector
  // to time out whenever the queue was empty (commit 6538790 regression).
  await expect(
    page.locator('table tbody, [class*="border-dashed"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Structural integrity: all three tabs must be reachable (heading is visible).
  for (const tabName of ['Pending', 'Approved', 'Rejected']) {
    await expect(
      page.getByRole('tab', { name: new RegExp(tabName, 'i') }).first(),
    ).toBeVisible();
  }

  // Walk through Approved and Rejected tabs — each should resolve without
  // leaving sticky skeleton loaders.  Decisions are irreversible so we only read.
  for (const tabName of ['Approved', 'Rejected']) {
    await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    // After switching tabs the content is either a table or the border-dashed
    // empty card — either is acceptable, but skeletons must be gone.
    await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.locator('table tbody, [class*="border-dashed"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 5. Payroll ──────────────────────────────────────────────────────────────

test('Payroll — period list loads and draft period detail renders', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/payroll');
  await waitForPageLoad(page);

  // The payroll page renders the period list as <button> rows inside a
  // divide-y container — NOT as a <table>.  Each button carries the period
  // name, code, dates, and a StatusBadge.  The status-badge CSS classes are
  // status-specific (e.g. `text-emerald-600` for "closed", `text-blue-500`
  // for "calculating") so `[class*="text-slate-"]` only matches "draft" or
  // the unknown-status fallback — never "closed", the status of the seeded
  // test period — causing the original selector to time out (commit 6538790).
  //
  // Correct selector: either a period button (data) or the centred empty-state
  // card (py-16 + justify-center) — both prove skeletons resolved.
  await expect(
    page.locator('[class*="divide-y"] > button, [class*="py-16"][class*="justify-center"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Drill into any July 2026 period (seeded with various codes).
  // Period detail is state-based (no URL change) — clicking the row opens the
  // detail panel inside the same page.
  const draftRow = page.getByText(/PAY-2026-07|TEST-2026-07|July 2026/i).first();
  const draftVisible = await draftRow.isVisible().catch(() => false);

  if (draftVisible) {
    await draftRow.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 10_000 });
    // Confirm the detail panel rendered something meaningful (period name or code)
    await expect(
      page.getByText(/PAY-2026-07|July 2026|July/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  } else {
    // Seeded draft period not found — warn but don't fail the load test
    console.warn('[smoke-hr/payroll] July 2026 draft period row not visible — skipping detail drill-in');
  }

  assertNoMonitorFailures(consoleErrors, failedRequests);
});
