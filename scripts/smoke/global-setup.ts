/**
 * Playwright global setup — authenticates as admin and writes auth.json.
 *
 * auth.json is runtime state (session cookie + localStorage token).  It is
 * listed in .gitignore and must never be committed.
 *
 * ── Credential resolution order ──────────────────────────────────────────────
 * Candidates are tried in this order; the first that authenticates cleanly
 * (HTTP 200, mustChangePassword=false) wins:
 *
 *   1. SMOKE_ADMIN_PASSWORD  env var  (explicit smoke-only credential)
 *   2. ADMIN_RESET_PASSWORD  env var  (operator-supplied temporary password)
 *   3. DEMO_PILOT_PASSWORD   env var  (dev seeding password)
 *
 * No password is ever hard-coded in this file.
 *
 * ── mustChangePassword — fail-safe by default ────────────────────────────────
 * If every candidate either fails or returns mustChangePassword=true,
 * global-setup FAILS with a clear actionable error.  It does NOT silently
 * mutate the admin account, protecting the OTP onboarding flow (Task #341).
 *
 * ── Opt-in rotation (explicit, loud, local dev/CI only) ──────────────────────
 * Set SMOKE_ALLOW_PASSWORD_ROTATION=true AND SMOKE_ROTATION_PASSWORD=<value>
 * to permit global-setup to call change-password when mustChangePassword=true.
 *
 * Guards (ALL must pass — checked before any network request):
 *   • NODE_ENV must not be "production" and REPLIT_DEPLOYMENT must be unset.
 *   • SMOKE_BASE_URL must resolve to localhost or 127.0.0.1 — rotation is
 *     never permitted against a remote target, even when run from a dev
 *     workspace (a post-publish run from dev points at a remote prod URL).
 *   • SMOKE_ROTATION_PASSWORD must be supplied — no default, no fallback.
 *   • Every rotation attempt is printed to stdout (never silent).
 *
 * After a rotation run the admin password becomes SMOKE_ROTATION_PASSWORD.
 * Set SMOKE_ADMIN_PASSWORD=<that value> for subsequent runs so they
 * authenticate without touching the DB.
 */
import { request } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:80';
const AUTH_FILE = path.join(__dirname, 'auth.json');

/**
 * Asserts that password rotation is permitted for the given target base URL.
 *
 * Throws with a clear, actionable message if any guard fails.  All checks
 * are pure (no network I/O) so callers can rely on this throwing BEFORE any
 * HTTP request is made.
 *
 * Exported for direct unit-testing in rotation-guard.spec.ts.
 *
 * Guard order (first failure wins):
 *   1. Environment guard — NODE_ENV=production or REPLIT_DEPLOYMENT set.
 *   2. Target-URL guard  — target hostname is not localhost / 127.0.0.1 / ::1.
 *   3. Password guard    — SMOKE_ROTATION_PASSWORD is not set.
 */
export function assertRotationAllowed(baseUrl: string): void {
  // ── 1. Environment guard (existing) ────────────────────────────────────────
  if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT) {
    throw new Error(
      '[smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true is not permitted in production ' +
        '(NODE_ENV=production or REPLIT_DEPLOYMENT is set). Unset the flag.',
    );
  }

  // ── 2. Target-URL guard (new) ───────────────────────────────────────────────
  // A post-publish smoke run is launched from the dev workspace where neither
  // NODE_ENV=production nor REPLIT_DEPLOYMENT is set — but the target URL is
  // remote.  We must refuse rotation before any network call is made.
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(
      `[smoke/global-setup] SMOKE_BASE_URL is not a valid URL: "${baseUrl}". ` +
        'Provide a full URL such as http://localhost:80 or https://example.replit.app.',
    );
  }

  const isLocal =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (!isLocal) {
    throw new Error(
      '[smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true is not permitted against a remote target.\n' +
        `  Target: ${baseUrl}\n` +
        '  Rotation is only allowed when SMOKE_BASE_URL resolves to localhost or 127.0.0.1.\n' +
        '  To fix: unset SMOKE_ALLOW_PASSWORD_ROTATION, then change the admin password\n' +
        '  manually on the remote app and update SMOKE_ADMIN_PASSWORD accordingly.',
    );
  }

  // ── 3. Rotation-password guard (existing) ──────────────────────────────────
  if (!process.env.SMOKE_ROTATION_PASSWORD) {
    throw new Error(
      '[smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true requires SMOKE_ROTATION_PASSWORD ' +
        'to be set. Provide the desired new password via that env var.',
    );
  }
}

