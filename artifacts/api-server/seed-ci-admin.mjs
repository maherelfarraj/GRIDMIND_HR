/**
 * CI-only seed: provisions a minimal admin role + system user in a fresh
 * database so the login-smoke test has valid credentials to authenticate with.
 *
 * Run BEFORE starting the API server so the user already exists when the
 * server boots (no race with the server's non-blocking seeding paths).
 *
 * Env vars required:
 *   DATABASE_URL      — postgres connection string
 *   CI_ADMIN_PASSWORD — the password to hash and store
 *
 * Uses spawnSync (NOT execSync with a shell) when calling psql so that the
 * bcrypt hash — which contains '$' characters — is passed as a raw argument
 * without any shell variable expansion.
 *
 * Idempotent: the system_users ON CONFLICT DO UPDATE means a second run
 * just refreshes the hash.
 */
import bcrypt from 'bcryptjs';
import { spawnSync } from 'node:child_process';

const dbUrl = process.env.DATABASE_URL;
const password = process.env.CI_ADMIN_PASSWORD;

if (!dbUrl) throw new Error('[seed-ci-admin] DATABASE_URL is required');
if (!password) throw new Error('[seed-ci-admin] CI_ADMIN_PASSWORD is required');

/** Run psql with args as an array — no shell, no variable expansion. */
function psqlRun(args) {
  const result = spawnSync('psql', [dbUrl, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[seed-ci-admin] psql failed (exit ${result.status}):\n${result.stderr}`);
  }
  return result.stdout.trim();
}

// Hash the CI password with the same cost factor the application uses.
const hash = await bcrypt.hash(password, 10);
console.log('[seed-ci-admin] Password hashed (bcrypt rounds=10)');

// ── 1. Create a system role (every CI run gets a fresh DB so no conflicts) ──
const roleId = psqlRun([
  '-t', '-A', '-c',
  "INSERT INTO roles (name_en, name_ar, system_role, permissions_json) VALUES ('CI Admin', 'مدير', true, '[\"*\"]') RETURNING id",
]);
if (!roleId || isNaN(Number(roleId))) {
  throw new Error(`[seed-ci-admin] Unexpected role id: "${roleId}"`);
}
console.log('[seed-ci-admin] Role created (id=%s)', roleId);

// ── 2. Insert (or refresh) the admin system user ──────────────────────────
// Pass the hash via psql's -v mechanism with spawnSync — the '$2b$10$...'
// characters reach psql literally, with no shell to misinterpret them.
// :'hash' in SQL gives a properly-quoted string literal for the hash value.
psqlRun([
  '-v', `hash=${hash}`,
  '-v', `role_id=${roleId}`,
  '-c',
  [
    'INSERT INTO system_users',
    '  (username, email, full_name_en, full_name_ar, role_id, is_active, password_hash, must_change_password)',
    "VALUES ('admin', 'admin@ci.local', 'CI Admin', 'مدير', :role_id::int, true, :'hash', false)",
    'ON CONFLICT (username) DO UPDATE',
    "  SET password_hash        = :'hash',",
    '      must_change_password = false,',
    '      is_active            = true',
  ].join(' '),
]);

console.log(
  '[seed-ci-admin] admin user provisioned (role_id=%s, must_change_password=false)',
  roleId,
);
