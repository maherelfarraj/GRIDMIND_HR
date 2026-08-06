import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, systemUsersTable, rolesTable, auditLogsTable, notificationsTable, notificationPreferencesTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import {
  ChangeMyPasswordBody,
  getPasswordIssues,
  PASSWORD_REQUIREMENTS_EN,
  PASSWORD_REQUIREMENTS_AR,
} from "@workspace/api-zod";
import { isLockedOut, recordFailure, recordSuccess, LOCKOUT_MS, loginThrottleReady } from "../lib/loginThrottle";
import { sendSmtpMail } from "../lib/smtp-adapter.js";
import { recordSecurityEmailOutcome } from "../lib/email-alert-status.js";

import { isAuthEnforced } from "../lib/authMode.js";
import { revokeUserSessions } from "../lib/sessionRevocation.js";
import { getUserHomeOrgId } from "../lib/orgContext.js";

const router = Router();

// Notify all active admins the moment a lockout fires so they can react to
// an active brute-force attempt in real time. Best-effort: failures are
// logged and never block the auth response path.
async function notifyAdminsOfLockout(username: string, ip: string, scope: string): Promise<void> {
  try {
    const admins = await db
      .select({
        id: systemUsersTable.id,
        email: systemUsersTable.email,
        securityAlertChannel: notificationPreferencesTable.securityAlertChannel,
      })
      .from(systemUsersTable)
      .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
      .leftJoin(notificationPreferencesTable, eq(notificationPreferencesTable.userId, systemUsersTable.id))
      .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
    if (admins.length === 0) return;

    // Per-admin channel preference for security alerts: "in_app" | "email" |
    // "both". Admins without a preference row — or with an unrecognized
    // value — default to "both", preserving the original behavior.
    const channelFor = (pref: string | null): "in_app" | "email" | "both" =>
      pref === "in_app" || pref === "email" ? pref : "both";
    const inAppAdmins = admins.filter((a) => channelFor(a.securityAlertChannel) !== "email");
    const emailAdmins = admins.filter((a) => channelFor(a.securityAlertChannel) !== "in_app");

    if (inAppAdmins.length > 0) await db.insert(notificationsTable).values(inAppAdmins.map(({ id }) => ({
      recipientUserId: id,
      notificationType: "security_alert",
      titleEn: `Account lockout: ${username}`,
      titleAr: `قفل الحساب: ${username}`,
      bodyEn: `Repeated failed login attempts triggered a temporary lockout (scope: ${scope}) for account "${username}" from IP ${ip}. Review the audit trail and consider resetting the password or disabling the account.`,
      bodyAr: `أدت محاولات تسجيل الدخول الفاشلة المتكررة إلى قفل مؤقت (النطاق: ${scope}) للحساب "${username}" من عنوان IP ‏${ip}. راجع سجل التدقيق وفكر في إعادة تعيين كلمة المرور أو تعطيل الحساب.`,
      severity: "urgent",
      // Deep-link straight to the System Users page with the locked account
      // highlighted, so the admin can verify and unlock in one click.
      actionUrl: `/users?highlight=${encodeURIComponent(username)}`,
      actionLabelEn: "Review & unlock account",
      entityType: "auth",
      requiresAction: true,
    })));

    // Also email the alert so it isn't missed when no admin is logged in.
    // Fire-and-forget: SMTP latency or failure must never delay or block
    // the login response; failures are logged only.
    const recipients = emailAdmins.map((a) => a.email).filter((e): e is string => !!e);
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
        .then(async (result) => {
          if (!result.success) {
            console.error("Failed to send lockout alert email:", result.message);
          }
          // Surface delivery failures in-app (deduped per outage window) so
          // admins know security emails are being dropped — server logs alone
          // are not enough. Success closes the outage window.
          await recordSecurityEmailOutcome(
            { success: result.success, message: result.message },
            `account lockout alert for "${username}"`,
          );
        })
        .catch(async (err) => {
          console.error("Failed to send lockout alert email:", err);
          await recordSecurityEmailOutcome(
            { success: false, message: err?.message ?? String(err) },
            `account lockout alert for "${username}"`,
          );
        });
    }
  } catch (err) {
    console.error("Failed to create lockout notifications:", err);
  }
}

function parseRolePermissions(permissionsJson: string | null | undefined): string[] {
  if (!permissionsJson) return [];
  try {
    const parsed = JSON.parse(permissionsJson);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
async function userResponse(user: typeof systemUsersTable.$inferSelect) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
  // Home org: prefer the direct org_id column, fall back to default.
  const homeOrgId = user.orgId ?? await getUserHomeOrgId(user.id);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullNameEn: user.fullNameEn,
    fullNameAr: user.fullNameAr,
    roleId: user.roleId,
    employeeId: user.employeeId,
    orgId: homeOrgId,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    preferredLanguage: user.preferredLanguage,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    mustChangePassword: user.mustChangePassword,
    permissions: parseRolePermissions(role?.permissionsJson),
    canSwitchOrg: role?.systemRole === true,
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
  if (isAuthEnforced()) {
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

  // Bearer-token transport (mobile): the client explicitly opts in via the
  // x-session-transport header and receives the session id as a token to
  // store in SecureStore and send as `Authorization: Bearer <token>`.
  // Web clients never receive the token — their session stays in the
  // httpOnly cookie only. Save explicitly so the session row exists before
  // the client's next (token-authenticated) request.
  if (req.get("x-session-transport") === "bearer") {
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    res.json({ ...(await userResponse(user)), sessionToken: req.session.id });
    return;
  }

  res.json(await userResponse(user));
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
  // Atomic: the password change and the revocation of every OTHER session
  // for this user commit together — a stolen credential's sessions die with
  // the old password. If revocation fails, the password update rolls back
  // and the request fails rather than reporting success with live sessions.
  // The caller's own session (the one performing the change) stays alive.
  try {
    await db.transaction(async (tx) => {
      await tx.update(systemUsersTable)
        .set({ passwordHash, mustChangePassword: false })
        .where(eq(systemUsersTable.id, user.id));
      await revokeUserSessions(tx, user.id, req.session.id);
    });
  } catch (err) {
    console.error("Password change failed (rolled back):", err);
    res.status(500).json({ error: "Password change failed. Please try again." });
    return;
  }

  const [updated] = await db.select().from(systemUsersTable)
    .where(eq(systemUsersTable.id, user.id));
  res.json({ ...(await userResponse(updated)), success: true });
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
      res.json(await userResponse(user));
      return;
    }
    // Session user not found or inactive — destroy session
    req.session.destroy(() => {});
  }

  if (!isAuthEnforced()) {
    // Demo fallback: return first active user
    const [user] = await db.select().from(systemUsersTable)
      .where(eq(systemUsersTable.isActive, true));
    if (!user) { res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" }); return; }
    res.json(await userResponse(user));
    return;
  }

  res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" });
});

export default router;
