import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ChangeMyPasswordBody } from "@workspace/api-zod";

const router = Router();

const PILOT_AUTH = process.env.PILOT_AUTH === "true";

function userResponse(user: typeof systemUsersTable.$inferSelect) {
  return {
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
    mustChangePassword: user.mustChangePassword,
  };
}

// POST /auth/login — find user by username; demo mode accepts any password;
// PILOT_AUTH mode requires bcrypt match if passwordHash is set
router.post("/auth/login", async (req, res): Promise<void> => {
  const { username } = req.body;
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

  // Password check — PILOT_AUTH mode is fail-closed: a password AND a stored
  // hash are both required, and the bcrypt comparison must succeed.
  if (PILOT_AUTH) {
    const { password } = req.body;
    const userWithHash = user as typeof user & { passwordHash?: string | null };
    if (!password || !userWithHash.passwordHash) {
      // No password supplied, or account has no hash provisioned → reject.
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, userWithHash.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
  }
  // Demo mode (PILOT_AUTH=false): accept any password, no check

  // Look up role name for session
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
  const userRole = role?.nameEn ?? "User";

  // Update last login
  await db.update(systemUsersTable).set({ lastLoginAt: new Date() }).where(eq(systemUsersTable.id, user.id));

  // Set session
  req.session.userId = user.id;
  req.session.userRole = userRole;
  req.session.username = user.username;

  res.json(userResponse(user));
});

// POST /auth/change-password — authenticated user changes their own password.
// Used by the mandatory first-login change flow: verifies the current
// password, stores the new hash, and clears must_change_password.
router.post("/auth/change-password", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [user] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Verify the current password when a hash exists (fail-closed: if a hash
  // is stored, it must match, regardless of PILOT_AUTH mode).
  if (user.passwordHash) {
    if (typeof currentPassword !== "string" ||
        !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    if (newPassword === currentPassword) {
      res.status(400).json({ error: "New password must be different from the current password" });
      return;
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(systemUsersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(systemUsersTable.id, user.id));

  const [updated] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.id, user.id));
  res.json(userResponse(updated));
});

// POST /auth/logout — destroys session, clears cookie
router.post("/auth/logout", (req, res): void => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Logout failed" });
      return;
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// POST /auth/change-password — signed-in user changes their own password.
// Requires the current password to match the stored bcrypt hash (fail-closed:
// accounts without a stored hash cannot self-change until an admin provisions one).
router.post("/auth/change-password", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = ChangeMyPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "newPassword must be at least 8 characters and currentPassword is required" });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  const [user] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.id, userId));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const userWithHash = user as typeof user & { passwordHash?: string | null };
  if (!userWithHash.passwordHash) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  const valid = await bcrypt.compare(currentPassword, userWithHash.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(systemUsersTable).set({ passwordHash }).where(eq(systemUsersTable.id, user.id));
  res.json({ success: true });
});

// GET /auth/me — return current session user; demo fallback to first active user
router.get("/auth/me", async (req, res): Promise<void> => {
  if (req.session?.userId) {
    const [user] = await db.select().from(systemUsersTable)
      .where(eq(systemUsersTable.id, req.session.userId));
    if (user && user.isActive) {
      res.json(userResponse(user));
      return;
    }
    // Session user not found or inactive — destroy session
    req.session.destroy(() => {});
  }

  if (!PILOT_AUTH) {
    // Demo fallback: return first active user
    const [user] = await db.select().from(systemUsersTable)
      .where(eq(systemUsersTable.isActive, true));
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    res.json(userResponse(user));
    return;
  }

  res.status(401).json({ error: "Not authenticated" });
});

export default router;