export default async function globalSetup(): Promise<void> {
  const allowRotation = process.env.SMOKE_ALLOW_PASSWORD_ROTATION === 'true';

  // All rotation guards run here — before any network request is made.
  if (allowRotation) {
    assertRotationAllowed(BASE_URL);
  }

  const ctx = await request.newContext({ baseURL: BASE_URL });

  try {
    // File-based fallback: read from the 0600 operator credential file when
    // the SMOKE_ADMIN_PASSWORD env var is absent (e.g. unattended workflow
    // runs where Replit Secrets are unavailable).  The value is never logged.
    //
    // Security checks (all must pass before the file is read):
    //   1. Not a symlink  — prevents symlink-redirect attacks.
    //   2. Owned by the current process user  — prevents another user planting
    //      a credential file that this process would accept.
    //   3. Mode exactly 0600  — rejects group/world-readable files; if the
    //      file was accidentally chmod'd wider, fail loudly rather than read it.
    const CREDENTIAL_FILE = path.resolve(__dirname, '../../.credentials/smoke-rotation-pw.txt');
    let filePassword: string | undefined;
    (() => {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(CREDENTIAL_FILE);
      } catch {
        // File absent — silently skip; fall through to env vars.
        return;
      }

      if (stat.isSymbolicLink()) {
        throw new Error(
          `[smoke/global-setup] Credential file is a symlink, which is not permitted: ${CREDENTIAL_FILE}\n` +
            '  Replace with a regular file (mode 0600) containing the admin password.',
        );
      }

      const currentUid = process.getuid?.();
      if (currentUid !== undefined && stat.uid !== currentUid) {
        throw new Error(
          `[smoke/global-setup] Credential file is owned by uid ${stat.uid} but the current process ` +
            `is uid ${currentUid}: ${CREDENTIAL_FILE}\n` +
            '  The file must be owned by the user running the smoke suite.',
        );
      }

      const mode = stat.mode & 0o777;
      if (mode !== 0o600) {
        throw new Error(
          `[smoke/global-setup] Credential file has permissions ${mode.toString(8).padStart(4, '0')} ` +
            `but must be exactly 0600: ${CREDENTIAL_FILE}\n` +
            '  Run: chmod 600 .credentials/smoke-rotation-pw.txt',
        );
      }

      const raw = fs.readFileSync(CREDENTIAL_FILE, 'utf8').trim();
      if (raw.length > 0) filePassword = raw;
    })();

    // Build ordered, deduplicated candidate list — no hard-coded values.
    // Resolution order:
    //   1. SMOKE_ADMIN_PASSWORD env var  (explicit override / CI secret)
    //   2. .credentials/smoke-rotation-pw.txt  (operator file, 0600, untracked)
    //   3. ADMIN_RESET_PASSWORD env var  (operator-supplied temporary password)
    //   4. DEMO_PILOT_PASSWORD env var   (dev seeding password)
    const candidates = [
      process.env.SMOKE_ADMIN_PASSWORD,
      filePassword,
      process.env.ADMIN_RESET_PASSWORD,
      process.env.DEMO_PILOT_PASSWORD,
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    const unique = [...new Set(candidates)];

    if (unique.length === 0) {
      throw new Error(
        '[smoke/global-setup] No admin password available.\n\n' +
          'Set at least one of:\n' +
          '  SMOKE_ADMIN_PASSWORD env var      — dedicated smoke credential (preferred)\n' +
          '  .credentials/smoke-rotation-pw.txt — operator file (0600, untracked)\n' +
          '  ADMIN_RESET_PASSWORD env var      — operator-supplied reset password\n' +
          '  DEMO_PILOT_PASSWORD  env var      — dev seeding password',
      );
    }

    let user: Record<string, unknown> | null = null;
    const attemptLog: string[] = [];

    // SMOKE_ADMIN_USERNAME lets projects override the default 'admin' username.
    const adminUsername = process.env.SMOKE_ADMIN_USERNAME ?? 'admin';

    for (const pw of unique) {
      const res = await ctx.post('/api/auth/login', {
        data: { username: adminUsername, password: pw },
      });

      if (!res.ok()) {
        attemptLog.push(`  • candidate (length: ${pw.length}) → HTTP ${res.status()} (wrong password or locked)`);
        continue;
      }

      const body = (await res.json()) as Record<string, unknown>;

      if (!body.mustChangePassword) {
        user = body;
        break;
      }

      attemptLog.push(`  • candidate (length: ${pw.length}) → authenticated but mustChangePassword=true`);

      if (!allowRotation) {
        continue; // fail-safe: do not rotate without explicit opt-in
      }

      // ── Opt-in rotation ───────────────────────────────────────────────────
      const rotationPassword = process.env.SMOKE_ROTATION_PASSWORD!;

      console.warn(
        '\n⚠️  [smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true:\n' +
          `    Calling change-password (current candidate length: ${pw.length} → new: SMOKE_ROTATION_PASSWORD).\n` +
          '    This modifies the admin account. Use only in isolated dev/CI environments.\n' +
          '    Set SMOKE_ADMIN_PASSWORD=<SMOKE_ROTATION_PASSWORD value> for subsequent runs.\n',
      );

      const changeRes = await ctx.post('/api/auth/change-password', {
        data: { currentPassword: pw, newPassword: rotationPassword },
      });

      if (!changeRes.ok()) {
        const err = (await changeRes.json().catch(() => ({}))) as Record<string, unknown>;
        attemptLog.push(
          `    change-password failed (HTTP ${changeRes.status()}): ` +
            (typeof err.error === 'string' ? err.error : JSON.stringify(err)),
        );
        console.warn(`[smoke/global-setup] ${attemptLog.at(-1)}`);
        continue;
      }

      user = (await changeRes.json()) as Record<string, unknown>;
      console.warn(
        '[smoke/global-setup] Password rotated successfully. ' +
          'Admin mustChangePassword is now cleared.\n',
      );
      break;
    }

    if (!user) {
      const mcpHint = attemptLog.some((l) => l.includes('mustChangePassword=true'))
        ? '\n\nAt least one password authenticated but mustChangePassword=true blocked it.\n' +
          'Options:\n' +
          '  A. Collect the admin OTP from .credentials/one-time-passwords-*.json,\n' +
          '     sign in, change the password, then re-run.\n' +
          '  B. In isolated dev/CI: set SMOKE_ALLOW_PASSWORD_ROTATION=true and\n' +
          '     SMOKE_ROTATION_PASSWORD=<new-strong-password> to let global-setup\n' +
          '     rotate the credential automatically (only works against localhost).\n' +
          '     Then set SMOKE_ADMIN_PASSWORD=<that value> for subsequent runs.'
        : '';

      throw new Error(
        '[smoke/global-setup] Could not authenticate as admin.\n\n' +
          'Attempts:\n' + attemptLog.join('\n') +
          mcpHint +
          '\n\nPassword sources checked (in order):\n' +
          '  1. SMOKE_ADMIN_PASSWORD env var\n' +
          '  2. .credentials/smoke-rotation-pw.txt (0600 operator file)\n' +
          '  3. ADMIN_RESET_PASSWORD  env var\n' +
          '  4. DEMO_PILOT_PASSWORD   env var',
      );
    }

    const state = await ctx.storageState();
    const localStorageEntries: { name: string; value: string }[] = [
      {
        name: 'hrms-session',
        value: JSON.stringify({ ...user, mustChangePassword: false }),
      },
    ];
    // Persist the active org so the browser's fetch interceptor (org-fetch.ts)
    // attaches "X-Org-Id: <orgId>" to every non-auth API request.  Without this
    // the interceptor sees no stored org and omits the header; resolveOrgId(req)
    // then falls back to the user's home org for list endpoints but the
    // router.param("id") guard on detail routes can resolve to a different org,
    // causing legitimate period-detail and sub-route requests to 404.
    if (typeof (user as any).orgId === 'number') {
      localStorageEntries.push({
        name: 'hrms-org-id',
        value: String((user as any).orgId),
      });
    }
    const stateWithStorage = {
      ...state,
      origins: [
        {
          origin: BASE_URL,
          localStorage: localStorageEntries,
        },
      ],
    };

    fs.writeFileSync(AUTH_FILE, JSON.stringify(stateWithStorage, null, 2));
    console.log(
      `[smoke/global-setup] auth.json written (username: ${user.username}, roleId: ${user.roleId}, orgId: ${(user as any).orgId ?? 'n/a'})`,
    );
  } finally {
    await ctx.dispose();
  }
}
