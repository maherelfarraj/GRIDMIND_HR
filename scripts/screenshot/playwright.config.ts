/**
 * Playwright config for the login-page screenshot capture.
 *
 * Two modes:
 *   Local (scripts/capture-login-screenshot.sh):
 *     PLAYWRIGHT_CHROMIUM_PATH is resolved from the nix store and exported by
 *     the shell script.  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 is also set.
 *
 *   GitHub Actions (update-screenshot.yml):
 *     PLAYWRIGHT_CHROMIUM_PATH is NOT set.  The workflow runs
 *     `npx playwright install chromium` beforehand so Playwright finds
 *     the browser through its normal channel.
 *
 * SCREENSHOT_BASE_URL defaults to http://localhost:80 (Replit dev proxy).
 * Override to point at the HRMS frontend directly, e.g. http://localhost:4173.
 */
import { defineConfig } from '@playwright/test';

const launchOptions: Record<string, unknown> = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
};

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
if (chromiumPath) {
  launchOptions.executablePath = chromiumPath;
}

export default defineConfig({
  testDir: '.',
  testMatch: 'capture-login.spec.ts',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:80',
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
