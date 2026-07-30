/**
 * Regression tests for the demo password provisioning gates.
 *
 * seedDemoPasswords must be a strict no-op unless SEED_DEMO_PASSWORDS=true,
 * must never run in production, and must never provision without an
 * explicit DEMO_PILOT_PASSWORD env value. Read-only against the DB in all
 * gated cases (function returns before any query).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { seedDemoPasswords } from "../lib/seed-passwords";

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

  it("is idempotent: provisions nothing when all demo accounts already have hashes", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "SomePassword123!");
    // The live seeded DB already has hashes for all four demo accounts,
    // so this must not overwrite anything and returns 0.
    await expect(seedDemoPasswords()).resolves.toBe(0);
  });
});
