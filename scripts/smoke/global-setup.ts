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
 * ── Opt-in rotation (explicit, loud, dev/CI only) ────────────────────────────
 * Set SMOKE_ALLOW_PASSWORD_ROTATION=true AND SMOKE_ROTATION_PASSWORD=<value>
 * to permit global-setup to call change-password when mustChangePassword=true.
 *
 * Guards:
 *   • SMOKE_ROTATION_PASSWORD must be supplied — no default, no fallback.
 *   • Rotation is refused when NODE_ENV=production or REPLIT_DEPLOYMENT is set.
 *   • Every rotation attempt is printed to stdout (never silent).
 *
 * After a rotation run the admin password becomes SMOKE_ROTATION_PASSWORD.
 * Set SMOKE_ADMIN_PASSWORD=<that value> for subsequent runs so they
 * authenticate without touching the DB.
 */
import { request } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:80';
const AUTH_FILE = path.join(__dirname, 'auth.json');

export default async function globalSetup(): Promise<void> {
  const allowRotation = process.env.SMOKE_ALLOW_PASSWORD_ROTATION === 'true';

  // Production guard — rotation must never run against a live deployment.
  if (allowRotation) {
    if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT) {
      throw new Error(
        '[smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true is not permitted in production ' +
          '(NODE_ENV=production or REPLIT_DEPLOYMENT is set). Unset the flag.',
      );
    }
    const rotationPassword = process.env.SMOKE_ROTATION_PASSWORD;
    if (!rotationPassword) {
      throw new Error(
        '[smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true requires SMOKE_ROTATION_PASSWORD ' +
          'to be set. Provide the desired new password via that env var.',
      );
    }
  }

  const ctx = await request.newContext({ baseURL: BASE_URL });

  try {
    // Build ordered, deduplicated candidate list — no hard-coded values.
    const candidates = [
      process.env.SMOKE_ADMIN_PASSWORD,
      process.env.ADMIN_RESET_PASSWORD,
      process.env.DEMO_PILOT_PASSWORD,
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    const unique = [...new Set(candidates)];

    if (unique.length === 0) {
      throw new Error(
        '[smoke/global-setup] No admin password available.\n\n' +
          'Set at least one of:\n' +
          '  SMOKE_ADMIN_PASSWORD  — dedicated smoke credential (preferred)\n' +
          '  ADMIN_RESET_PASSWORD  — operator-supplied reset password\n' +
          '  DEMO_PILOT_PASSWORD   — dev seeding password',
      );
    }

    let user: Record<string, unknown> | null = null;
    const attemptLog: string[] = [];

    for (const pw of unique) {
      const res = await ctx.post('/api/auth/login', {
        data: { username: 'admin', password: pw },
      });

      if (!res.ok()) {
        attemptLog.push(`  • "${pw.slice(0, 4)}…" → HTTP ${res.status()} (wrong password or locked)`);
        continue;
      }

      const body = (await res.json()) as Record<string, unknown>;

      if (!body.mustChangePassword) {
        user = body;
        break;
      }

      attemptLog.push(`  • "${pw.slice(0, 4)}…" → authenticated but mustChangePassword=true`);

      if (!allowRotation) {
        continue; // fail-safe: do not rotate without explicit opt-in
      }

      // ── Opt-in rotation ───────────────────────────────────────────────────
      const rotationPassword = process.env.SMOKE_ROTATION_PASSWORD!;

      console.warn(
        '\n⚠️  [smoke/global-setup] SMOKE_ALLOW_PASSWORD_ROTATION=true:\n' +
          `    Calling change-password (current: "${pw.slice(0, 4)}…" → new: SMOKE_ROTATION_PASSWORD).\n` +
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
          '     rotate the credential automatically.\n' +
          '     Then set SMOKE_ADMIN_PASSWORD=<that value> for subsequent runs.'
        : '';

      throw new Error(
        '[smoke/global-setup] Could not authenticate as admin.\n\n' +
          'Attempts:\n' + attemptLog.join('\n') +
          mcpHint +
          '\n\nPassword sources checked (in order):\n' +
          '  1. SMOKE_ADMIN_PASSWORD env var\n' +
          '  2. ADMIN_RESET_PASSWORD  env var\n' +
          '  3. DEMO_PILOT_PASSWORD   env var',
      );
    }

    const state = await ctx.storageState();
    const stateWithStorage = {
      ...state,
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            {
              name: 'hrms-session',
              value: JSON.stringify({ ...user, mustChangePassword: false }),
            },
          ],
        },
      ],
    };

    fs.writeFileSync(AUTH_FILE, JSON.stringify(stateWithStorage, null, 2));
    console.log(
      `[smoke/global-setup] auth.json written (username: ${user.username}, roleId: ${user.roleId})`,
    );
  } finally {
    await ctx.dispose();
  }
}
