/**
 * Regression tests for the demo password provisioning gates.
 *
 * seedDemoPasswords must be a strict no-op unless SEED_DEMO_PASSWORDS=true,
 * must never run in production, and must never provision without an
 * explicit DEMO_PILOT_PASSWORD env value. Read-only against the DB in all
 * gated cases (function returns before any query).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { logger } from "../lib/logger";
import { inArray, eq } from "drizzle-orm";
import { db, systemUsersTable, systemConfigTable } from "@workspace/db";
import { seedDemoPasswords, DEMO_HARDENING_MARKER_KEY } from "../lib/seed-passwords";

async function markerExists(): Promise<boolean> {
  const rows = await db
    .select({ id: systemConfigTable.id })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, DEMO_HARDENING_MARKER_KEY));
  return rows.length > 0;
}

async function restoreMarker(existedBefore: boolean) {
  if (!existedBefore) {
    await db.delete(systemConfigTable).where(eq(systemConfigTable.key, DEMO_HARDENING_MARKER_KEY));
  }
}

const DEMO_ACCOUNTS = ["admin", "fatima.zahrani", "omar.ghamdi", "aisha.otaibi"];

async function snapshot() {
  return db
    .select({
      id: systemUsersTable.id,
      username: systemUsersTable.username,
      passwordHash: systemUsersTable.passwordHash,
      mustChangePassword: systemUsersTable.mustChangePassword,
    })
    .from(systemUsersTable)
    .where(inArray(systemUsersTable.username, DEMO_ACCOUNTS));
}

async function restore(rows: Awaited<ReturnType<typeof snapshot>>) {
  for (const u of rows) {
    await db
      .update(systemUsersTable)
      .set({ passwordHash: u.passwordHash, mustChangePassword: u.mustChangePassword })
      .where(eq(systemUsersTable.id, u.id));
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seedDemoPasswords gating", () => {
  it("does nothing when SEED_DEMO_PASSWORDS is not set", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "SomePassword123!");
    await expect(seedDemoPasswords()).resolves.toBe(0);
  });

  it("never provisions the known demo password when NODE_ENV=production even if the flag is set", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "true");
    vi.stubEnv("NODE_ENV", "production");
    // A password no seeded account actually uses: nothing matches, and any
    // NULL-hash account gets a random OTP — never this value.
    vi.stubEnv("DEMO_PILOT_PASSWORD", "Definitely-Not-A-Real-Password-XYZ!");
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    const markerBefore = await markerExists();
    const before = await snapshot();
    try {
      await seedDemoPasswords();
      const after = await snapshot();
      for (const u of after) {
        // Every demo account ends up with some hash, but never the demo password.
        expect(u.passwordHash).toBeTruthy();
        expect(bcrypt.compareSync("Definitely-Not-A-Real-Password-XYZ!", u.passwordHash!)).toBe(false);
      }
      // Accounts that had no hash got a random OTP and are forced to rotate.
      for (const u of before.filter((b) => b.passwordHash === null)) {
        const now = after.find((a) => a.id === u.id)!;
        expect(now.mustChangePassword).toBe(true);
      }
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
  });

  it("in production without DEMO_PILOT_PASSWORD, forces legacy demo accounts to rotate once, but never re-flags a rotated password", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    const markerBefore = await markerExists();
    const before = await snapshot();
    const target = before[0]!;
    try {
      // Fresh production instance: no hardening marker yet, and an account
      // still carrying a (possibly well-known) seeded credential.
      await db.delete(systemConfigTable).where(eq(systemConfigTable.key, DEMO_HARDENING_MARKER_KEY));
      const legacyHash = await bcrypt.hash("LegacyDemoPassword123!", 4);
      await db
        .update(systemUsersTable)
        .set({ passwordHash: legacyHash, mustChangePassword: false })
        .where(eq(systemUsersTable.id, target.id));

      await seedDemoPasswords();

      let now = (await snapshot()).find((a) => a.id === target.id)!;
      expect(now.mustChangePassword).toBe(true);
      expect(now.passwordHash).toBe(legacyHash);
      expect(await markerExists()).toBe(true);

      // The owner rotates their password; a later restart must NOT re-flag it.
      const rotatedHash = await bcrypt.hash("Owner-Rotated-Password-456!", 4);
      await db
        .update(systemUsersTable)
        .set({ passwordHash: rotatedHash, mustChangePassword: false })
        .where(eq(systemUsersTable.id, target.id));

      await seedDemoPasswords();

      now = (await snapshot()).find((a) => a.id === target.id)!;
      expect(now.mustChangePassword).toBe(false);
      expect(now.passwordHash).toBe(rotatedHash);
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
  });

  it(
    "production startup never opens the listener when the OTP handoff path is unwritable",
    { timeout: 120_000 },
    async () => {
      const serverRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
      // Build the production bundle exactly as `pnpm run start` would use it.
      execSync("node ./build.mjs", { cwd: serverRoot, stdio: "ignore" });

      const blocker = path.join(os.tmpdir(), `otp-blocker-startup-${Date.now()}`);
      fs.writeFileSync(blocker, "not a directory");
      const markerBefore = await markerExists();
      const before = await snapshot();
      const target = before[0]!;
      const port = 39000 + Math.floor(Math.random() * 1000);
      try {
        // Ensure provisioning has real work to do (a fail-closed account).
        await db
          .update(systemUsersTable)
          .set({ passwordHash: null, mustChangePassword: false })
          .where(eq(systemUsersTable.id, target.id));

        const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
          cwd: serverRoot,
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(port),
            ONE_TIME_PASSWORD_DIR: blocker,
            SEED_DEMO_PASSWORDS: "",
            DEMO_PILOT_PASSWORD: "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (d) => (output += d.toString()));
        child.stderr.on("data", (d) => (output += d.toString()));
        const exitCode: number | null = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve(null);
          }, 90_000);
          child.on("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        });

        // Startup must abort with a non-zero exit and never bind the port.
        expect(exitCode).toBe(1);
        expect(output).not.toContain("Server listening");

        // The account remains untouched / fail-closed.
        const now = (await snapshot()).find((a) => a.id === target.id)!;
        expect(now.passwordHash).toBeNull();
      } finally {
        await restore(before);
        await restoreMarker(markerBefore);
        fs.rmSync(blocker, { force: true });
      }
    },
  );

  it("in production, recovers from a crashed provisioning run by pruning handoff entries that don't match live credentials", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    const markerBefore = await markerExists();
    const before = await snapshot();
    const target = before[0]!;
    try {
      // Simulate a crash that left a handoff file with one valid entry
      // (OTP matches the committed, still-flagged credential) and one
      // stale entry (OTP never committed / lost a race).
      const validOtp = "Valid-OTP-abc123";
      await db
        .update(systemUsersTable)
        .set({ passwordHash: await bcrypt.hash(validOtp, 4), mustChangePassword: true })
        .where(eq(systemUsersTable.id, target.id));
      const otherUsername = before[1]!.username;
      const mixedFile = path.join(otpDir, "one-time-passwords-1-crashed.json");
      fs.writeFileSync(
        mixedFile,
        JSON.stringify({
          accounts: [
            { username: target.username, oneTimePassword: validOtp },
            { username: otherUsername, oneTimePassword: "Stale-Never-Committed-OTP" },
          ],
        }),
        { mode: 0o600 },
      );
      // A file whose every entry is stale must be removed entirely.
      const staleFile = path.join(otpDir, "one-time-passwords-2-stale.json");
      fs.writeFileSync(
        staleFile,
        JSON.stringify({ accounts: [{ username: target.username, oneTimePassword: "Wrong-OTP" }] }),
        { mode: 0o600 },
      );

      await seedDemoPasswords();

      expect(fs.existsSync(staleFile)).toBe(false);
      const mixed = JSON.parse(fs.readFileSync(mixedFile, "utf8"));
      const usernames = mixed.accounts.map((a: { username: string }) => a.username);
      expect(usernames).toContain(target.username);
      expect(usernames).not.toContain(otherUsername);
      expect(
        mixed.accounts.some(
          (a: { username: string; oneTimePassword: string }) =>
            a.username === target.username && a.oneTimePassword === validOtp,
        ),
      ).toBe(true);
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
  });

  it("in production, gives NULL-hash accounts a random OTP (handed off via 0600 file, never logged) and flags demo-password accounts, idempotently", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    const demoPassword = "KnownDemoPassword123!";
    vi.stubEnv("DEMO_PILOT_PASSWORD", demoPassword);
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    // Capture everything sent to the logger so we can prove the plaintext
    // OTP never enters the log stream.
    const logged: string[] = [];
    const spies = (["info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      }) as never),
    );

    const markerBefore = await markerExists();
    const before = await snapshot();
    const [nullAcct, hashedAcct] = [before[0]!, before[1]!];
    try {
      // Arrange: one account with no hash, one carrying the well-known demo password.
      const demoHash = await bcrypt.hash(demoPassword, 4);
      await db
        .update(systemUsersTable)
        .set({ passwordHash: null, mustChangePassword: false })
        .where(eq(systemUsersTable.id, nullAcct.id));
      await db
        .update(systemUsersTable)
        .set({ passwordHash: demoHash, mustChangePassword: false })
        .where(eq(systemUsersTable.id, hashedAcct.id));

      const changed = await seedDemoPasswords();
      expect(changed).toBeGreaterThanOrEqual(2);

      const after = await snapshot();
      const nullNow = after.find((a) => a.id === nullAcct.id)!;
      const hashedNow = after.find((a) => a.id === hashedAcct.id)!;

      // NULL-hash account: random password (not the demo one), forced change.
      expect(nullNow.passwordHash).toBeTruthy();
      expect(bcrypt.compareSync(demoPassword, nullNow.passwordHash!)).toBe(false);
      expect(nullNow.mustChangePassword).toBe(true);

      // The OTP is delivered via an operator-only file with 0600 perms…
      const handoffFiles = fs.readdirSync(otpDir);
      expect(handoffFiles.length).toBe(1);
      const handoffPath = path.join(otpDir, handoffFiles[0]!);
      const mode = fs.statSync(handoffPath).mode & 0o777;
      expect(mode).toBe(0o400);
      const handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8"));
      const entry = handoff.accounts.find((a: { username: string }) => a.username === nullAcct.username);
      expect(entry).toBeTruthy();
      expect(bcrypt.compareSync(entry.oneTimePassword, nullNow.passwordHash!)).toBe(true);

      // …and NEVER appears anywhere in the log stream.
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain(entry.oneTimePassword);
      }

      // Demo-password account: hash untouched, but flagged for forced change.
      expect(hashedNow.passwordHash).toBe(demoHash);
      expect(hashedNow.mustChangePassword).toBe(true);

      // Second run: everything already hardened/flagged — nothing to change
      // for these two accounts (flagged accounts are skipped).
      const secondBefore = await snapshot();
      await seedDemoPasswords();
      const secondAfter = await snapshot();
      expect(secondAfter.find((a) => a.id === nullAcct.id)!.passwordHash).toBe(
        secondBefore.find((a) => a.id === nullAcct.id)!.passwordHash,
      );
      expect(secondAfter.find((a) => a.id === hashedAcct.id)!.passwordHash).toBe(demoHash);
    } finally {
      for (const spy of spies) spy.mockRestore();
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
  });

  it("in production, commits NO password if the OTP handoff file cannot be written", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    // Point the handoff dir at a regular file so mkdirSync fails.
    const blocker = path.join(os.tmpdir(), `otp-blocker-${Date.now()}`);
    fs.writeFileSync(blocker, "not a directory");
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", blocker);

    const markerBefore = await markerExists();
    const before = await snapshot();
    const target = before[0]!;
    try {
      await db
        .update(systemUsersTable)
        .set({ passwordHash: null, mustChangePassword: false })
        .where(eq(systemUsersTable.id, target.id));

      await expect(seedDemoPasswords()).rejects.toThrow();

      // The account must remain untouched (fail-closed), never behind an
      // unknown password.
      const after = await snapshot();
      const now = after.find((a) => a.id === target.id)!;
      expect(now.passwordHash).toBeNull();
      expect(now.mustChangePassword).toBe(false);
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(blocker, { force: true });
    }
  });

  it("in production, concurrent provisioners hand off exactly one valid OTP per account", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    const markerBefore = await markerExists();
    const before = await snapshot();
    const target = before[0]!;
    try {
      await db
        .update(systemUsersTable)
        .set({ passwordHash: null, mustChangePassword: false })
        .where(eq(systemUsersTable.id, target.id));

      // Two instances race to provision the same NULL-hash account.
      await Promise.all([seedDemoPasswords(), seedDemoPasswords()]);

      const after = await snapshot();
      const now = after.find((a) => a.id === target.id)!;
      expect(now.passwordHash).toBeTruthy();
      expect(now.mustChangePassword).toBe(true);

      // Across all surviving handoff files, exactly one OTP for this
      // account matches the stored hash — the loser's OTP was discarded.
      const otps: string[] = [];
      for (const f of fs.readdirSync(otpDir)) {
        const handoff = JSON.parse(fs.readFileSync(path.join(otpDir, f), "utf8"));
        for (const a of handoff.accounts) {
          if (a.username === target.username) otps.push(a.oneTimePassword);
        }
      }
      const matching = otps.filter((otp) => bcrypt.compareSync(otp, now.passwordHash!));
      expect(matching.length).toBe(1);
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
  });

  it("writeOneTimePasswordHandoff creates the file with mode 0o400 (read-only)", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-mode-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    const markerBefore = await markerExists();
    const before = await snapshot();
    const target = before[0]!;
    try {
      // Ensure the account is NULL-hash so provisioning creates a handoff file.
      await db
        .update(systemUsersTable)
        .set({ passwordHash: null, mustChangePassword: false })
        .where(eq(systemUsersTable.id, target.id));

      await seedDemoPasswords();

      const files = fs.readdirSync(otpDir).filter((n) => n.startsWith("one-time-passwords-"));
      expect(files.length).toBeGreaterThanOrEqual(1);
      for (const f of files) {
        const mode = fs.statSync(path.join(otpDir, f)).mode & 0o777;
        expect(mode).toBe(0o400);
      }
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
  });

  it("reconcile rewrite is atomic: on injected rename failure, original content survives intact", async () => {
    vi.stubEnv("SEED_DEMO_PASSWORDS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_PILOT_PASSWORD", "");
    const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-atomic-"));
    vi.stubEnv("ONE_TIME_PASSWORD_DIR", otpDir);

    const markerBefore = await markerExists();
    const before = await snapshot();
    const target = before[0]!;
    try {
      // Set up a handoff file with one valid entry and one stale entry so
      // reconcile will attempt a rewrite (valid.length > 0, < entries.length).
      const validOtp = "Valid-OTP-atomic123";
      await db
        .update(systemUsersTable)
        .set({ passwordHash: await bcrypt.hash(validOtp, 4), mustChangePassword: true })
        .where(eq(systemUsersTable.id, target.id));
      const otherUsername = before[1]!.username;
      const originalContent = JSON.stringify({
        accounts: [
          { username: target.username, oneTimePassword: validOtp },
          { username: otherUsername, oneTimePassword: "Stale-Never-Committed" },
        ],
      });
      const mixedFile = path.join(otpDir, "one-time-passwords-1-atomic.json");
      fs.writeFileSync(mixedFile, originalContent, { mode: 0o400 });

      // Inject a failure at the rename step.
      const renameOrig = fs.renameSync.bind(fs);
      const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce((_src, _dst) => {
        throw new Error("injected rename failure");
      });

      try {
        await expect(seedDemoPasswords()).rejects.toThrow("injected rename failure");
      } finally {
        renameSpy.mockRestore();
        // Restore rename for cleanup calls.
        void renameOrig; // referenced to satisfy linter
      }

      // Original file must survive with its full content — no 0-byte intermediate.
      expect(fs.existsSync(mixedFile)).toBe(true);
      const surviving = fs.readFileSync(mixedFile, "utf8");
      const parsed = JSON.parse(surviving);
      expect(Array.isArray(parsed.accounts)).toBe(true);
      expect(parsed.accounts.length).toBe(2);

      // No lingering .tmp file either.
      expect(fs.existsSync(mixedFile + ".tmp")).toBe(false);
    } finally {
      await restore(before);
      await restoreMarker(markerBefore);
      fs.rmSync(otpDir, { recursive: true, force: true });
    }
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
