/**
 * Login-flow smoke test.
 *
 * Verifies that the login form works end-to-end:
 *   - valid credentials  → authenticated session + redirect away from /login
 *   - wrong credentials  → error alert visible, page stays on /login
 *
 * These tests deliberately start WITHOUT any pre-existing auth state (the
 * `storageState` override empties cookies + localStorage) so that the login
 * form itself — and the /api/auth/login exchange it drives — are exercised,
 * not bypassed.
 *
 * Credential resolution (first set wins):
 *   SMOKE_ADMIN_PASSWORD → ADMIN_RESET_PASSWORD → DEMO_PILOT_PASSWORD
 *
 * The wrong-password test uses a non-existent username to avoid triggering
 * a lockout on the real admin account.
 */

import { test, expect } from '@playwright/test';

const ADMIN_USERNAME = process.env.SMOKE_ADMIN_USERNAME ?? 'admin';

function getAdminPassword(): string {
  const pw =
    process.env.SMOKE_ADMIN_PASSWORD ??
    process.env.ADMIN_RESET_PASSWORD ??
    process.env.DEMO_PILOT_PASSWORD;
  if (!pw) {
    throw new Error(
      '[login-smoke] No admin password found.\n' +
        'Set one of: SMOKE_ADMIN_PASSWORD, ADMIN_RESET_PASSWORD, or DEMO_PILOT_PASSWORD.',
    );
  }
  return pw;
}

