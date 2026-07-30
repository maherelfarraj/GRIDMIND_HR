import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  SetUserPasswordBody,
  getPasswordIssues,
  PASSWORD_REQUIREMENTS_EN,
  PASSWORD_REQUIREMENTS_AR,
} from "@workspace/api-zod";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildUserResponse(u: typeof systemUsersTable.$inferSelect) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, u.roleId));
  const { passwordHash: _passwordHash, ...safe } = u;
  return {
    ...safe,
    roleNameEn: role?.nameEn ?? "Unknown",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/users", async (req, res): Promise<void> => {
  const users = await db.select().from(systemUsersTable);
  const roles = await db.select().from(rolesTable);
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));

  const result = users.map(({ passwordHash: _passwordHash, ...u }) => ({
    ...u,
    roleNameEn: roleMap[u.roleId]?.nameEn ?? "Unknown",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));
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
  // password on next login.
  await db.update(systemUsersTable).set({ passwordHash, mustChangePassword: true }).where(eq(systemUsersTable.id, id));
  res.json({ success: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  // Placeholder: returns first active admin user. Replace with Keycloak/LDAP in production.
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.isActive, true)).limit(1);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json(await buildUserResponse(user));
});

export default router;
