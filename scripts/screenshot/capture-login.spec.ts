/**
 * Playwright test: capture a fresh screenshot of the HRMS login page.
 *
 * Saves the result to screenshots/login.jpg (the path the README references).
 * Run via scripts/capture-login-screenshot.sh (local) or the
 * update-screenshot GitHub Actions workflow (CI).
 *
 * The login page renders its form without any API call when there is no
 * session in localStorage, so this test does not need the API server or
 * the database — only the HRMS frontend must be reachable at baseURL.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

const OUT_PATH = path.resolve(__dirname, '../../screenshots/login.jpg');

test('capture login page screenshot', async ({ page }) => {
  // Navigate to the login page and wait until the network is idle so that
  // all fonts and assets have loaded and the screenshot matches what a real
  // user sees on first load.
  await page.goto('/login', { waitUntil: 'networkidle' });

  // The username input is the first interactive element on the login form.
  // Waiting for it to be visible guarantees the React tree has mounted and
  // all CSS (including Tailwind utilities) has been applied.
  const usernameInput = page.getByPlaceholder(/username/i).first();
  await expect(usernameInput).toBeVisible({ timeout: 15_000 });

  // Short settle delay so fonts and background gradients finish painting.
  await page.waitForTimeout(300);

  await page.screenshot({ path: OUT_PATH, type: 'jpeg', quality: 90 });
  console.log(`\nScreenshot saved → ${OUT_PATH}\n`);
});