test.describe('Login flow', () => {
  // Start every test with a clean, unauthenticated browser context.
  test.use({ storageState: { cookies: [], origins: [] } });

  // ── Happy path ─────────────────────────────────────────────────────────────

  test('valid credentials → session created and redirect away from /login', async ({ page }) => {
    const password = getAdminPassword();

    // Capture any auth-API errors before or during the login exchange.
    const authErrors: { status: number; url: string }[] = [];
    page.on('response', (res) => {
      if (res.status() < 400) return;
      const url = res.url();
      if (
        url.includes('/api/auth/') &&
        !url.includes('/@vite') &&
        !url.endsWith('/favicon.ico')
      ) {
        authErrors.push({ status: res.status(), url });
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // Login form must be visible before we interact with it.
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#password')).toBeVisible({ timeout: 5_000 });

    await page.fill('#username', ADMIN_USERNAME);
    await page.fill('#password', password);

    // Submit and wait for the page to navigate away from /login.
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: 25_000,
      }),
      page.click('button[type="submit"]'),
    ]);

    // Confirm the redirect actually happened.
    expect(
      page.url(),
      'Expected to be redirected away from /login after successful authentication',
    ).not.toContain('/login');

    // Confirm no auth API errors were observed during the exchange.
    expect(
      authErrors,
      `Auth API errors during login:\n${authErrors.map((r) => `  ${r.status} ${r.url}`).join('\n')}`,
    ).toHaveLength(0);

    // ── Verify the session is real and persists across a reload ────────────
    // Reload the page once so the browser re-sends the session cookie.
    // A regression where the cookie is never set (or set but not persisted)
    // would cause the reload to land on /login again.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    expect(
      page.url(),
      'Expected session to persist across a page reload (session cookie must survive)',
    ).not.toContain('/login');

    // Call /api/auth/me with the browser's session cookie and assert the
    // server returns the seeded admin identity.  This proves the backend
    // issued a real session, not just a client-side redirect.
    const meRes = await page.request.get('/api/auth/me');
    expect(
      meRes.status(),
      '/api/auth/me must return 200 after a successful login',
    ).toBe(200);
    const me = await meRes.json() as { username?: string };
    expect(
      me.username,
      '/api/auth/me must identify the logged-in admin',
    ).toBe(ADMIN_USERNAME);
  });

  // ── Logout path ────────────────────────────────────────────────────────────

  test('logout → session destroyed and subsequent API call returns 401', async ({ page }) => {
    const password = getAdminPassword();

    // ── Step 1: Establish a real session via the login API ──────────────────
    const loginRes = await page.request.post('/api/auth/login', {
      data: { username: ADMIN_USERNAME, password },
    });
    expect(
      loginRes.status(),
      '/api/auth/login must return 200 before the logout test can proceed',
    ).toBe(200);

    // ── Step 2: Confirm the session is active ───────────────────────────────
    const meBefore = await page.request.get('/api/auth/me');
    expect(
      meBefore.status(),
      '/api/auth/me must return 200 while the session is active',
    ).toBe(200);
    const meBefJson = await meBefore.json() as { username?: string };
    expect(
      meBefJson.username,
      '/api/auth/me must identify the logged-in admin before logout',
    ).toBe(ADMIN_USERNAME);

    // ── Step 3: Trigger logout ───────────────────────────────────────────────
    const logoutRes = await page.request.post('/api/auth/logout');
    expect(
      logoutRes.status(),
      'POST /api/auth/logout must return 200',
    ).toBe(200);

    // ── Step 4: Confirm the session is gone ─────────────────────────────────
    // With auth enforced (PILOT_AUTH=true, the default in CI) a subsequent
    // /api/auth/me call must return 401 — the cookie was cleared by logout and
    // no demo fallback is active.
    const meAfter = await page.request.get('/api/auth/me');
    expect(
      meAfter.status(),
      '/api/auth/me must return 401 after logout — the session cookie must be cleared',
    ).toBe(401);
  });

  // ── Session-expiry banner ──────────────────────────────────────────────────

  test('?expired=1 → session-expiry banner is visible on the login page', async ({ page }) => {
    await page.goto('/login?expired=1');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // The login form must render before we assert the banner.
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });

    // The session-expiry alert must be present and contain the expected text.
    const banner = page.locator('[role="alert"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/session expired/i);
  });

  // ── Post-login redirect via ?next= ─────────────────────────────────────────

  test('?next=/policy-governance → post-login redirect lands on /policy-governance', async ({ page }) => {
    const password = getAdminPassword();

    await page.goto('/login?next=/policy-governance');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#password')).toBeVisible({ timeout: 5_000 });

    await page.fill('#username', ADMIN_USERNAME);
    await page.fill('#password', password);

    // Submit and wait for the redirect to complete.
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/policy-governance', {
        timeout: 25_000,
      }),
      page.click('button[type="submit"]'),
    ]);

    expect(
      page.url(),
      'Expected post-login redirect to land on /policy-governance',
    ).toContain('/policy-governance');
  });

  // ── Open-redirect guard ────────────────────────────────────────────────────

  test('?next=https://evil.com → open-redirect is blocked; redirect falls back to /', async ({ page }) => {
    const password = getAdminPassword();

    await page.goto('/login?next=https://evil.com');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#password')).toBeVisible({ timeout: 5_000 });

    await page.fill('#username', ADMIN_USERNAME);
    await page.fill('#password', password);

    // Submit and wait for a redirect away from /login.
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: 25_000,
      }),
      page.click('button[type="submit"]'),
    ]);

    const finalUrl = new URL(page.url());

    // Must NOT have been redirected to the external host.
    expect(
      finalUrl.hostname,
      'Open-redirect must not send the user to an external host',
    ).not.toBe('evil.com');

    // The sanitised fallback is the app root ('/').
    expect(
      finalUrl.pathname,
      'Open-redirect guard must fall back to / when ?next= is an external URL',
    ).toBe('/');
  });

  // ── UI logout path ─────────────────────────────────────────────────────────

  test('logout button in sidebar → browser redirects to /login', async ({ page }) => {
    const password = getAdminPassword();

    // ── Step 1: Log in via the UI form ─────────────────────────────────────
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#password')).toBeVisible({ timeout: 5_000 });

    await page.fill('#username', ADMIN_USERNAME);
    await page.fill('#password', password);

    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: 25_000,
      }),
      page.click('button[type="submit"]'),
    ]);

    // Confirm we're authenticated and no longer on the login page.
    expect(
      page.url(),
      'Expected to be redirected away from /login after successful authentication',
    ).not.toContain('/login');

    // ── Step 2: Click the logout button in the sidebar ─────────────────────
    // The sidebar renders a Button with the text "Sign Out" that calls
    // useAuth().logout() on click.
    const logoutBtn = page.getByRole('button', { name: /sign out/i });
    await expect(logoutBtn).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForURL((url) => url.pathname.includes('/login'), {
        timeout: 25_000,
      }),
      logoutBtn.click(),
    ]);

    // ── Step 3: Confirm the redirect arrived on /login ──────────────────────
    expect(
      page.url(),
      'Expected the sidebar logout button to redirect to /login',
    ).toContain('/login');

    // ── Step 4: Confirm the session is truly gone ───────────────────────────
    // /api/auth/me must return 401 — the cookie was cleared on the server
    // by POST /api/auth/logout, which the hook fires before clearing state.
    const meAfter = await page.request.get('/api/auth/me');
    expect(
      meAfter.status(),
      '/api/auth/me must return 401 after the sidebar logout button is clicked',
    ).toBe(401);
  });

  // ── Language toggle (Arabic) ───────────────────────────────────────────────

  test('language toggle → Arabic expiry banner and form labels render correctly', async ({ page }) => {
    await page.goto('/login?expired=1');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // The login form must be visible before we interact with the toggle.
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });

    // The session-expiry banner must first appear in English.
    const banner = page.locator('[role="alert"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/session expired/i);

    // Click the language toggle button (shows 'العربية' when the UI is in English).
    const langToggle = page.getByRole('button', { name: /العربية/i });
    await expect(langToggle).toBeVisible({ timeout: 5_000 });
    await langToggle.click();

    // The expiry alert must now contain Arabic text.
    await expect(banner).toContainText(/انتهت الجلسة/, { timeout: 5_000 });

    // The username and password labels must switch to Arabic.
    await expect(page.locator('label[for="username"]')).toContainText('اسم المستخدم');
    await expect(page.locator('label[for="password"]')).toContainText('كلمة المرور');
  });

  // ── Arabic end-to-end login ────────────────────────────────────────────────

  test('Arabic mode → full login submission creates session and redirects away from /login', async ({ page }) => {
    const password = getAdminPassword();

    // Capture any auth-API errors before or during the login exchange.
    const authErrors: { status: number; url: string }[] = [];
    page.on('response', (res) => {
      if (res.status() < 400) return;
      const url = res.url();
      if (
        url.includes('/api/auth/') &&
        !url.includes('/@vite') &&
        !url.endsWith('/favicon.ico')
      ) {
        authErrors.push({ status: res.status(), url });
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // The login form must be visible before we interact with the toggle.
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#password')).toBeVisible({ timeout: 5_000 });

    // Click the language toggle button (shows 'العربية' when the UI is in English).
    const langToggle = page.getByRole('button', { name: /العربية/i });
    await expect(langToggle).toBeVisible({ timeout: 5_000 });
    await langToggle.click();

    // Verify labels switched to Arabic — confirms the RTL mode is active
    // before we attempt to type into the inputs.
    await expect(page.locator('label[for="username"]')).toContainText('اسم المستخدم', { timeout: 5_000 });
    await expect(page.locator('label[for="password"]')).toContainText('كلمة المرور', { timeout: 5_000 });

    // Fill in the credentials while the form is in Arabic/RTL mode.
    await page.fill('#username', ADMIN_USERNAME);
    await page.fill('#password', password);

    // Submit and wait for the page to navigate away from /login.
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: 25_000,
      }),
      page.click('button[type="submit"]'),
    ]);

    // Confirm the redirect actually happened.
    expect(
      page.url(),
      'Expected to be redirected away from /login after successful authentication in Arabic mode',
    ).not.toContain('/login');

    // Confirm no auth API errors were observed during the exchange.
    expect(
      authErrors,
      `Auth API errors during Arabic-mode login:\n${authErrors.map((r) => `  ${r.status} ${r.url}`).join('\n')}`,
    ).toHaveLength(0);

    // Confirm the session is real: /api/auth/me must return 200 with the
    // correct username.  This proves the backend issued a valid session even
    // when the form was submitted while in Arabic/RTL mode.
    const meRes = await page.request.get('/api/auth/me');
    expect(
      meRes.status(),
      '/api/auth/me must return 200 after successful login in Arabic mode',
    ).toBe(200);
    const me = await meRes.json() as { username?: string };
    expect(
      me.username,
      '/api/auth/me must identify the logged-in admin after Arabic-mode login',
    ).toBe(ADMIN_USERNAME);
  });

  // ── Sad path ───────────────────────────────────────────────────────────────

  test('wrong password for valid user → error alert visible and page stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });

    // Use the real admin username with a demonstrably wrong password.
    // This exercises the bcrypt comparison path (PILOT_AUTH=true) and
    // confirms that an incorrect credential is actually rejected — a
    // nonexistent username would not prove the password-check logic works.
    await page.fill('#username', ADMIN_USERNAME);
    await page.fill('#password', `definitely-wrong-${Date.now()}`);
    await page.click('button[type="submit"]');

    // An error alert must appear.
    await expect(page.locator('[role="alert"]')).toBeVisible({
      timeout: 10_000,
    });

    // Must remain on the login page.
    expect(
      page.url(),
      'Expected to stay on /login after a failed authentication attempt',
    ).toContain('/login');
  });
});
