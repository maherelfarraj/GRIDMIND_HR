import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, systemUsersTable, rolesTable, auditLogsTable } from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  SetUserPasswordBody,
  getPasswordIssues,
  PASSWORD_REQUIREMENTS_EN,
  PASSWORD_REQUIREMENTS_AR,
} from "@workspace/api-zod";
import { revokeUserSessions } from "../lib/sessionRevocation.js";
import { generateOneTimePassword } from "../lib/oneTimePassword.js";
import {
  loginThrottleReady,
  getLockedUntil,
  clearLockout,
  LOCKOUT_MS,
} from "../lib/loginThrottle.js";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

/**
 * Latest `user.otp_issued` audit event per system user. Surfaces *when* a
 * one-time password was last issued and *by whom* — never the value itself
 * (the OTP is never stored or logged, so it cannot leak from here).
 */
async function getLatestOtpIssuance(userIds: number[]): Promise<Map<number, { at: string; byUserId: number | null; byName: string | null }>> {
  const result = new Map<number, { at: string; byUserId: number | null; byName: string | null }>();
  if (userIds.length === 0) return result;
  const rows = await db.select({
    entityId: auditLogsTable.entityId,
    actorUserId: auditLogsTable.actorUserId,
    createdAt: auditLogsTable.createdAt,
  })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.action, "user.otp_issued"),
      eq(auditLogsTable.entityType, "system_user"),
      inArray(auditLogsTable.entityId, userIds),
    ));
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is number => v !== null))];
  const actors = actorIds.length > 0
    ? await db.select({ id: systemUsersTable.id, fullNameEn: systemUsersTable.fullNameEn })
        .from(systemUsersTable).where(inArray(systemUsersTable.id, actorIds))
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a.fullNameEn]));
  for (const r of rows) {
    if (r.entityId === null) continue;
    const prev = result.get(r.entityId);
    if (!prev || new Date(prev.at).getTime() < r.createdAt.getTime()) {
      result.set(r.entityId, {
        at: r.createdAt.toISOString(),
        byUserId: r.actorUserId,
        byName: r.actorUserId !== null ? (actorMap.get(r.actorUserId) ?? `User #${r.actorUserId}`) : null,
      });
    }
  }
  return result;
}

async function buildUserResponse(u: typeof systemUsersTable.$inferSelect) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, u.roleId));
  const { passwordHash: _passwordHash, ...safe } = u;
  await loginThrottleReady;
  const lockedUntil = getLockedUntil(u.username);
  const otp = (await getLatestOtpIssuance([u.id])).get(u.id);
  return {
    ...safe,
    roleNameEn: role?.nameEn ?? "Unknown",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    lockedUntil: lockedUntil !== null ? new Date(lockedUntil).toISOString() : null,
    lastOtpIssuedAt: otp?.at ?? null,
    lastOtpIssuedByUserId: otp?.byUserId ?? null,
    lastOtpIssuedByName: otp?.byName ?? null,
  };
}

// Roles allowed to administer other users (view the full directory,
// set/reset passwords, issue one-time passwords, unlock accounts).
const USER_ADMIN_ROLES = new Set(["Super Administrator"]);

/**
 * Resolve the acting user and whether they hold a user-admin role.
 * Demo fallback (userId=1) only applies when auth is disabled; with
 * PILOT_AUTH enforced, unauthenticated requests never reach here.
 */
async function getActorAdminStatus(req: { session?: { userId?: number } }) {
  const actorId = req.session?.userId ?? 1;
  const [actor] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, actorId));
  const [role] = actor
    ? await db.select().from(rolesTable).where(eq(rolesTable.id, actor.roleId))
    : [];
  const isAdmin = !!actor && actor.isActive && !!role && USER_ADMIN_ROLES.has(role.nameEn);
  return { actorId, isAdmin };
}

