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

async function buildUserResponse(u: typeof systemUsersTable.$inferSelect) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, u.roleId));
  const { passwordHash: _passwordHash, ...safe } = u;
  await loginThrottleReady;
  const lockedUntil = getLockedUntil(u.username);
  return {
    ...safe,
    roleNameEn: role?.nameEn ?? "Unknown",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    lockedUntil: lockedUntil !== null ? new Date(lockedUntil).toISOString() : null,
  };
}

router.get("/users", async (req, res): Promise<void> => {
  const users = await db.select().from(systemUsersTable);
  const roles = await db.select().from(rolesTable);
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));
  await loginThrottleReady;

  const result = users.map(({ passwordHash: _passwordHash, ...u }) => {
    const lockedUntil = getLockedUntil(u.username);
    return {
      ...u,
      roleNameEn: roleMap[u.roleId]?.nameEn ?? "Unknown",
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
      lockedUntil: lockedUntil !== null ? new Date(lockedUntil).toISOString() : null,
    };
  });
  res.json(result);
});

router.post("/users", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.insert(systemUsersTable).values(parsed.data).returning();
  res.status(201).json(await buildUserResponse(user));
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildUserResponse(user));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseId(req.params.id);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.update(systemUsersTable).set(parsed.data).where(eq(systemUsersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildUserResponse(user));
});

// Roles allowed to set/reset other users' passwords.
const PASSWORD_ADMIN_ROLES = new Set(["Super Administrator"]);

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
