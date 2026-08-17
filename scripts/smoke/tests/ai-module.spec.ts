/**
 * AI Assistant module smoke test.
 *
 * Covers all five tabs in /local-ai:
 *   P1 — Tab visibility and navigation
 *   P2 — Configuration tab: integration status card, audit log table
 *   P3 — Policy Search happy path: live query, LiveBadge, results
 *   P4 — Report Query happy path: live query, interpretation card
 *   P5 — Classify Document happy path: live classify, category badge
 *   P6 — Anomaly Explain happy path: select type, enter metrics, risk badge
 *   P7 — Permission denied: employee and unauthenticated blocked at API level
 *   P8 — Loading states clear after network idle (no sticky skeletons)
 *
 * Auth:
 *   - Admin tests use auth.json written by global-setup (standard pattern).
 *   - Employee RBAC tests log in manually per-test using test.employee credentials.
 *   - Unauthenticated tests use a fresh browser context with no cookies.
 *
 * Assumptions:
 *   - Seeded test data (node scripts/seed-ai-test-data.cjs) has been run.
 *   - The ai_config row is enabled (is_enabled=true) with all features on.
 *   - AI_INTEGRATIONS_OPENAI_BASE_URL and API_KEY are set.
 *   - Test users: test.employee / TestPass@2026 (role: HR Clerk, org 205)
 */

import { test, expect, request as playwrightRequest, Browser } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:80';
const AUTH_FILE = path.join(__dirname, '../auth.json');
const AI_PAGE = '/local-ai';
const API_BASE = `${BASE_URL}/api`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** API context carrying admin session cookies. */
async function makeAdminApiCtx() {
  return playwrightRequest.newContext({ baseURL: BASE_URL, storageState: AUTH_FILE });
}

/**
 * API context carrying test.employee session cookies.
 * Logs in fresh each call — do not cache across tests.
 */
async function makeEmployeeApiCtx() {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/auth/login', {
    data: { username: 'test.employee', password: 'TestPass@2026' },
  });
  if (!res.ok()) {
    await ctx.dispose();
    throw new Error(`Employee login failed: HTTP ${res.status()}`);
  }
  return ctx;
}

/**
 * Attach console-error and failed-response monitors to a page.
 * Filters Vite HMR, favicon, and known browser-extension noise.
 * AI feature endpoints returning 4xx are expected in permission tests;
 * filter those out here and assert them explicitly in P7.
 */
function attachMonitors(page: import('@playwright/test').Page) {
  const consoleErrors: string[] = [];
  const failedRequests: { status: number; url: string }[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (
      text.includes('Download the React DevTools') ||
      text.includes('ResizeObserver loop') ||
      text.includes('chrome-extension://')
    ) return;
    consoleErrors.push(text);
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    if (
      url.includes('/@vite') ||
      url.includes('__vite_ping') ||
      url.includes('/.well-known') ||
      url.endsWith('/favicon.ico')
    ) return;
    failedRequests.push({ status: res.status(), url });
  });

  return { consoleErrors, failedRequests };
}

function assertNoMonitorFailures(
  consoleErrors: string[],
  failedRequests: { status: number; url: string }[],
) {
  expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);
  expect(
    failedRequests,
    `Failed API requests:\n${failedRequests.map((r) => `  ${r.status} ${r.url}`).join('\n')}`,
  ).toHaveLength(0);
}

/** Wait for networkidle AND all skeleton loaders to clear. */
async function waitForLoad(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 20_000 });
}

// ─── P1: Tab visibility ───────────────────────────────────────────────────────