// GET /users — full user directory. Admin-only: client routing is not a
// security boundary, so non-admin sessions must not be able to enumerate
// accounts by calling the API directly (e.g. deep-linking the mobile screen).
router.get("/users", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) {
    res.status(403).json({ error: "Insufficient privileges to list users" });
    return;
  }
  const users = await db.select().from(systemUsersTable);
  const roles = await db.select().from(rolesTable);
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));
  await loginThrottleReady;
  const otpByUser = await getLatestOtpIssuance(users.map((u) => u.id));

  const result = users.map(({ passwordHash: _passwordHash, ...u }) => {
    const lockedUntil = getLockedUntil(u.username);
    const otp = otpByUser.get(u.id);
    return {
      ...u,
      roleNameEn: roleMap[u.roleId]?.nameEn ?? "Unknown",
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
      lockedUntil: lockedUntil !== null ? new Date(lockedUntil).toISOString() : null,
      lastOtpIssuedAt: otp?.at ?? null,
      lastOtpIssuedByUserId: otp?.byUserId ?? null,
      lastOtpIssuedByName: otp?.byName ?? null,
    };
  });
  res.json(result);
});

// POST /users — create a new system user account (Super Administrator only).
router.post("/users", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) {
    res.status(403).json({ error: "Insufficient privileges to create users" });
    return;
  }
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.insert(systemUsersTable).values(parsed.data).returning();
  res.status(201).json(await buildUserResponse(user));
});

// GET /users/:id — self or admin. Non-admin users may read their own record
// (the mobile app uses this to learn its role); other records are admin-only.
router.get("/users/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { actorId, isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin && actorId !== id) {
    res.status(403).json({ error: "Insufficient privileges to view this user" });
    return;
  }
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildUserResponse(user));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  // Admin-only: account fields (email, names, role, active) must not be
  // editable by non-admin sessions calling the API directly.
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) {
    res.status(403).json({ error: "Insufficient privileges to update users" });
    return;
  }
  const id = parseId(req.params.id);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.update(systemUsersTable).set(parsed.data).where(eq(systemUsersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildUserResponse(user));
});

// Roles allowed to set/reset other users' passwords (same admin set).
const PASSWORD_ADMIN_ROLES = USER_ADMIN_ROLES;

// POST /users/:id/password — set or reset a user's password (admins only).
// The plaintext password is hashed server-side with bcrypt; only the hash is stored.
router.post("/users/:id/password", async (req, res): Promise<void> => {
  // Authorization: the acting user (session user; demo fallback userId=1)
  // must hold an admin role. Prevents any authenticated user from taking
  // over other accounts via password reset.
  const actorId = req.session?.userId ?? 1;
  const [actor] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, actorId));
  const [actorRole] = actor
    ? await db.select().from(rolesTable).where(eq(rolesTable.id, actor.roleId))
    : [];
  if (!actor || !actor.isActive || !actorRole || !PASSWORD_ADMIN_ROLES.has(actorRole.nameEn)) {
    res.status(403).json({ error: "Insufficient privileges to set passwords" });
    return;
  }

  const id = parseId(req.params.id);
  const parsed = SetUserPasswordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Shared strong-password policy (same rule as POST /auth/change-password).
  const passwordIssues = getPasswordIssues(parsed.data.password);
  if (passwordIssues.length > 0) {
    res.status(400).json({
      error: passwordIssues.map((i) => i.messageEn).join("; "),
      errorAr: passwordIssues.map((i) => i.messageAr).join("؛ "),
      issues: passwordIssues,
      requirementsEn: PASSWORD_REQUIREMENTS_EN,
      requirementsAr: PASSWORD_REQUIREMENTS_AR,
    });
    return;
  }

  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  // Admin-set passwords are provisional: force the user to pick their own
  // password on next login. Atomic with session revocation: the reset exists
  // precisely because the old credential can no longer be trusted, so all of
  // the target's sessions die with it — or the whole reset rolls back. If an
  // admin resets their own password, their current session survives.
  try {
    await db.transaction(async (tx) => {
      await tx.update(systemUsersTable)
        .set({ passwordHash, mustChangePassword: true })
        .where(eq(systemUsersTable.id, id));
      await revokeUserSessions(tx, id, actorId === id ? req.session?.id : undefined);
    });
  } catch (err) {
    console.error("Password reset failed (rolled back):", err);
    res.status(500).json({ error: "Password reset failed. Please try again." });
    return;
  }

  res.json({ success: true });
});

