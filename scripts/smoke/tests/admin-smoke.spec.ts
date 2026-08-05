/**
 * HRMS admin smoke suite.
 *
 * Covers the four high-risk admin areas:
 *   1. Pilot Control Center      (/pilot-control-center)
 *   2. Policy Governance         (/policy-governance)
 *   3. Policy Localization       (/policy-localization)
 *   4. Attendance Gateway        (/attendance-gateway)
 *   5. Integration Governance    (/integration-governance)
 *
 * Each test:
 *   - fails on any console error logged by the page
 *   - fails on any 4xx/5xx API response (Vite HMR noise is filtered)
 *   - fails if the primary list/table is still showing skeleton loaders after
 *     networkidle (stuck-loading detection)
 *   - exercises one safe mutation and verifies it succeeds
 *
 * Cleanup:
 *   beforeAll revokes any stale smoke-test-* gateway registrations left by
 *   prior failed runs.  afterAll revokes the registration and deletes the
 *   numbering scheme created during this run.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:80';
const AUTH_FILE = path.join(__dirname, '../auth.json');

// IDs of records created during this run — cleaned up in afterAll.
let createdGatewayRegId: number | null = null;
let createdNumberingSchemeId: number | null = null;

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
    // Revoke stale smoke-test-* registrations from prior failed runs so they
    // don't accumulate.  A registration is "stale smoke" if its name starts
    // with "smoke-test-" and it is not already revoked.
    const res = await ctx.get('/api/gateway/registrations');
    if (res.ok()) {
      const list = (await res.json()) as Array<{ id: number; name: string; status?: string }>;
      for (const reg of list) {
        if (reg.name?.startsWith('smoke-test-') && reg.status !== 'revoked') {
          await ctx.post(`/api/gateway/registrations/${reg.id}/revoke`);
          console.log(`[smoke/beforeAll] Revoked stale registration id=${reg.id} name="${reg.name}"`);
        }
      }
    }
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  const ctx = await makeApiCtx();
  try {
    if (createdGatewayRegId !== null) {
      const res = await ctx.post(`/api/gateway/registrations/${createdGatewayRegId}/revoke`);
      console.log(
        `[smoke/afterAll] Revoked gateway registration id=${createdGatewayRegId} → HTTP ${res.status()}`,
      );
    }
    if (createdNumberingSchemeId !== null) {
      const res = await ctx.delete(`/api/numbering-schemes/${createdNumberingSchemeId}`);
      console.log(
        `[smoke/afterAll] Deleted numbering scheme id=${createdNumberingSchemeId} → HTTP ${res.status()}`,
      );
    }
  } finally {
    await ctx.dispose();
  }
});

// ─── 1. Pilot Control Center ─────────────────────────────────────────────────

test('Pilot Control Center — loads and evaluate-gates mutation succeeds', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/pilot-control-center');
  await waitForPageLoad(page);

  // Assert readiness scorecard table rendered (at least one data row)
  const scorecardTable = page.locator('table tbody tr').first();
  await expect(scorecardTable).toBeVisible({ timeout: 10_000 });

  // Mutation: Evaluate All Gates (idempotent — re-evaluates go-live gate
  // states against current DB; no permanent side-effects)
  const evaluateBtn = page.getByRole('button', { name: /evaluate/i }).first();
  await expect(evaluateBtn).toBeVisible({ timeout: 5_000 });
  await evaluateBtn.click();

  // Wait for the re-evaluation API call to settle
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 2. Policy Governance ────────────────────────────────────────────────────

test('Policy Governance — loads, draft PCR created and withdrawn', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/policy-governance');
  await waitForPageLoad(page);

  // Assert the PCR list area rendered (table OR empty-state text)
  const listArea = page.locator('table, [class*="empty"], [class*="no-data"]').first();
  // Fallback: check for a visible card or any tbody/empty-state
  await expect(
    page.locator('table tbody, [class*="text-slate-400"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Mutation (via API, shares page session cookie): create a draft PCR then
  // immediately withdraw it.  This exercises both the POST and PATCH endpoints
  // without leaving permanent state.
  //
  // Required fields (all NOT NULL, no server default):
  //   policyArea      — free-text category label
  //   titleEn / titleAr — display names
  //   changeAfterJson — proposed change payload as JSON string
  const ts = Date.now();
  const createRes = await page.request.post('/api/policy-change-requests', {
    data: {
      titleEn: `Smoke Test Draft ${ts}`,
      titleAr: `مسودة اختبار الدخان ${ts}`,
      policyArea: 'smoke',
      changeAfterJson: '{}',
    },
  });
  expect(createRes.status(), 'policy-change-requests POST').toBe(201);
  const pcr = (await createRes.json()) as { id: number };

  const withdrawRes = await page.request.patch(`/api/policy-change-requests/${pcr.id}/withdraw`);
  expect(withdrawRes.status(), 'policy-change-requests PATCH /withdraw').toBe(200);

  // Let React Query invalidation settle
  await page.waitForLoadState('networkidle', { timeout: 10_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 3. Policy Localization ──────────────────────────────────────────────────

test('Policy Localization — loads and numbering scheme create+delete works', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/policy-localization');
  await waitForPageLoad(page);

  // Page defaults to the 'locale' tab; navigate to 'Numbering Schemes' tab
  // (TabsContent value="numbering") before creating the scheme.
  await page.getByRole('tab', { name: /numbering/i }).click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Assert the numbering tab content rendered (table or empty-state)
  await expect(
    page.locator('table tbody, [class*="text-slate-"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Mutation: create a numbering scheme via API (orgId=1, unique entityType),
  // verify 201, store id for afterAll cleanup.
  const ts = Date.now();
  const entityType = `smoke_${ts}`;   // keep ≤40 chars (DB varchar limit)
  const createRes = await page.request.post('/api/numbering-schemes', {
    data: {
      orgId: 1,
      entityType,
      template: 'SMOKE-{seq}',
      prefix: 'SMK',
      currentSequence: 0,
    },
  });
  expect(createRes.status(), 'numbering-schemes POST').toBe(201);
  const scheme = (await createRes.json()) as { id: number };
  createdNumberingSchemeId = scheme.id;

  // Reload page, re-open Numbering Schemes tab, confirm the new row appears.
  await page.reload();
  await waitForPageLoad(page);
  await page.getByRole('tab', { name: /numbering/i }).click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  // The entity type is rendered as a table cell value
  await expect(page.getByText(entityType, { exact: false })).toBeVisible({ timeout: 10_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 4. Attendance Gateway ───────────────────────────────────────────────────

test('Attendance Gateway — loads and gateway registration create+revoke works', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/attendance-gateway');
  await waitForPageLoad(page);

  // Assert registrations table or its empty-state is visible
  await expect(
    page.locator('table, [class*="text-slate-"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Mutation: create a new gateway registration (SIMULATOR adapter — no
  // hardware required).  Store id for afterAll revocation.
  const ts = Date.now();
  const createRes = await page.request.post('/api/gateway/registrations', {
    data: {
      name: `smoke-test-${ts}`,
      adapterType: 'SIMULATOR',
      notes: 'Created by smoke suite — safe to revoke',
    },
  });
  expect(createRes.status(), 'gateway/registrations POST').toBe(201);
  const reg = (await createRes.json()) as { id: number; name: string };
  createdGatewayRegId = reg.id;

  // Reload page to confirm the registration appears in the list
  await page.reload();
  await waitForPageLoad(page);
  await expect(page.getByText(`smoke-test-${ts}`)).toBeVisible({ timeout: 10_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── 5. Integration Governance ───────────────────────────────────────────────

test('Integration Governance — loads all tabs and run-health-checks mutation succeeds', async ({
  page,
}) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto('/integration-governance');
  await waitForPageLoad(page);

  // Connection Profiles tab (default) must be loaded
  await expect(
    page.locator('table, [class*="text-slate-"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Walk through all four tabs to confirm none causes a console error or
  // triggers a broken API call
  for (const tabName of ['Credential Vault', 'Governance Rules', 'Audit Log']) {
    await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 10_000 });
  }

  // Return to Connection Profiles for the mutation
  await page.getByRole('tab', { name: /connection profiles/i }).click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Mutation: trigger "Run health checks now" (POST
  // /integration-governance/health-checks/run — idempotent health probe)
  const healthBtn = page.getByRole('button', { name: /run health checks now/i });
  await expect(healthBtn).toBeVisible({ timeout: 5_000 });
  await healthBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});
