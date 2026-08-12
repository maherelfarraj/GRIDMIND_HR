/**
 * Playwright config for the login-flow smoke test.
 *
 * Differences from playwright.config.ts (admin smoke):
 *  - No globalSetup — login smoke starts UNAUTHENTICATED by design.
 *  - No storageState default — each test overrides it to empty.
 *  - PLAYWRIGHT_CHROMIUM_PATH is OPTIONAL: when absent the playwright-installed
 *    chromium binary is used (standard in GitHub Actions CI).  When present
 *    (set by run-smoke.sh for NixOS dev environments) it is passed as
 *    executablePath, matching the behaviour of playwright.config.ts.
 *
 * Run via:
 *   npx playwright test --config playwright-login.config.ts   (CI / local)
 *   bash scripts/run-login-smoke.sh                           (local dev)
 */
import { defineConfig } from '@playwright/test';

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/login-smoke.spec.ts'],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:80',
    headless: true,
    launchOptions: {
      ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
