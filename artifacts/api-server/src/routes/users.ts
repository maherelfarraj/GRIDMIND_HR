import { Router } from "express";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildUserResponse(u: typeof systemUsersTable.$inferSelect) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, u.roleId));
  return {
    ...u,
    roleNameEn: role?.nameEn ?? "Unknown",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/users", async (req, res): Promise<void> => {
  const users = await db.select().from(systemUsersTable);
  const roles = await db.select().from(rolesTable);
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));

  const result = users.map((u) => ({
    ...u,
    roleNameEn: roleMap[u.roleId]?.nameEn ?? "Unknown",
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));
  res.json(result);
});

router.post("/users", async (req, res): Promise<void> => {
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
  const id = parseId(req.params.id);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.update(systemUsersTable).set(parsed.data).where(eq(systemUsersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildUserResponse(user));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  // Placeholder: returns first active admin user. Replace with Keycloak/LDAP in production.
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.isActive, true)).limit(1);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json(await buildUserResponse(user));
});

export default router;
