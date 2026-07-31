import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, systemUsersTable, rolesTable, auditLogsTable, notificationsTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import {
  ChangeMyPasswordBody,
  getPasswordIssues,
  PASSWORD_REQUIREMENTS_EN,
  PASSWORD_REQUIREMENTS_AR,
} from "@workspace/api-zod";
import { isLockedOut, recordFailure, recordSuccess, LOCKOUT_MS, loginThrottleReady } from "../lib/loginThrottle";
import { sendSmtpMail } from "../lib/smtp-adapter.js";

const router = Router();

const PILOT_AUTH = process.env.PILOT_AUTH === "true";

// Notify all active admins the moment a lockout fires so they can react to
// an active brute-force attempt in real time. Best-effort: failures are
// logged and never block the auth response path.
async function notifyAdminsOfLockout(username: string, ip: string, scope: string): Promise<void> {
  try {
    const admins = await db
      .select({ id: systemUsersTable.id, email: systemUsersTable.email })
      .from(systemUsersTable)
      .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
      .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
    if (admins.length === 0) return;
    await db.insert(notificationsTable).values(admins.map(({ id }) => ({
      recipientUserId: id,
      notificationType: "security_alert",
      titleEn: `Account lockout: ${username}`,
      titleAr: `قفل الحساب: ${username}`,
      bodyEn: `Repeated failed login attempts triggered a temporary lockout (scope: ${scope}) for account "${username}" from IP ${ip}. Review the audit trail and consider resetting the password or disabling the account.`,
      bodyAr: `أدت محاولات تسجيل الدخول الفاشلة المتكررة إلى قفل مؤقت (النطاق: ${scope}) للحساب "${username}" من عنوان IP ‏${ip}. راجع سجل التدقيق وفكر في إعادة تعيين كلمة المرور أو تعطيل الحساب.`,
      severity: "urgent",
      actionUrl: "/audit",
      actionLabelEn: "View audit trail",
      entityType: "auth",
      requiresAction: true,
    })));

    // Also email the alert so it isn't missed when no admin is logged in.
    // Fire-and-forget: SMTP latency or failure must never delay or block
    // the login response; failures are logged only.
    const recipients = admins.map((a) => a.email).filter((e): e is string => !!e);
    if (recipients.length > 0) {
      void sendSmtpMail({
        to: recipients,
        subject: `[HRMS security] Account lockout: ${username}`,
        text:
          `Repeated failed login attempts triggered a temporary lockout for account "${username}".\n\n` +
          `Account: ${username}\n` +
          `Source IP: ${ip}\n` +
          `Lockout scope: ${scope}\n` +
          `Time: ${new Date().toISOString()}\n\n` +
          `Review the audit trail and consider resetting the password or disabling the account.`,
      })
        .then((result) => {
          if (!result.success) {
            console.error("Failed to send lockout alert email:", result.message);
          }
        })
        .catch((err) => {
          console.error("Failed to send lockout alert email:", err);
        });
    }
  } catch (err) {
    console.error("Failed to create lockout notifications:", err);
  }
}

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

  const ip = req.ip ?? "unknown";
  const userAgent = req.get("user-agent") ?? null;

  // Brute-force protection: temporary lockout after repeated failures for
  // the same account or source IP. Checked before any credential work so a
  // locked-out attacker learns nothing about the account.
  // Wait for persisted lockout state to be hydrated (a no-op after the
  // first request), so lockouts apply from the very first attempt after a
  // server restart.
  await loginThrottleReady;
  const lock = isLockedOut(username, ip);
  if (lock.locked) {
    const retryAfterSeconds = Math.ceil(lock.retryAfterMs / 1000);
    res.status(429)
      .set("Retry-After", String(retryAfterSeconds))
      .json({
        error: "Too many failed login attempts. Please try again later.",
        errorAr: "عدد كبير جدًا من محاولات تسجيل الدخول الفاشلة. يرجى المحاولة مرة أخرى لاحقًا.",
        retryAfterSeconds,
      });
    return;
  }

  // Audit trail: record failed attempts and lockout triggers so admins can
  // spot brute-force activity. Never logs the submitted password.
  const failLogin = async (knownUserId: number | null): Promise<void> => {
    const { accountLockedNow, ipLockedNow } = recordFailure(username, ip);
    const entries: (typeof auditLogsTable.$inferInsert)[] = [{
      action: "login.failed",
      entityType: "auth",
      entityLabel: username,
      actorUserId: knownUserId,
      ipAddress: ip,
      userAgent,
    }];
    const lockScope = accountLockedNow && ipLockedNow ? "account+ip"
      : accountLockedNow ? "account" : "ip";
    if (accountLockedNow || ipLockedNow) {
      entries.push({
        action: "login.lockout",
        entityType: "auth",
        entityLabel: username,
        actorUserId: knownUserId,
        ipAddress: ip,
        userAgent,
        changesJson: JSON.stringify({
          scope: lockScope,
          lockoutMs: LOCKOUT_MS,
        }),
      });
    }
    try {
      await db.insert(auditLogsTable).values(entries);
    } catch (err) {
      // Auditing must not block the auth response path.
      console.error("Failed to write login audit entry:", err);
    }
    if (accountLockedNow || ipLockedNow) {
      await notifyAdminsOfLockout(username, ip, lockScope);
    }
    res.status(401).json({ error: "Invalid credentials" });
  };

  const [user] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.username, username));

  if (!user) {
    await failLogin(null);
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
      await failLogin(user.id);
      return;
    }
    const valid = await bcrypt.compare(password, userWithHash.passwordHash);
    if (!valid) {
      await failLogin(user.id);
      return;
    }
  }
  // Demo mode (PILOT_AUTH=false): accept any password, no check

  // Successful login clears the failure counters.
  recordSuccess(username, ip);

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
// Used by both the mandatory first-login change flow and voluntary
// self-service changes: verifies the current password against the stored
// bcrypt hash (fail-closed: accounts without a stored hash cannot
// self-change until an admin provisions one), enforces the shared strong-
// password policy, stores the new hash, and clears must_change_password.
router.post("/auth/change-password", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const parsedBody = ChangeMyPasswordBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "newPassword must be at least 8 characters and currentPassword is required" });
    return;
  }
  const { currentPassword, newPassword } = parsedBody.data;
  const passwordIssues = getPasswordIssues(newPassword);
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

  const [user] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Verify the current password (fail-closed: without a stored hash the
  // account cannot self-change; the stored hash must match regardless of
  // PILOT_AUTH mode).
  if (!user.passwordHash ||
      !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ error: "New password must be different from the current password" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(systemUsersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(systemUsersTable.id, user.id));

  const [updated] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.id, user.id));
  res.json({ ...userResponse(updated), success: true });
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
