/**
 * Idempotent password provisioning for demo pilot accounts.
 *
 * Login enforcement (PILOT_AUTH=true) is fail-closed: an account with no
 * stored password hash cannot sign in at all. This provisions bcrypt hashes
 * for the demo accounts so flipping PILOT_AUTH on does not lock everyone out.
 *
 * Safety gates (no hardcoded credentials, disabled by default):
 *   - Runs only when SEED_DEMO_PASSWORDS=true is set explicitly.
 *   - Never runs when NODE_ENV=production.
 *   - The password itself comes from the DEMO_PILOT_PASSWORD env var;
 *     without it, nothing is provisioned.
 *
 * Only fills in accounts whose password_hash is still NULL — it never
 * overwrites a password that was changed via the admin set-password flow.
 */
import bcrypt from "bcryptjs";
import { db, systemUsersTable } from "@workspace/db";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { logger } from "./logger";

const DEMO_ACCOUNTS = ["admin", "fatima.zahrani", "omar.ghamdi", "aisha.otaibi"];

export async function seedDemoPasswords(): Promise<number> {
  if (process.env.SEED_DEMO_PASSWORDS !== "true") return 0;
  if (process.env.NODE_ENV === "production") {
    logger.warn("SEED_DEMO_PASSWORDS is set but NODE_ENV=production — refusing to provision demo passwords");
    return 0;
  }
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
