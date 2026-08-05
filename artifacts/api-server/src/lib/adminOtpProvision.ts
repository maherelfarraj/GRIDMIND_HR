/**
 * Unconditional admin OTP re-provisioning.
 *
 * Exposes the same write-file-first, bcrypt-then-commit protocol used by
 * forceAdminPasswordReset()'s OTP branch, but without the
 * FORCE_ADMIN_PASSWORD_RESET / ADMIN_RESET_PASSWORD env-flag ceremony.
 * Use this when the handoff file is the required delivery channel (e.g.
 * ADMIN_RESET_PASSWORD is not available or a fresh file is explicitly needed).
 *
 * All shared helpers (generateOneTimePassword, writeOneTimePasswordHandoff,
 * revokeUserSessions, HARDENING_LOCK_KEY) come from their respective source
 * modules so semantics stay in sync with the boot-time reset path.
 */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, systemUsersTable, auditLogsTable } from "@workspace/db";
import { generateOneTimePassword } from "./oneTimePassword.js";
import { revokeUserSessions } from "./sessionRevocation.js";
import { writeOneTimePasswordHandoff, HARDENING_LOCK_KEY } from "./seed-passwords.js";
import { logger } from "./logger.js";

export interface AdminOtpProvisionResult {
  filePath: string;
  revokedSessions: number;
}

/**
 * Reset `username`'s password to a random OTP delivered via the operator
 * handoff file, flag mustChangePassword, and revoke all existing sessions.
 *
 * Protocol (identical to forceAdminPasswordReset OTP branch):
 *   1. Generate OTP + bcrypt hash in memory.
 *   2. Write OTP to the 0600 handoff file FIRST (exclusive create).
 *      If the write fails the function throws before touching the DB,
 *      so the existing credential is never disturbed.
 *   3. Commit hash + mustChangePassword=true under the advisory lock.
 *   4. Revoke all sessions atomically in the same transaction.
 *   5. Insert an audit record (no credential in changesJson).
 *
 * Returns the handoff file path and the number of sessions revoked.
 * Never logs the OTP value — only the file path is logged.
 */
export async function provisionAdminOtp(username = "admin"): Promise<AdminOtpProvisionResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${HARDENING_LOCK_KEY})`);

    const [admin] = await tx
      .select({ id: systemUsersTable.id, username: systemUsersTable.username })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, username));

    if (!admin) {
      throw new Error(`provisionAdminOtp: no account '${username}' found in system_users`);
    }

    const otp = generateOneTimePassword();
    const hash = await bcrypt.hash(otp, 10);

    // Handoff file written FIRST — a write failure aborts before any DB
    // mutation, leaving the existing credential intact (fail-closed).
    const filePath = writeOneTimePasswordHandoff([{ username: admin.username, oneTimePassword: otp }]);

    await tx
      .update(systemUsersTable)
      .set({ passwordHash: hash, mustChangePassword: true })
      .where(eq(systemUsersTable.id, admin.id));

    const revokedSessions = await revokeUserSessions(tx, admin.id);

    await tx.insert(auditLogsTable).values({
      actorUserId: null,
      action: "admin.emergency_password_reset",
      entityType: "system_user",
      entityId: admin.id,
      entityLabel: admin.username,
      changesJson: JSON.stringify({
        trigger: "reprovision-admin-otp-script",
        source: "OTP_HANDOFF_FILE",
        mustChangePassword: true,
        revokedSessions,
      }),
    });

    // Log only the file path — never the OTP value.
    logger.warn(
      { filePath },
      "Admin OTP re-provisioned: retrieve the one-time password from the operator handoff file (0600), deliver out-of-band, then delete the file.",
    );

    return { filePath, revokedSessions };
  });
}
