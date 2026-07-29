import { Router } from "express";
import { db, systemUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// POST /auth/login — mock auth: match by username, any password accepted (demo)
router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body;
  if (!username) { res.status(400).json({ error: "username required" }); return; }

  const [user] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.username, username));

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Account inactive" });
    return;
  }

  // Update last login
  await db.update(systemUsersTable).set({ lastLoginAt: new Date() }).where(eq(systemUsersTable.id, user.id));

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    fullNameEn: user.fullNameEn,
    fullNameAr: user.fullNameAr,
    roleId: user.roleId,
    employeeId: user.employeeId,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    preferredLanguage: user.preferredLanguage,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  });
});

// POST /auth/logout — clears session token (no-op in demo)
router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

// GET /auth/me — returns session user (first active user as session placeholder)
router.get("/auth/me", async (_req, res): Promise<void> => {
  const [user] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.isActive, true));
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    fullNameEn: user.fullNameEn,
    fullNameAr: user.fullNameAr,
    roleId: user.roleId,
    employeeId: user.employeeId,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    preferredLanguage: user.preferredLanguage,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  });
});

export default router;