test('P1: All five AI tabs are visible and clickable', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto(AI_PAGE);
  await waitForLoad(page);

  // Verify all five tab triggers are present
  for (const [value, label] of [
    ['policy-search', 'Policy Search'],
    ['report-query',  'Report Query'],
    ['classify',      'Classify Document'],
    ['anomaly',       'Anomaly Explain'],
    ['config',        'Configuration'],
  ]) {
    const tab = page.locator(`[role="tab"][data-value="${value}"], button:has-text("${label}")`).first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
  }

  // Click each tab and verify the content panel becomes active (no crash)
  for (const value of ['report-query', 'classify', 'anomaly', 'config', 'policy-search']) {
    // Use text match since tab triggers contain icons + label text
    const tabLabels: Record<string, string> = {
      'policy-search': 'Policy Search',
      'report-query':  'Report Query',
      'classify':      'Classify Document',
      'anomaly':       'Anomaly Explain',
      'config':        'Configuration',
    };
    await page.getByRole('tab', { name: tabLabels[value] }).click();
    await page.waitForTimeout(400);
  }

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── P2: Configuration tab ────────────────────────────────────────────────────

test('P2: Configuration tab shows provisioned integration and audit log', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto(AI_PAGE);
  await waitForLoad(page);

  await page.getByRole('tab', { name: 'Configuration' }).click();
  await waitForLoad(page);

  // Integration status card should show "provisioned" state (green, not red)
  const statusCard = page.locator('text=/OpenAI integration provisioned/i').first();
  await expect(statusCard).toBeVisible({ timeout: 10_000 });

  // Audit log table header should be present
  await expect(page.locator('text=/Query Audit Log/i').first()).toBeVisible();

  // The AI enabled toggle should be present
  await expect(page.locator('[role="switch"]').first()).toBeVisible();

  // The model name input should show gpt-5.6-terra
  const modelInput = page.locator('input[placeholder*="gpt-5.6-terra"]').first();
  await expect(modelInput).toBeVisible();

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── P3: Policy Search happy path ─────────────────────────────────────────────

test('P3: Policy Search returns live results with LiveBadge', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto(AI_PAGE);
  await waitForLoad(page);

  // Policy Search is the default tab
  const searchInput = page.locator('input[placeholder*="Search HR policies"]');
  await expect(searchInput).toBeVisible({ timeout: 5_000 });

  await searchInput.fill('annual leave carry-forward limit');
  await page.keyboard.press('Enter');

  // Wait for skeletons to appear then clear (AI call in flight)
  await page.waitForTimeout(500);
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 30_000 });

  // Expect at least one result card
  const resultCards = page.locator('[class*="bg-slate-800"]').filter({ hasText: /Annual Leave|carry.forward|policy/i });
  await expect(resultCards.first()).toBeVisible({ timeout: 5_000 });

  // LiveBadge should appear (emerald badge with model name or "Live AI")
  const liveBadge = page.locator('[class*="bg-emerald-100"]').filter({ hasText: /gpt|live/i }).first();
  await expect(liveBadge).toBeVisible({ timeout: 5_000 });

  // Summary text should be present
  const summary = page.locator('[class*="bg-slate-700"]').filter({ hasText: /carry.forward|leave|30/i }).first();
  await expect(summary).toBeVisible({ timeout: 5_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── P4: Report Query happy path ──────────────────────────────────────────────

test('P4: Report Query returns interpretation and suggested report', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto(AI_PAGE);
  await waitForLoad(page);

  await page.getByRole('tab', { name: 'Report Query' }).click();
  await waitForLoad(page);

  const textarea = page.locator('textarea[placeholder*="workforce data"]');
  await expect(textarea).toBeVisible({ timeout: 5_000 });

  await textarea.fill('How many active employees do we have?');
  await page.getByRole('button', { name: /Ask/i }).click();

  // Wait for AI response
  await page.waitForTimeout(500);
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 30_000 });

  // AI Interpretation card
  await expect(page.locator('text=/AI Interpretation/i').first()).toBeVisible({ timeout: 10_000 });

  // LiveBadge on the Ask button area
  const liveBadge = page.locator('[class*="bg-emerald-100"]').filter({ hasText: /gpt|live/i }).first();
  await expect(liveBadge).toBeVisible({ timeout: 5_000 });

  // Key Metrics card or interpretation text
  const resultText = page.locator('text=/active|employees|headcount/i').first();
  await expect(resultText).toBeVisible({ timeout: 5_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── P5: Classify Document happy path ─────────────────────────────────────────

test('P5: Classify Document assigns category with confidence bar', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto(AI_PAGE);
  await waitForLoad(page);

  await page.getByRole('tab', { name: 'Classify Document' }).click();
  await waitForLoad(page);

  // Fill title
  const titleInput = page.locator('input[placeholder*="document title"]');
  await expect(titleInput).toBeVisible({ timeout: 5_000 });
  await titleInput.fill('Annual Leave Policy 2026');

  // Fill content
  const contentArea = page.locator('textarea[placeholder*="document content"]');
  await contentArea.fill('Employees are entitled to 21 working days of annual leave per year. Leave must be approved 5 days in advance. Carry-forward is capped at 30 days.');

  await page.getByRole('button', { name: /Classify/i }).click();

  // Wait for response
  await page.waitForTimeout(500);
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 30_000 });

  // Classification result card
  await expect(page.locator('text=/Classification Result/i').first()).toBeVisible({ timeout: 10_000 });

  // Category badge (should say "HR Policy")
  const categoryBadge = page.locator('text=/HR Policy/i').first();
  await expect(categoryBadge).toBeVisible({ timeout: 5_000 });

  // LiveBadge
  const liveBadge = page.locator('[class*="bg-emerald-100"]').filter({ hasText: /gpt|live/i }).first();
  await expect(liveBadge).toBeVisible({ timeout: 5_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── P6: Anomaly Explain happy path ───────────────────────────────────────────

test('P6: Anomaly Explain produces risk badge and recommendations', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  await page.goto(AI_PAGE);
  await waitForLoad(page);

  await page.getByRole('tab', { name: 'Anomaly Explain' }).click();
  await waitForLoad(page);

  // Select "High Absence Rate" type card
  await page.locator('button').filter({ hasText: /High Absence Rate/i }).first().click();
  await page.waitForTimeout(300);

  // Metrics form should appear
  await expect(page.locator('text=/Enter Metrics/i').first()).toBeVisible({ timeout: 5_000 });

  // Fill metrics
  const absencesInput = page.locator('input[placeholder="3"]').first();
  await absencesInput.fill('3');
  const lateInput = page.locator('input[placeholder="8"]').first();
  await lateInput.fill('8');
  const delayInput = page.locator('input[placeholder="24"]').first();
  await delayInput.fill('24');

  await page.getByRole('button', { name: /Explain Anomaly/i }).click();

  // Wait for AI response
  await page.waitForTimeout(500);
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0, { timeout: 30_000 });

  // AI Analysis card
  await expect(page.locator('text=/AI Analysis/i').first()).toBeVisible({ timeout: 10_000 });

  // Risk level badge (should be "high" for 3 absences + 8 late arrivals)
  const riskBadge = page.locator('text=/high risk|medium risk/i').first();
  await expect(riskBadge).toBeVisible({ timeout: 5_000 });

  // Recommendations list
  await expect(page.locator('text=/Recommended Actions/i').first()).toBeVisible({ timeout: 5_000 });
  const recs = page.locator('[class*="bg-slate-800"]').filter({ hasText: /Recommended Actions/i })
    .locator('li');
  // Verify at least one recommendation item is rendered
  await expect(recs.first()).toBeVisible({ timeout: 5_000 });

  // LiveBadge
  const liveBadge = page.locator('[class*="bg-emerald-100"]').filter({ hasText: /gpt|live/i }).first();
  await expect(liveBadge).toBeVisible({ timeout: 5_000 });

  assertNoMonitorFailures(consoleErrors, failedRequests);
});

// ─── P7: Permission denied ────────────────────────────────────────────────────

test('P7a: Employee role (role_id=5) is blocked from all AI API endpoints', async () => {
  const ctx = await makeEmployeeApiCtx();
  try {
    const endpoints = [
      { method: 'GET',  path: '/api/ai/config' },
      { method: 'GET',  path: '/api/ai/queries' },
      { method: 'GET',  path: '/api/ai/permissions' },
      { method: 'POST', path: '/api/ai/policy-search',    body: { query: 'leave policy' } },
      { method: 'POST', path: '/api/ai/report-query',     body: { query: 'headcount' } },
      { method: 'POST', path: '/api/ai/classify-document', body: { title: 'test doc' } },
      { method: 'POST', path: '/api/ai/explain-anomaly',  body: { anomalyType: 'attendance_high', metrics: { x: 1 } } },
    ];

    for (const ep of endpoints) {
      const res = ep.method === 'GET'
        ? await ctx.get(`${BASE_URL}${ep.path}`)
        : await ctx.post(`${BASE_URL}${ep.path}`, { data: ep.body });

      expect(
        [403, 401],
        `${ep.method} ${ep.path} should be blocked for employee, got ${res.status()}`,
      ).toContain(res.status());
    }
  } finally {
    await ctx.dispose();
  }
});

test('P7b: Unauthenticated requests are rejected from all AI API endpoints', async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const endpoints = [
      { method: 'GET',  path: '/api/ai/config' },
      { method: 'GET',  path: '/api/ai/queries' },
      { method: 'GET',  path: '/api/ai/permissions' },
      { method: 'POST', path: '/api/ai/policy-search',    body: { query: 'leave policy' } },
      { method: 'POST', path: '/api/ai/report-query',     body: { query: 'headcount' } },
      { method: 'POST', path: '/api/ai/classify-document', body: { title: 'test doc' } },
      { method: 'POST', path: '/api/ai/explain-anomaly',  body: { anomalyType: 'attendance_high', metrics: { x: 1 } } },
    ];

    for (const ep of endpoints) {
      const res = ep.method === 'GET'
        ? await ctx.get(`${BASE_URL}${ep.path}`)
        : await ctx.post(`${BASE_URL}${ep.path}`, { data: ep.body });

      expect(
        [401, 403],
        `${ep.method} ${ep.path} should reject unauthenticated, got ${res.status()}`,
      ).toContain(res.status());
    }
  } finally {
    await ctx.dispose();
  }
});

test('P7c: Unauthenticated browser — AI protected content is not accessible', async ({ browser }) => {
  // Open a fresh context with no cookies/storageState
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Navigate to the AI page without auth
    await page.goto(`${BASE_URL}${AI_PAGE}`);

    // Wait for the network to settle — the auth hook will call /api/auth/me
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Give client-side routing time to process the 401 and redirect
    await page.waitForTimeout(2_000);

    // The page should either:
    //  a) Redirect to /login (the React auth guard), OR
    //  b) Show a login form / password input, OR
    //  c) NOT show the Policy Search input (protected admin-only content)
    const url = page.url();
    const isOnLogin = url.includes('/login');
    const loginFormCount = await page.locator('input[type="password"]').count();
    const policySearchVisible = await page.locator('input[placeholder*="Search HR policies"]').isVisible().catch(() => false);

    // The test passes if EITHER the user was redirected to login OR the protected
    // AI-specific content is not rendered (the auth guard hides it while loading
    // or after a 401 response). P7a + P7b already assert the API blocks unauthenticated
    // requests; this test guards against the UI accidentally rendering gated content.
    expect(
      isOnLogin || loginFormCount > 0 || !policySearchVisible,
      `Unauthenticated user must not see protected AI content. URL: ${url}, loginForm: ${loginFormCount}, policySearch visible: ${policySearchVisible}`,
    ).toBe(true);
  } finally {
    await context.close();
  }
});