// POST /users/:id/one-time-password — issue a cryptographically random
// one-time password for a user (admins only).
//
// This is the on-demand replacement for digging credentials out of startup
// provisioning artifacts: an admin generates the OTP here, the plaintext is
// returned exactly once in the response (never stored, never logged), the
// account is flagged must_change_password, and every existing session of the
// target dies atomically with the credential swap. Only the event — not the
// value — is audit-logged.
router.post("/users/:id/one-time-password", async (req, res): Promise<void> => {
  const actorId = req.session?.userId ?? 1;
  const [actor] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, actorId));
  const [actorRole] = actor
    ? await db.select().from(rolesTable).where(eq(rolesTable.id, actor.roleId))
    : [];
  if (!actor || !actor.isActive || !actorRole || !PASSWORD_ADMIN_ROLES.has(actorRole.nameEn)) {
    res.status(403).json({ error: "Insufficient privileges to issue one-time passwords" });
    return;
  }

  const id = parseId(req.params.id);
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  const oneTimePassword = generateOneTimePassword();
  const passwordHash = await bcrypt.hash(oneTimePassword, 10);

  // Atomic: credential swap + session revocation + audit event commit (or
  // roll back) together. The audit row records that an OTP was issued and by
  // whom — never the password itself.
  try {
    await db.transaction(async (tx) => {
      await tx.update(systemUsersTable)
        .set({ passwordHash, mustChangePassword: true })
        .where(eq(systemUsersTable.id, id));
      await revokeUserSessions(tx, id, actorId === id ? req.session?.id : undefined);
      await tx.insert(auditLogsTable).values({
        action: "user.otp_issued",
        entityType: "system_user",
        entityId: user.id,
        entityLabel: user.username,
        actorUserId: actorId,
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        changesJson: JSON.stringify({ mustChangePassword: true, sessionsRevoked: true }),
      });
    });
  } catch (err) {
    console.error("One-time password issuance failed (rolled back):", err);
    res.status(500).json({ error: "Could not issue a one-time password. Please try again." });
    return;
  }

  res.json({ oneTimePassword, username: user.username, mustChangePassword: true });
});

// POST /users/:id/unlock — clear a login lockout immediately (admins only).
// Clears the account's throttle key plus the source-IP keys seen in recent
// failed-login audit entries for that username, so a victim locked out by an
// attacker (or their own typos) can sign in right away.
router.post("/users/:id/unlock", async (req, res): Promise<void> => {
  const actorId = req.session?.userId ?? 1;
  const [actor] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, actorId));
  const [actorRole] = actor
    ? await db.select().from(rolesTable).where(eq(rolesTable.id, actor.roleId))
    : [];
  if (!actor || !actor.isActive || !actorRole || !PASSWORD_ADMIN_ROLES.has(actorRole.nameEn)) {
    res.status(403).json({ error: "Insufficient privileges to unlock accounts" });
    return;
  }

  const id = parseId(req.params.id);
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  await loginThrottleReady;

  // Source IPs that contributed to this lockout: recent failed-login audit
  // entries for the username within the current lockout window.
  const since = new Date(Date.now() - LOCKOUT_MS);
  const recentFailures = await db.select({ ipAddress: auditLogsTable.ipAddress })
    .from(auditLogsTable)
    .where(and(
      inArray(auditLogsTable.action, ["login.failed", "login.lockout"]),
      eq(auditLogsTable.entityLabel, user.username),
      gte(auditLogsTable.createdAt, since),
    ));
  const ips = [...new Set(recentFailures.map((r) => r.ipAddress).filter((ip): ip is string => !!ip))];

  const clearedKeys = clearLockout(user.username, ips);

  try {
    await db.insert(auditLogsTable).values({
      action: "user.unlock",
      entityType: "system_user",
      entityId: user.id,
      entityLabel: user.username,
      actorUserId: actorId,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      changesJson: JSON.stringify({ clearedKeys, clearedIps: ips }),
    });
  } catch (err) {
    console.error("Failed to write unlock audit entry:", err);
  }

  res.json({ success: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  // Placeholder: returns first active admin user. Replace with Keycloak/LDAP in production.
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.isActive, true)).limit(1);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json(await buildUserResponse(user));
});

export default router;
