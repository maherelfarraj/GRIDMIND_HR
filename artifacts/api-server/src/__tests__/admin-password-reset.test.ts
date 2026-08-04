/**
 * Regression tests for FORCE_ADMIN_PASSWORD_RESET boot-time recovery.
 *
 * The reset must be a strict no-op without the flag; with the flag it must
 * rotate the admin credential via the handoff-file-first protocol, revoke
 * admin sessions, never log the OTP, and skip rotation ONLY when a
 * still-valid handoff entry exists (the generic must_change_password flag
 * alone must not suppress recovery — that is the lockout it exists to fix).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import { forceAdminPasswordReset } from "../lib/seed-passwords";
import { logger } from "../lib/logger";

let tmpDir: string;
let saved: { passwordHash: string | null; mustChangePassword: boolean; id: number };

async function getAdmin() {
  const [admin] = await db
    .select({
      id: systemUsersTable.id,
      passwordHash: systemUsersTable.passwordHash,
      mustChangePassword: systemUsersTable.mustChangePassword,
    })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.username, "admin"));
  return admin;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-handoff-"));
  vi.stubEnv("ONE_TIME_PASSWORD_DIR", tmpDir);
  const admin = await getAdmin();
  saved = admin;
});

afterEach(async () => {
  await db
    .update(systemUsersTable)
    .set({ passwordHash: saved.passwordHash, mustChangePassword: saved.mustChangePassword })
    .where(eq(systemUsersTable.id, saved.id));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function handoffFiles(): string[] {
  return fs.readdirSync(tmpDir).filter((n) => n.startsWith("one-time-passwords-"));
}

function readHandoffOtp(): string {
  const [name] = handoffFiles();
  const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, name), "utf8"));
  const entry = parsed.accounts.find((a: { username: string }) => a.username === "admin");
  return entry.oneTimePassword;
}

describe("forceAdminPasswordReset", () => {
  it("is a strict no-op when the flag is not set", async () => {
    vi.stubEnv("FORCE_ADMIN_PASSWORD_RESET", "");
    expect(await forceAdminPasswordReset()).toBe(false);
    expect(handoffFiles()).toHaveLength(0);
    const admin = await getAdmin();
    expect(admin.passwordHash).toBe(saved.passwordHash);
  });

  it("rotates to a handoff OTP, flags must_change_password, revokes admin sessions, and never logs the OTP", async () => {
    vi.stubEnv("FORCE_ADMIN_PASSWORD_RESET", "true");
    await db
      .update(systemUsersTable)
      .set({ mustChangePassword: false })
      .where(eq(systemUsersTable.id, saved.id));
    // Plant an admin session that must die with the reset.
    const sid = `test-reset-${Date.now()}`;
    await db.execute(
      sql`INSERT INTO "session" (sid, sess, expire) VALUES (${sid}, ${JSON.stringify({ userId: saved.id })}::json, now() + interval '1 hour')`,
    );
    const logged: string[] = [];
    const spy = vi.spyOn(logger, "warn").mockImplementation(((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    }) as never);

    try {
      expect(await forceAdminPasswordReset()).toBe(true);

      const otp = readHandoffOtp();
      const admin = await getAdmin();
      expect(admin.mustChangePassword).toBe(true);
      expect(await bcrypt.compare(otp, admin.passwordHash!)).toBe(true);
      // File permissions: operator-only.
      const [name] = handoffFiles();
      expect(fs.statSync(path.join(tmpDir, name)).mode & 0o777).toBe(0o600);
      // Session revoked atomically.
      const rows = await db.execute(sql`SELECT sid FROM "session" WHERE sid = ${sid}`);
      expect((rows as { rows: unknown[] }).rows ?? rows).toHaveLength(0);
      // The OTP never appears in any log line.
      expect(logged.join("\n")).not.toContain(otp);
    } finally {
      spy.mockRestore();
      await db.execute(sql`DELETE FROM "session" WHERE sid = ${sid}`);
    }
  });

  it("skips rotation while a still-valid handoff OTP exists, but rotates when the handoff file is gone", async () => {
    vi.stubEnv("FORCE_ADMIN_PASSWORD_RESET", "true");
    await db
      .update(systemUsersTable)
      .set({ mustChangePassword: false })
      .where(eq(systemUsersTable.id, saved.id));

    // First run rotates.
    expect(await forceAdminPasswordReset()).toBe(true);
    const firstOtp = readHandoffOtp();

    // Second run: valid handoff entry exists -> skip, OTP stays valid.
    expect(await forceAdminPasswordReset()).toBe(false);
    const adminAfterSkip = await getAdmin();
    expect(await bcrypt.compare(firstOtp, adminAfterSkip.passwordHash!)).toBe(true);
    expect(handoffFiles()).toHaveLength(1);

    // Handoff file deleted (the lockout scenario): must rotate again even
    // though must_change_password is still true.
    fs.rmSync(path.join(tmpDir, handoffFiles()[0]));
    expect(await forceAdminPasswordReset()).toBe(true);
    const newOtp = readHandoffOtp();
    expect(newOtp).not.toBe(firstOtp);
    const adminAfterRecovery = await getAdmin();
    expect(await bcrypt.compare(newOtp, adminAfterRecovery.passwordHash!)).toBe(true);
  });
});