// ─── P8: Loading states clear after network idle ───────────────────────────────

test('P8: No sticky skeleton loaders after page load', async ({ page }) => {
  await page.goto(AI_PAGE);
  await waitForLoad(page);

  // Confirm zero animate-pulse skeletons remain after load
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0);

  // Switch to config tab and confirm its skeletons clear too
  await page.getByRole('tab', { name: 'Configuration' }).click();
  await waitForLoad(page);
  await expect(page.locator('.animate-pulse.rounded-md')).toHaveCount(0);
});

// ─── P9: Admin API endpoints return 200 ───────────────────────────────────────
// Login fresh (same pattern as makeEmployeeApiCtx) rather than relying on auth.json
// whose session cookie can be overwritten by intermediate tests in the same run.

test('P9: Admin can read all AI read endpoints', async () => {
  const adminUsername = process.env.SMOKE_ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('SMOKE_ADMIN_PASSWORD must be set for P9 fresh-login');
  }

  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const loginRes = await ctx.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    expect(loginRes.status(), `Admin fresh login failed: HTTP ${loginRes.status()}`).toBe(200);

    const readEndpoints = ['/api/ai/config', '/api/ai/queries', '/api/ai/permissions'];
    for (const ep of readEndpoints) {
      const res = await ctx.get(ep);
      expect(res.status(), `Admin GET ${ep} should return 200, got ${res.status()}`).toBe(200);
    }
  } finally {
    await ctx.dispose();
  }
});
