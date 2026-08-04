/**
 * Idempotent password provisioning for demo pilot accounts.
 *
 * Login enforcement (PILOT_AUTH=true) is fail-closed: an account with no
 * stored password hash cannot sign in at all. This provisions bcrypt hashes
 * for the demo accounts so flipping PILOT_AUTH on does not lock everyone out.
 *
 * Dev/demo behavior (NODE_ENV != production):
 *   - Runs only when SEED_DEMO_PASSWORDS=true is set explicitly.
 *   - The password itself comes from the DEMO_PILOT_PASSWORD env var;
 *     without it, nothing is provisioned.
 *   - Only fills in accounts whose password_hash is still NULL — it never
 *     overwrites a password that was changed via the admin set-password flow.
 *
 * Production behavior (NODE_ENV=production):
 *   - Never provisions a known/shared demo password, regardless of env flags.
 *   - Demo accounts with no password hash get a cryptographically random
 *     one-time password and must_change_password=true. The OTP is NEVER
 *     logged: it is written to an operator-only 0600 handoff file BEFORE the
 *     hash is committed, so a failed write can never leave an account with
 *     an unknown password (it stays NULL-hash / fail-closed instead).
 *     NOTE: this startup handoff is only the bootstrap fallback. The
 *     preferred channel is the admin UI flow (POST
 *     /users/:id/one-time-password), which shows a fresh OTP exactly once
 *     on demand — operators only need this file to recover the very first
 *     admin credential.
 *   - Demo accounts that may still carry the well-known demo password are
 *     forced to rotate: a one-time hardening pass (tracked via a
 *     system_config marker) flags every hashed, unflagged demo account
 *     regardless of env configuration, and whenever DEMO_PILOT_PASSWORD is
 *     set any account whose hash matches it is re-flagged.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db, systemUsersTable, systemConfigTable, auditLogsTable } from "@workspace/db";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { generateOneTimePassword } from "./oneTimePassword";
import { revokeUserSessions } from "./sessionRevocation.js";

/** Transaction handle type compatible with `db` for the queries we run. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Advisory lock key serializing production demo-account hardening across
 * concurrent instances. Reconciliation must never validate handoff entries
 * against a stale snapshot while another instance is mid-commit.
 */
const HARDENING_LOCK_KEY = 921_151;

const DEMO_ACCOUNTS = ["admin", "fatima.zahrani", "omar.ghamdi", "aisha.otaibi"];

/**
 * One-time marker: once the production legacy-credential hardening pass has
 * run, passwords rotated by their owners afterwards are trusted and never
 * re-flagged on subsequent restarts.
 */
export const DEMO_HARDENING_MARKER_KEY = "security.demo_accounts_hardened";

/**
 * Securely hand generated one-time passwords to the operator.
 *
 * Credentials must NEVER go through the application log (logs commonly flow
 * to aggregation/retention systems readable by many people). Instead they
 * are written to an operator-only file with 0600 permissions; only the file
 * path is logged. The operator reads it once, distributes the credentials
 * out-of-band, and deletes the file.
 */
function handoffPayload(entries: Array<{ username: string; oneTimePassword: string }>): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: "One-time passwords for accounts provisioned without credentials. Deliver each to its owner out-of-band, then DELETE THIS FILE. Each account must change its password at first login.",
      accounts: entries,
    },
    null,
    2,
  );
}

function handoffDir(): string {
  return process.env.ONE_TIME_PASSWORD_DIR || path.join(process.cwd(), ".credentials");
}

function writeOneTimePasswordHandoff(entries: Array<{ username: string; oneTimePassword: string }>): string {
  const dir = handoffDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(
    dir,
    `one-time-passwords-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`,
  );
  // 'wx' = exclusive create: never clobbers another provisioner's handoff.
  fs.writeFileSync(filePath, handoffPayload(entries), { mode: 0o600, flag: "wx" });
  // Harden to read-only so workspace editors (and other processes) cannot
  // truncate or overwrite the file; the operator reads then deletes it.
  fs.chmodSync(filePath, 0o400);
  return filePath;
}

