/**
 * Regression tests for the demo password provisioning gates.
 *
 * seedDemoPasswords must be a strict no-op unless SEED_DEMO_PASSWORDS=true,
 * must never run in production, and must never provision without an
 * explicit DEMO_PILOT_PASSWORD env value. Read-only against the DB in all
 * gated cases (function returns before any query).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import { seedDemoPasswords } from "../lib/seed-passwords";

const DEMO_ACCOUNTS = ["admin", "fatima.zahrani", "omar.ghamdi", "aisha.otaibi"];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seedDemoPasswords gating", () => {
  it("does nothing when SEED_DEMO_PASSWORDS is not set", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "SomePassword123!");
    await expect(seedDemoPasswords()).resolves.toBe(0);
  });

  it("refuses to run when NODE_ENV=production even if the flag is set", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "SomePassword123!");
    await expect(seedDemoPasswords()).resolves.toBe(0);
  });

  it("does nothing when DEMO_PILOT_PASSWORD is not provided", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    await expect(seedDemoPasswords()).resolves.toBe(0);
  });

  it("provisions only NULL-hash accounts with mustChangePassword=true, then is idempotent", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "SomePassword123!");

    // Snapshot current state so the test is self-cleaning regardless of
    // whether demo accounts already carry hashes.
    const before = await db
      .select({
        id: systemUsersTable.id,
        passwordHash: systemUsersTable.passwordHash,
        mustChangePassword: systemUsersTable.mustChangePassword,
      })
      .from(systemUsersTable)
      .where(inArray(systemUsersTable.username, DEMO_ACCOUNTS));
    const nullBefore = before.filter((u) => u.passwordHash === null);

    try {
      // First run provisions exactly the NULL-hash accounts.
      await expect(seedDemoPasswords()).resolves.toBe(nullBefore.length);

      const after = await db
        .select({
          id: systemUsersTable.id,
          passwordHash: systemUsersTable.passwordHash,
          mustChangePassword: systemUsersTable.mustChangePassword,
        })
        .from(systemUsersTable)
        .where(inArray(systemUsersTable.username, DEMO_ACCOUNTS));
      for (const u of after) {
        expect(u.passwordHash).toBeTruthy();
      }
      // Newly provisioned accounts must be forced to change their password.
      for (const u of nullBefore) {
        const now = after.find((a) => a.id === u.id)!;
        expect(now.mustChangePassword).toBe(true);
      }

      // Second run: everything has a hash, so nothing is provisioned.
      await expect(seedDemoPasswords()).resolves.toBe(0);
    } finally {
      // Restore the snapshot.
      for (const u of before) {
        await db
          .update(systemUsersTable)
          .set({ passwordHash: u.passwordHash, mustChangePassword: u.mustChangePassword })
          .where(eq(systemUsersTable.id, u.id));
      }
    }
  });
});
