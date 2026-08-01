/**
 * Revoke all connect-pg-simple sessions belonging to a user, optionally
 * keeping one (the caller's own session on a self-service password change).
 *
 * connect-pg-simple stores the session payload in a `sess` JSON column, so
 * the user's sessions are matched via `sess->>'userId'`. Deleting the row is
 * an immediate, authoritative revocation: express-session simply fails to
 * load the session on the next request and the client is unauthenticated.
 *
 * Takes the drizzle executor (db or a transaction) so callers can make the
 * password update and the revocation atomic — if the session rows cannot be
 * deleted, the password change must roll back rather than reporting success
 * while stolen sessions stay alive.
 */
import { sql } from "drizzle-orm";
import type { db as dbType } from "@workspace/db";

type Executor = Pick<typeof dbType, "execute">;

export async function revokeUserSessions(
  executor: Executor,
  userId: number,
  keepSid?: string,
): Promise<number> {
  const uid = String(userId);
  const result = keepSid
    ? await executor.execute(
        sql`DELETE FROM "session" WHERE sess->>'userId' = ${uid} AND sid <> ${keepSid}`,
      )
    : await executor.execute(
        sql`DELETE FROM "session" WHERE sess->>'userId' = ${uid}`,
      );
  return Number((result as { rowCount?: number | null }).rowCount ?? 0);
}
