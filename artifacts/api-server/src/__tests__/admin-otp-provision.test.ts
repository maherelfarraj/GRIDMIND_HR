/**
 * Integration tests for provisionAdminOtp() — the unconditional OTP
 * re-provisioning helper in src/lib/adminOtpProvision.ts.
 *
 * Each test runs against the live seeded DB and is self-cleaning.
 * The handoff directory is redirected to a per-test temp dir via
 * ONE_TIME_PASSWORD_DIR so no real .credentials/ files are touched.
 *
 * Covered scenarios:
 *   1. Successful reset: 0600/0400 handoff file written, hash updated,
 *      sessions revoked, audit record written, OTP never appears in logs.
 *   2. Write-file-first ordering: when the handoff write fails, the existing
 *      password hash is preserved (the DB is never touched).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { eq, sql, desc } from "drizzle-orm";
import { db, systemUsersTable, auditLogsTable } from "@workspace/db";
import { provisionAdminOtp } from "../lib/adminOtpProvision";
import { logger } from "../lib/logger";

// ── fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;
let saved: { id: number; passwordHash: string | null; mustChangePassword: boolean };

async function getAdmin() {
  const [row] = await db
    .select({
      id: systemUsersTable.id,
      passwordHash: systemUsersTable.passwordHash,
      mustChangePassword: systemUsersTable.mustChangePassword,
    })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.username, "admin"));
  return row;
}

function handoffFiles(): string[] {
  return fs.readdirSync(tmpDir).filter((n) => n.startsWith("one-time-passwords-"));
}

function readHandoffOtp(): string {
  const [name] = handoffFiles();
  const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, name), "utf8"));
  const entry = (parsed.accounts as Array<{ username: string; oneTimePassword: string }>).find(
    (a) => a.username === "admin",
  );
  if (!entry) throw new Error("admin entry not found in handoff file");
  return entry.oneTimePassword;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-provision-"));
  vi.stubEnv("ONE_TIME_PASSWORD_DIR", tmpDir);
  saved = await getAdmin();
});

afterEach(async () => {
  // Restore the admin row to its pre-test state.
  await db
    .update(systemUsersTable)
    .set({ passwordHash: saved.passwordHash, mustChangePassword: saved.mustChangePassword })
    .where(eq(systemUsersTable.id, saved.id));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── tests ───────────────────────────────────────────────────────────────────

describe("provisionAdminOtp", () => {
  it("writes an operator-only handoff file, updates the hash, flags must_change_password, revokes sessions, and never logs the OTP", async () => {
    // Plant a session that must be killed by the reset.
    const sid = `test-provision-${Date.now()}`;
    await db.execute(
      sql`INSERT INTO "session" (sid, sess, expire)
          VALUES (${sid}, ${JSON.stringify({ userId: saved.id })}::json, now() + interval '1 hour')`,
    );

    const logged: string[] = [];
    const capture = ((...args: unknown[]) => { logged.push(JSON.stringify(args)); }) as never;
    vi.spyOn(logger, "warn").mockImplementation(capture);
    vi.spyOn(logger, "error").mockImplementation(capture);
    vi.spyOn(logger, "info").mockImplementation(capture);

    try {
      const { filePath, revokedSessions } = await provisionAdminOtp();

      // ── handoff file ──────────────────────────────────────────────────────
      expect(handoffFiles()).toHaveLength(1);
      expect(filePath).toContain(tmpDir);

      // File must be owner-read-only (the writer hardens to 0o400).
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o400);

      const otp = readHandoffOtp();

      // ── DB state ──────────────────────────────────────────────────────────
      const admin = await getAdmin();
      expect(admin.mustChangePassword).toBe(true);
      expect(await bcrypt.compare(otp, admin.passwordHash!)).toBe(true);

      // ── session revocation ────────────────────────────────────────────────
      const sessionRows = await db.execute(sql`SELECT sid FROM "session" WHERE sid = ${sid}`);
      expect((sessionRows as { rows: unknown[] }).rows ?? sessionRows).toHaveLength(0);
      expect(revokedSessions).toBeGreaterThanOrEqual(1);

      // ── audit record ──────────────────────────────────────────────────────
      const auditRows = await db
        .select()
        .from(auditLogsTable)
        .where(sql`${auditLogsTable.action} = 'admin.emergency_password_reset'`)
        .orderBy(desc(auditLogsTable.id))
        .limit(1);

      expect(auditRows).toHaveLength(1);
      const row = auditRows[0];
      expect(row.actorUserId).toBeNull();
      expect(row.entityType).toBe("system_user");
      expect(row.entityId).toBe(saved.id);
      expect(row.entityLabel).toBe("admin");

      const detail = JSON.parse(row.changesJson ?? "{}") as Record<string, unknown>;
      expect(detail.trigger).toBe("reprovision-admin-otp-script");
      expect(detail.source).toBe("OTP_HANDOFF_FILE");
      expect(detail.mustChangePassword).toBe(true);
      expect(typeof detail.revokedSessions).toBe("number");
      // No OTP in audit detail.
      expect(row.changesJson).not.toContain(otp);

      // ── log cleanliness ───────────────────────────────────────────────────
      expect(logged.join("\n")).not.toContain(otp);
    } finally {
      vi.restoreAllMocks();
      await db.execute(sql`DELETE FROM "session" WHERE sid = ${sid}`);
    }
  });

  it("preserves the existing password hash when the handoff-file write fails (write-file-first ordering)", async () => {
    const originalHash = saved.passwordHash;

    // Make writeFileSync throw on the first call (the handoff write).
    // The transaction must roll back before any DB update is attempted.
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("simulated disk-full / permission error");
    });

    await expect(provisionAdminOtp()).rejects.toThrow();

    // Handoff directory must be empty — no partial file left behind.
    expect(handoffFiles()).toHaveLength(0);

    // The admin password hash must be completely unchanged.
    const admin = await getAdmin();
    expect(admin.passwordHash).toBe(originalHash);
  });
});
