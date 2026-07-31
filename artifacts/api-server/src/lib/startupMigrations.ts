import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Applies the committed idempotent SQL migrations in lib/db/migrations at
 * startup, in filename order. Every file must be safe to re-run (IF NOT
 * EXISTS etc.), so a fresh database converges to the full schema and an
 * already-migrated database is a no-op. This is the deployment path for
 * schema changes because drizzle-kit push is unsafe here (it proposes
 * dropping the live `session` table owned by connect-pg-simple).
 */
export async function runStartupMigrations(): Promise<void> {
  // The server may run bundled (dist/index.mjs) or from src, and with cwd at
  // either the artifact dir or the repo root — walk upward from both anchors
  // until the workspace-level lib/db/migrations directory is found.
  const anchors = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  let migrationsDir: string | null = null;
  for (const anchor of anchors) {
    let dir = anchor;
    for (let i = 0; i < 8 && !migrationsDir; i++) {
      const candidate = path.join(dir, "lib/db/migrations");
      if (existsSync(candidate)) migrationsDir = candidate;
      dir = path.dirname(dir);
    }
    if (migrationsDir) break;
  }
  if (!migrationsDir) {
    throw new Error("Could not locate lib/db/migrations from bundle or cwd — refusing to start without schema migrations");
  }
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const ddl = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.execute(sql.raw(ddl));
    logger.info({ migration: file }, "Applied startup migration");
  }
}