/**
 * Recovery/reconciliation pass over the handoff directory.
 *
 * The handoff protocol is: write OTPs to the file first, then commit hashes
 * conditionally. A crash between those steps — or a lost race against a
 * concurrent provisioner — can leave a handoff entry whose OTP no longer
 * matches the stored credential. This pass makes the workflow durable and
 * self-healing: each entry is verified against the live DB (account must
 * still be flagged must_change_password and its hash must match the OTP);
 * invalid entries are dropped, files with no valid entries are deleted.
 * Runs at every production startup, both to recover from earlier crashes
 * and to finalize the current run's file after commits.
 */
async function reconcileHandoffFiles(tx: Tx): Promise<void> {
  const dir = handoffDir();
  if (!fs.existsSync(dir)) return;

  // Sweep orphaned *.tmp files left by a crash between write and rename.
  // They are never valid handoff files (the rename never completed), so
  // remove them unconditionally. Credential contents are NEVER logged —
  // we only log the path.
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".tmp")) continue;
    const tmpPath = path.join(dir, name);
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      /* ignore — file may already be writable or gone */
    }
    try {
      fs.rmSync(tmpPath, { force: true });
      logger.warn({ tmpPath }, "Removed orphaned credential tmp file left by a previous crash");
    } catch {
      /* best-effort; leave for operator inspection if undeletable */
    }
  }

  const users = await tx
    .select({
      username: systemUsersTable.username,
      passwordHash: systemUsersTable.passwordHash,
      mustChangePassword: systemUsersTable.mustChangePassword,
    })
    .from(systemUsersTable)
    .where(inArray(systemUsersTable.username, DEMO_ACCOUNTS));
  const byUsername = new Map(users.map((u) => [u.username, u]));

  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("one-time-passwords-") || !name.endsWith(".json")) continue;
    const filePath = path.join(dir, name);
    let parsed: { accounts?: Array<{ username: string; oneTimePassword: string }> };
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      // Not ours / corrupted — leave it for the operator to inspect.
      continue;
    }
    const entries = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const valid: Array<{ username: string; oneTimePassword: string }> = [];
    for (const entry of entries) {
      const user = byUsername.get(entry.username);
      if (
        user &&
        user.passwordHash !== null &&
        user.mustChangePassword &&
        typeof entry.oneTimePassword === "string" &&
        (await bcrypt.compare(entry.oneTimePassword, user.passwordHash))
      ) {
        valid.push(entry);
      }
    }
    if (valid.length === entries.length) continue;
    if (valid.length === 0) {
      // chmod before delete: the file may be 0o400 (read-only); directory
      // write permission is sufficient on Linux, but be explicit for clarity.
      try { fs.chmodSync(filePath, 0o600); } catch { /* ignore if already gone */ }
      fs.rmSync(filePath, { force: true });
      logger.warn({ filePath }, "Removed one-time password handoff file with no valid credentials");
    } else {
      // Atomic rewrite: write to a sibling tmp file, harden it, then rename
      // over the original so there is never a 0-byte intermediate state.
      // If any step fails before rename, the original file is untouched.
      const tmpPath = filePath + ".tmp";
      try {
        fs.writeFileSync(tmpPath, handoffPayload(valid), { mode: 0o600 });
        fs.chmodSync(tmpPath, 0o400);
        fs.renameSync(tmpPath, filePath);
      } catch (err) {
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* best-effort cleanup */ }
        throw err;
      }
      logger.warn(
        { filePath, accounts: valid.map((e) => e.username) },
        "Pruned stale entries from one-time password handoff file",
      );
    }
  }
}

/**
 * Production hardening pass over the demo accounts. Never writes a known
 * demo password. Returns the number of accounts changed.
 */
