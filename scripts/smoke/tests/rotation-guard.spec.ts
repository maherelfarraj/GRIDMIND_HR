/**
 * Unit tests for the rotation guard in global-setup.ts.
 *
 * These tests exercise assertRotationAllowed() directly — no browser, no
 * network, no server required.  They verify that:
 *
 *   - Rotation is refused for any remote SMOKE_BASE_URL before any network
 *     call is made (the target-URL guard is pure / synchronous).
 *   - Rotation is also refused when NODE_ENV=production or REPLIT_DEPLOYMENT
 *     is set, even if the target is local.
 *   - Rotation IS permitted for localhost and 127.0.0.1 targets in a clean
 *     dev environment with SMOKE_ROTATION_PASSWORD supplied.
 *
 * Run as part of the full suite (bash scripts/run-smoke.sh) or standalone:
 *   cd scripts/smoke && npx playwright test tests/rotation-guard.spec.ts
 *
 * Note: the Playwright globalSetup (authenticating as admin) still runs before
 * these tests when invoked via run-smoke.sh.  The tests themselves make no
 * network calls — they only import and call the exported pure function.
 */

import { test, expect } from '@playwright/test';
import { assertRotationAllowed } from '../global-setup';

// ── Env-var save/restore helpers ─────────────────────────────────────────────

function saveEnv(...keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((k) => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('assertRotationAllowed — target-URL guard', () => {
  let saved: Record<string, string | undefined>;

  test.beforeEach(() => {
    saved = saveEnv('NODE_ENV', 'REPLIT_DEPLOYMENT', 'SMOKE_ROTATION_PASSWORD');
    // Put env in a clean dev state: no production indicators, password supplied.
    delete process.env.NODE_ENV;
    delete process.env.REPLIT_DEPLOYMENT;
    process.env.SMOKE_ROTATION_PASSWORD = 'test-rotation-pw';
  });

  test.afterEach(() => {
    restoreEnv(saved);
  });

  // ── Remote URLs must be refused ─────────────────────────────────────────────

  test('refuses rotation against an https replit.app URL', () => {
    expect(() => assertRotationAllowed('https://example.replit.app')).toThrow(
      /not permitted against a remote target/,
    );
  });

  test('refuses rotation against an https replit.app URL — error names the target', () => {
    const url = 'https://enterprise-hr-suite.replit.app';
    expect(() => assertRotationAllowed(url)).toThrow(url);
  });

  test('refuses rotation against a generic remote http URL', () => {
    expect(() => assertRotationAllowed('http://production.example.com')).toThrow(
      /not permitted against a remote target/,
    );
  });

  test('refuses rotation against a remote URL with an explicit port', () => {
    expect(() => assertRotationAllowed('https://remote.host:8080')).toThrow(
      /not permitted against a remote target/,
    );
  });

  // ── Local URLs must be permitted ────────────────────────────────────────────

  test('permits rotation for localhost (no port)', () => {
    expect(() => assertRotationAllowed('http://localhost')).not.toThrow();
  });

  test('permits rotation for localhost:80', () => {
    expect(() => assertRotationAllowed('http://localhost:80')).not.toThrow();
  });

  test('permits rotation for localhost with an arbitrary port', () => {
    expect(() => assertRotationAllowed('http://localhost:3000')).not.toThrow();
  });

  test('permits rotation for 127.0.0.1', () => {
    expect(() => assertRotationAllowed('http://127.0.0.1:80')).not.toThrow();
  });
});

test.describe('assertRotationAllowed — environment guard (checked before URL)', () => {
  let saved: Record<string, string | undefined>;

  test.beforeEach(() => {
    saved = saveEnv('NODE_ENV', 'REPLIT_DEPLOYMENT', 'SMOKE_ROTATION_PASSWORD');
    process.env.SMOKE_ROTATION_PASSWORD = 'test-rotation-pw';
  });

  test.afterEach(() => {
    restoreEnv(saved);
  });

  test('refuses rotation when NODE_ENV=production even with a local target', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REPLIT_DEPLOYMENT;
    expect(() => assertRotationAllowed('http://localhost:80')).toThrow(
      /not permitted in production/,
    );
  });

  test('refuses rotation when REPLIT_DEPLOYMENT is set even with a local target', () => {
    delete process.env.NODE_ENV;
    process.env.REPLIT_DEPLOYMENT = '1';
    expect(() => assertRotationAllowed('http://localhost:80')).toThrow(
      /not permitted in production/,
    );
  });

  test('environment guard fires before URL guard (remote URL + production env → production message)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REPLIT_DEPLOYMENT;
    // The remote-URL guard would also fire, but env guard must take priority.
    expect(() => assertRotationAllowed('https://enterprise-hr-suite.replit.app')).toThrow(
      /not permitted in production/,
    );
  });
});

test.describe('assertRotationAllowed — rotation-password guard', () => {
  let saved: Record<string, string | undefined>;

  test.beforeEach(() => {
    saved = saveEnv('NODE_ENV', 'REPLIT_DEPLOYMENT', 'SMOKE_ROTATION_PASSWORD');
    delete process.env.NODE_ENV;
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.SMOKE_ROTATION_PASSWORD;
  });

  test.afterEach(() => {
    restoreEnv(saved);
  });

  test('refuses rotation when SMOKE_ROTATION_PASSWORD is missing (local target)', () => {
    expect(() => assertRotationAllowed('http://localhost:80')).toThrow(
      /requires SMOKE_ROTATION_PASSWORD/,
    );
  });
});
