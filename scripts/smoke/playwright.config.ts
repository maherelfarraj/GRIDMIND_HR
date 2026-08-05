/**
 * Playwright config for HRMS admin smoke suite.
 *
 * Chromium binary: resolved at runtime in run-smoke.sh from the nix store and
 * exported as PLAYWRIGHT_CHROMIUM_PATH. We skip Playwright's browser download
 * (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1) because the auto-downloaded binaries
 * cannot find their dynamic linker on NixOS.
 *
 * Auth: global-setup.ts logs in via the API, clears mustChangePassword if
 * needed, and writes auth.json (session cookie + localStorage) which every
 * test picks up via use.storageState.
 */
import { defineConfig } from '@playwright/test';

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;
if (!CHROMIUM_PATH) {
  throw new Error(
    'PLAYWRIGHT_CHROMIUM_PATH is not set. Run via scripts/run-smoke.sh, which resolves it automatically.',
  );
}

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 0,
  workers: 1, // run tests serially — shared DB state
  reporter: 'list',
  globalSetup: require.resolve('./global-setup'),

  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:80',
    storageState: 'auth.json',
    headless: true,
    launchOptions: {
      executablePath: CHROMIUM_PATH,
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