async function hardenProductionDemoAccounts(): Promise<number> {
  if (process.env.SEED_DEMO_PASSWORDS === "true") {
    logger.warn(
      "SEED_DEMO_PASSWORDS is set but NODE_ENV=production — refusing to provision demo passwords; hardening demo accounts instead",
    );
  }

  // The whole pass runs in one transaction holding an advisory lock, so
  // concurrent instances fully serialize: no reconciler ever validates
  // handoff files against a snapshot taken while another instance is
  // mid-commit, and each instance sees the previous one's committed state.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${HARDENING_LOCK_KEY})`);
    return hardenLocked(tx);
  });
}

async function hardenLocked(tx: Tx): Promise<number> {
  const accounts = await tx
    .select({
      id: systemUsersTable.id,
      username: systemUsersTable.username,
      passwordHash: systemUsersTable.passwordHash,
      mustChangePassword: systemUsersTable.mustChangePassword,
    })
    .from(systemUsersTable)
    .where(inArray(systemUsersTable.username, DEMO_ACCOUNTS));

  const demoPassword = process.env.DEMO_PILOT_PASSWORD;
  let changed = 0;

  // Recover from any earlier crash mid-provisioning: drop handoff entries
  // whose OTP no longer matches a live, still-flagged credential.
  await reconcileHandoffFiles(tx);

  // --- NULL-hash accounts: random one-time passwords -------------------
  // Fail-closed accounts would be locked out entirely; give each a random
  // one-time password instead of a predictable one. Ordering matters for
  // atomicity from the operator's perspective:
  //   1. Generate OTPs + hashes.
  //   2. Persist the handoff file FIRST (exclusive create, 0600). If this
  //      fails, no hash is committed — accounts stay NULL-hash/fail-closed
  //      exactly as before, never locked behind an unknown password.
  //   3. Commit each hash conditionally (WHERE password_hash IS NULL) and
  //      keep only actually-committed OTPs; a concurrent provisioner that
  //      won the race causes the losing OTP to be discarded and the
  //      handoff file rewritten (or removed) to match reality.
  const nullAccounts = accounts.filter((u) => u.passwordHash === null);
  if (nullAccounts.length > 0) {
    const pending = await Promise.all(
      nullAccounts.map(async (user) => {
        const oneTimePassword = generateOneTimePassword();
        return { user, oneTimePassword, hash: await bcrypt.hash(oneTimePassword, 10) };
      }),
    );

    let filePath: string;
    try {
      filePath = writeOneTimePasswordHandoff(
        pending.map((e) => ({ username: e.user.username, oneTimePassword: e.oneTimePassword })),
      );
    } catch (err) {
      logger.error(
        { err, accounts: nullAccounts.map((u) => u.username) },
        "Could not write the one-time password handoff file — NOT provisioning passwords for these accounts (they remain fail-closed). Fix ONE_TIME_PASSWORD_DIR (or the working directory permissions) and restart.",
      );
      throw err;
    }

    const committed: Array<{ username: string; oneTimePassword: string }> = [];
    for (const e of pending) {
      const rows = await tx
        .update(systemUsersTable)
        .set({ passwordHash: e.hash, mustChangePassword: true })
        .where(and(eq(systemUsersTable.id, e.user.id), isNull(systemUsersTable.passwordHash)))
        .returning({ id: systemUsersTable.id });
      if (rows.length > 0) {
        committed.push({ username: e.user.username, oneTimePassword: e.oneTimePassword });
        changed++;
        logger.warn(
          { username: e.user.username },
          "Provisioned RANDOM one-time password for account with no credentials — retrieve it from the operator handoff file; it must be changed at first login",
        );
      } else {
        logger.warn(
          { username: e.user.username },
          "Account was provisioned concurrently by another instance — discarding this instance's unused one-time password",
        );
      }
    }

    // Finalize: verify every handoff entry against the live DB and prune
    // anything that did not commit (lost races). This is the same durable
    // recovery pass that runs at startup, so a crash anywhere in this
    // block is repaired on the next boot.
    await reconcileHandoffFiles(tx);
    if (committed.length > 0) {
      logger.warn(
        { filePath, accounts: committed.map((e) => e.username) },
        "One-time passwords written to operator-only file (0600). Deliver them out-of-band and delete the file.",
      );
    }
  }

  // --- Accounts potentially carrying the well-known demo password ------
  // Detection cannot depend on DEMO_PILOT_PASSWORD being configured in
  // production (it usually isn't, and shouldn't be). Instead:
  //   - One-time pass (guarded by a system_config marker): every seeded
  //     demo account that still has a hash and is not already flagged is
  //     forced to rotate — we cannot prove its password is NOT the
  //     well-known demo one, so it must be changed once. Afterwards the
  //     marker prevents re-flagging passwords the owners rotated.
  //   - Ongoing guard: when DEMO_PILOT_PASSWORD happens to be set, any
  //     account whose hash matches it is always re-flagged.
  const [marker] = await tx
    .select({ id: systemConfigTable.id })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, DEMO_HARDENING_MARKER_KEY));
  const firstHardeningPass = !marker;

  for (const user of accounts) {
    if (user.passwordHash === null || user.mustChangePassword) continue;
    const matchesKnownDemoPassword =
      !!demoPassword && (await bcrypt.compare(demoPassword, user.passwordHash));
    if (firstHardeningPass || matchesKnownDemoPassword) {
      await tx
        .update(systemUsersTable)
        .set({ mustChangePassword: true })
        .where(eq(systemUsersTable.id, user.id));
      logger.warn(
        { username: user.username },
        matchesKnownDemoPassword
          ? "Account still uses the well-known demo password — flagged must_change_password; it must be rotated at next login"
          : "Seeded demo account may still use a well-known demo password — flagged must_change_password; it must be rotated at next login",
      );
      changed++;
    }
  }

  if (firstHardeningPass) {
    await tx
      .insert(systemConfigTable)
      .values({
        key: DEMO_HARDENING_MARKER_KEY,
        value: "true",
        valueType: "boolean",
        category: "security",
        labelEn: "Demo accounts hardened",
        labelAr: "تم تأمين الحسابات التجريبية",
        descriptionEn:
          "Set automatically after the one-time production pass that forces seeded demo accounts to rotate any legacy demo password.",
        isPublic: false,
        isReadonly: true,
      })
      .onConflictDoNothing({ target: systemConfigTable.key });
  }

  return changed;
}

/**
 * Operator-triggered admin password recovery.
 *
 * When the FORCE_ADMIN_PASSWORD_RESET env flag is "true" at boot, the admin
 * account's password is rotated to a cryptographically random one-time
 * password delivered via the operator-only 0600 handoff file (same protocol
 * as production bootstrap provisioning: file written FIRST, hash committed
 * after, never logged). The account is flagged must_change_password.
 *
 * Idempotence: repeated boots with the flag still set do NOT rotate again
 * as long as a still-valid one-time password for the admin exists in a
 * handoff file (verified against the live hash — the generic
 * must_change_password flag alone is NOT trusted, since other flows set it
 * and the file may have been deleted; in that case we rotate anyway rather
 * than leave the operator locked out). After recovering, unset the flag.
 *
 * All existing admin sessions are revoked in the same transaction — a
 * recovery reset must not leave possibly-compromised sessions alive.
 */
export async function forceAdminPasswordReset(): Promise<boolean> {
  if (process.env.FORCE_ADMIN_PASSWORD_RESET !== "true") return false;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${HARDENING_LOCK_KEY})`);

    const [admin] = await tx
      .select({
        id: systemUsersTable.id,
        username: systemUsersTable.username,
        passwordHash: systemUsersTable.passwordHash,
        mustChangePassword: systemUsersTable.mustChangePassword,
      })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, "admin"));
    if (!admin) {
      logger.error("FORCE_ADMIN_PASSWORD_RESET is set but no 'admin' account exists — nothing reset");
      return false;
    }

    // Pending-reset detection must be reset-specific: skip only when a
    // handoff file still holds an OTP that verifies against the live hash.
    if (admin.mustChangePassword && admin.passwordHash !== null) {
      const hasValidHandoff = await handoffHasValidEntry(admin.username, admin.passwordHash);
      if (hasValidHandoff) {
        logger.warn(
          "FORCE_ADMIN_PASSWORD_RESET is set but a pending admin reset is already outstanding — not rotating again. Retrieve the one-time password from the operator handoff file, then unset the flag.",
        );
        return false;
      }
    }

    const oneTimePassword = generateOneTimePassword();
    const hash = await bcrypt.hash(oneTimePassword, 10);

    // Handoff file FIRST: if it cannot be written, no hash is committed and
    // the current (known) password keeps working — never a lockout.
    const filePath = writeOneTimePasswordHandoff([{ username: admin.username, oneTimePassword }]);

    await tx
      .update(systemUsersTable)
      .set({ passwordHash: hash, mustChangePassword: true })
      .where(eq(systemUsersTable.id, admin.id));

    // Atomic with the credential change: retained sessions die with the
    // reset, or the whole reset rolls back.
    const revokedSessions = await revokeUserSessions(tx, admin.id);

    // Audit record: system/boot actor (actorUserId null), no password or OTP
    // in the detail — credential-handoff rule forbids logging credentials.
    await tx.insert(auditLogsTable).values({
      actorUserId: null,
      action: "admin.emergency_password_reset",
      entityType: "system_user",
      entityId: admin.id,
      entityLabel: admin.username,
      changesJson: JSON.stringify({
        trigger: "FORCE_ADMIN_PASSWORD_RESET",
        mustChangePassword: true,
        revokedSessions,
      }),
    });

    logger.warn(
      { filePath },
      "Admin password reset: a random one-time password was written to the operator-only handoff file (0600). Sign in with it once, set a new password, delete the file, and unset FORCE_ADMIN_PASSWORD_RESET.",
    );
    return true;
  });
}

/** True if any handoff file holds an OTP for `username` matching `passwordHash`. */
async function handoffHasValidEntry(username: string, passwordHash: string): Promise<boolean> {
  const dir = handoffDir();
  if (!fs.existsSync(dir)) return false;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("one-time-passwords-") || !name.endsWith(".json")) continue;
    let parsed: { accounts?: Array<{ username: string; oneTimePassword: string }> };
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    for (const entry of parsed.accounts ?? []) {
      if (
        entry.username === username &&
        typeof entry.oneTimePassword === "string" &&
        (await bcrypt.compare(entry.oneTimePassword, passwordHash))
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function seedDemoPasswords(): Promise<number> {
  if (process.env.NODE_ENV === "production") {
    return hardenProductionDemoAccounts();
  }

  if (process.env.SEED_DEMO_PASSWORDS !== "true") return 0;
  const demoPassword = process.env.DEMO_PILOT_PASSWORD;
  if (!demoPassword) {
    logger.warn("SEED_DEMO_PASSWORDS=true but DEMO_PILOT_PASSWORD is not set — nothing provisioned");
    return 0;
  }

  const missing = await db
    .select({ id: systemUsersTable.id, username: systemUsersTable.username })
    .from(systemUsersTable)
    .where(and(inArray(systemUsersTable.username, DEMO_ACCOUNTS), isNull(systemUsersTable.passwordHash)));

  if (missing.length === 0) return 0;

  const hash = await bcrypt.hash(demoPassword, 10);
  for (const user of missing) {
    await db
      .update(systemUsersTable)
      .set({ passwordHash: hash, mustChangePassword: true })
      .where(eq(systemUsersTable.id, user.id));
    logger.info({ username: user.username }, "Provisioned demo password hash");
  }
  return missing.length;
}
