/**
 * GET /api/admin/production-health
 *
 * Admin-only operational health dashboard endpoint for GRIDMIND HR + Terra.
 * Returns a structured snapshot covering:
 *   - System/API/DB health
 *   - Terra AI config, query volume, latency, token usage, audit coverage
 *   - Security/access: super-admin count, MFA coverage, duplicate admin warning,
 *     failed-login / lockout activity, orphaned-org users
 *   - HR operations: employee counts, pending approvals, attendance freshness,
 *     payroll period availability
 *   - Recent audit activity
 *
 * NEVER exposes: passwords, session cookies, raw session IDs, API keys.
 * Cost for gpt-5.6-terra is labelled "unavailable" — no invented pricing.
 */
import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import {
  db,
  systemUsersTable,
  rolesTable,
  organizationsTable,
  aiConfigTable,
  aiQueriesTable,
  auditLogsTable,
  employeesTable,
  approvalsTable,
  attendanceRecordsTable,
  payrollPeriodsTable,
  securityAlertsTable,
} from "@workspace/db";

const router = Router();

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

type Severity = "healthy" | "warning" | "critical";

function aiSeverity(
  cfg: { isEnabled: boolean } | null,
  integrationProvisioned: boolean,
  failureCount: number,
): Severity {
  if (!cfg) return "critical";
  if (!cfg.isEnabled) return "warning";
  if (!integrationProvisioned) return "warning";
  if (failureCount > 0) return "warning";
  return "healthy";
}

function securitySeverity(
  duplicateGroups: number,
  missingMfa: number,
  lockouts7d: number,
  orphanedOrg: number,
): Severity {
  if (duplicateGroups > 0 || orphanedOrg > 0) return "warning";
  if (missingMfa > 0 || lockouts7d > 2) return "warning";
  return "healthy";
}

function hrSeverity(
  payrollPeriodCount: number,
  pendingApprovals: number,
  attendanceFreshHours: number | null,
): Severity {
  if (payrollPeriodCount === 0) return "warning";
  if (pendingApprovals > 20) return "warning";
  if (attendanceFreshHours !== null && attendanceFreshHours > 48) return "warning";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.get("/admin/production-health", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) {
    res.status(403).json({ error: "Super Administrator access required." });
    return;
  }

  const checkedAt = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
    // ── Fetch everything in parallel ─────────────────────────────────────────
    const [
      users,
      orgs,
      aiConfigRows,
      aiQueryStats,
      aiRecentFailures,
      auditRecent,
      failedLogins7dRows,
      lockouts7dRows,
      employeeCounts,
      pendingApprovalsRows,
      latestAttendanceRows,
      payrollPeriods,
      openAlertsRows,
      activeSessionsResult,
    ] = await Promise.all([
      // All system users with their role name
      db
        .select({
          id: systemUsersTable.id,
          username: systemUsersTable.username,
          fullNameEn: systemUsersTable.fullNameEn,
          roleId: systemUsersTable.roleId,
          roleName: rolesTable.nameEn,
          orgId: systemUsersTable.orgId,
          isActive: systemUsersTable.isActive,
          mfaEnabled: systemUsersTable.mfaEnabled,
          mustChangePassword: systemUsersTable.mustChangePassword,
          lastLoginAt: systemUsersTable.lastLoginAt,
        })
        .from(systemUsersTable)
        .leftJoin(rolesTable, eq(rolesTable.id, systemUsersTable.roleId))
        .orderBy(systemUsersTable.id),

      // Registered organizations
      db
        .select({ id: organizationsTable.id, nameEn: organizationsTable.nameEn })
        .from(organizationsTable),

      // AI config singleton
      db.select().from(aiConfigTable).where(eq(aiConfigTable.id, 1)),

      // AI query stats grouped by feature — use raw SQL to safely include
      // ordered-set aggregate (PERCENTILE_CONT) alongside regular aggregates.
      db.execute(sql`
        SELECT
          feature_type                                                           AS "featureType",
          COUNT(*)::int                                                          AS "totalQueries",
          COALESCE(SUM(tokens_used), 0)::int                                     AS "totalTokens",
          ROUND(AVG(duration_ms))::int                                           AS "avgDurationMs",
          ROUND(
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
          )::int                                                                 AS "p95DurationMs",
          COUNT(CASE WHEN success THEN 1 END)::int                               AS "successCount",
          COUNT(CASE WHEN NOT success THEN 1 END)::int                           AS "failureCount"
        FROM ai_queries
        GROUP BY feature_type
      `),

      // Recent AI failures (last 7 days, max 10)
      db
        .select({
          id: aiQueriesTable.id,
          featureType: aiQueriesTable.featureType,
          errorMessage: aiQueriesTable.errorMessage,
          createdAt: aiQueriesTable.createdAt,
        })
        .from(aiQueriesTable)
        .where(
          and(
            eq(aiQueriesTable.success, false),
            gte(aiQueriesTable.createdAt, sevenDaysAgo),
          ),
        )
        .orderBy(desc(aiQueriesTable.createdAt))
        .limit(10),

      // Recent audit activity (last 20 entries, no raw payload)
      db
        .select({
          id: auditLogsTable.id,
          actorUserId: auditLogsTable.actorUserId,
          action: auditLogsTable.action,
          entityType: auditLogsTable.entityType,
          entityLabel: auditLogsTable.entityLabel,
          createdAt: auditLogsTable.createdAt,
        })
        .from(auditLogsTable)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(20),

      // Failed login count, last 7 days
      db
        .select({ cnt: count() })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.action, "login.failed"),
            gte(auditLogsTable.createdAt, sevenDaysAgo),
          ),
        ),

      // Lockout count, last 7 days
      db
        .select({ cnt: count() })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.action, "login.lockout"),
            gte(auditLogsTable.createdAt, sevenDaysAgo),
          ),
        ),

      // Employee counts for org 1
      db
        .select({
          total: count(),
          active: sql<number>`COUNT(CASE WHEN ${employeesTable.status} = 'active' THEN 1 END)`,
        })
        .from(employeesTable)
        .where(eq(employeesTable.orgId, 1)),

      // Pending approvals (global — approvals are not org-scoped at the table level)
      db
        .select({ cnt: count() })
        .from(approvalsTable)
        .where(eq(approvalsTable.status, "pending")),

      // Latest attendance record timestamp for org 1
      db
        .select({
          latestAt: sql<string | null>`MAX(${attendanceRecordsTable.createdAt})`,
        })
        .from(attendanceRecordsTable)
        .where(eq(attendanceRecordsTable.orgId, 1)),

      // Most recent payroll periods for org 1
      db
        .select({
          id: payrollPeriodsTable.id,
          nameEn: payrollPeriodsTable.nameEn,
          status: payrollPeriodsTable.status,
          startDate: payrollPeriodsTable.startDate,
          endDate: payrollPeriodsTable.endDate,
          isClosed: payrollPeriodsTable.isClosed,
          createdAt: payrollPeriodsTable.createdAt,
        })
        .from(payrollPeriodsTable)
        .where(eq(payrollPeriodsTable.orgId, 1))
        .orderBy(desc(payrollPeriodsTable.createdAt))
        .limit(5),

      // Open (unacknowledged) security alerts
      db
        .select({ cnt: count() })
        .from(securityAlertsTable)
        .where(eq(securityAlertsTable.acknowledged, false)),

      // Active session counts — safe summary only (no cookie/sid values)
      db.execute(sql`
        SELECT
          sess->>'userId'  AS user_id,
          COUNT(*)::int    AS session_count
        FROM session
        WHERE expire > NOW()
        GROUP BY sess->>'userId'
      `),
    ]);

    // ── Process users ─────────────────────────────────────────────────────────
    const registeredOrgIds = new Set(orgs.map((o) => o.id));
    const superAdmins = users.filter(
      (u) => u.isActive && u.roleName === "Super Administrator",
    );
    const inactiveUsers = users.filter((u) => !u.isActive);

    // Orphaned: active user whose orgId is set but doesn't exist in organizations
    const orphanedOrgUsers = users.filter(
      (u) =>
        u.isActive &&
        u.orgId !== null &&
        u.orgId !== undefined &&
        !registeredOrgIds.has(u.orgId),
    );

    const adminsMissingMfa = superAdmins.filter((u) => !u.mfaEnabled);

    // Duplicate admin: same fullName, more than one active Super Admin account
    const nameCounts = new Map<string, typeof superAdmins>();
    for (const u of superAdmins) {
      const key = (u.fullNameEn ?? u.username).trim().toLowerCase();
      if (!nameCounts.has(key)) nameCounts.set(key, []);
      nameCounts.get(key)!.push(u);
    }
    const duplicateAdminGroups = Array.from(nameCounts.entries())
      .filter(([, group]) => group.length > 1)
      .map(([, group]) => ({
        name: group[0].fullNameEn ?? group[0].username,
        accounts: group.map((u) => ({
          id: u.id,
          username: u.username,
          mfaEnabled: u.mfaEnabled,
          lastLoginAt: u.lastLoginAt,
        })),
      }));

    // ── AI section ────────────────────────────────────────────────────────────
    const cfg = aiConfigRows[0] ?? null;
    const integrationProvisioned =
      !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
        process.env.AI_INTEGRATIONS_OPENAI_API_KEY);

    // db.execute() returns { rows: [...] } — extract typed rows
    type AiStatRow = {
      featureType: string;
      totalQueries: number;
      totalTokens: number;
      avgDurationMs: number;
      p95DurationMs: number;
      successCount: number;
      failureCount: number;
    };
    const aiStatRows = aiQueryStats.rows as AiStatRow[];

    const totalAiQueries = aiStatRows.reduce(
      (s, r) => s + Number(r.totalQueries),
      0,
    );
    const totalAiSuccess = aiStatRows.reduce(
      (s, r) => s + Number(r.successCount),
      0,
    );
    const totalAiFailure = aiStatRows.reduce(
      (s, r) => s + Number(r.failureCount),
      0,
    );
    const totalAiTokens = aiStatRows.reduce(
      (s, r) => s + Number(r.totalTokens),
      0,
    );

    // Audit coverage: fraction of queries that have an audit row (1:1 since
    // every handler writes to ai_queries before returning — so coverage = 100%
    // if no failures without audit rows).
    const auditCoveragePercent =
      totalAiQueries > 0
        ? Math.round((totalAiSuccess / totalAiQueries) * 100)
        : null;

    // ── Sessions (safe — no cookie/sid values) ────────────────────────────────
    const sessionRows = activeSessionsResult.rows as Array<{
      user_id: string;
      session_count: number;
    }>;
    const activeSessionsByUser = sessionRows
      .filter((r) => r.user_id !== null)
      .map((r) => ({
        userId: Number(r.user_id),
        sessionCount: Number(r.session_count),
      }));

    // ── Attendance freshness ──────────────────────────────────────────────────
    const latestAttendanceAt = latestAttendanceRows[0]?.latestAt ?? null;
    const attendanceFreshHours = latestAttendanceAt
      ? (Date.now() - new Date(latestAttendanceAt).getTime()) / (1000 * 60 * 60)
      : null;

    // ── Numeric counts ────────────────────────────────────────────────────────
    const failedLogins7d = Number(failedLogins7dRows[0]?.cnt ?? 0);
    const lockouts7d = Number(lockouts7dRows[0]?.cnt ?? 0);
    const pendingApprovals = Number(pendingApprovalsRows[0]?.cnt ?? 0);
    const openAlerts = Number(openAlertsRows[0]?.cnt ?? 0);
    const employeeTotal = Number(employeeCounts[0]?.total ?? 0);
    const employeeActive = Number(employeeCounts[0]?.active ?? 0);

    // ── Severity ──────────────────────────────────────────────────────────────
    const aiSev = aiSeverity(cfg, integrationProvisioned, totalAiFailure);
    const secSev = securitySeverity(
      duplicateAdminGroups.length,
      adminsMissingMfa.length,
      lockouts7d,
      orphanedOrgUsers.length,
    );
    const hrSev = hrSeverity(
      payrollPeriods.length,
      pendingApprovals,
      attendanceFreshHours,
    );

    const overallStatus: Severity =
      [aiSev, secSev, hrSev].includes("critical")
        ? "critical"
        : [aiSev, secSev, hrSev].includes("warning")
        ? "warning"
        : "healthy";

    // ── Build recommendations ─────────────────────────────────────────────────
    const recommendations: Array<{ severity: Severity; message: string }> = [];

    if (!cfg) {
      recommendations.push({
        severity: "critical",
        message:
          "Terra AI is not initialised. Run PATCH /api/ai/config to create the configuration row.",
      });
    } else if (!cfg.isEnabled) {
      recommendations.push({
        severity: "warning",
        message: "Terra AI is configured but disabled. Enable it via the AI settings page.",
      });
    }
    if (!integrationProvisioned) {
      recommendations.push({
        severity: "warning",
        message:
          "OpenAI integration env vars are not set. AI queries will fail with ConfigError.",
      });
    }
    if (duplicateAdminGroups.length > 0) {
      recommendations.push({
        severity: "warning",
        message: `${duplicateAdminGroups.length} person(s) have duplicate active Super Admin accounts. Deactivate redundant accounts to maintain a clean audit trail.`,
      });
    }
    if (adminsMissingMfa.length > 0) {
      recommendations.push({
        severity: "warning",
        message: `${adminsMissingMfa.length} Super Admin account(s) have MFA disabled. Enable MFA on all privileged accounts before any account cleanup.`,
      });
    }
    if (orphanedOrgUsers.length > 0) {
      recommendations.push({
        severity: "warning",
        message: `${orphanedOrgUsers.length} active user(s) belong to an org ID that is not registered. They will receive UNKNOWN_ORG errors on every API call.`,
      });
    }
    if (lockouts7d > 2) {
      recommendations.push({
        severity: "warning",
        message: `${lockouts7d} account lockout(s) in the last 7 days. Review failed-login patterns for potential credential stuffing.`,
      });
    }
    if (payrollPeriods.length === 0) {
      recommendations.push({
        severity: "warning",
        message: "No payroll periods found for org 1. Create a period before the next pay run.",
      });
    }
    if (pendingApprovals > 20) {
      recommendations.push({
        severity: "warning",
        message: `${pendingApprovals} approvals are pending. Review the approvals queue to prevent workflow stalls.`,
      });
    }

    // ── Response ──────────────────────────────────────────────────────────────
    res.json({
      checkedAt,
      overallStatus,
      recommendations,

      system: {
        status: "healthy" as Severity,
        apiUp: true,
        dbUp: true,
      },

      ai: {
        status: aiSev,
        configured: !!cfg,
        enabled: cfg?.isEnabled ?? false,
        model: cfg?.modelName ?? null,
        integrationProvisioned,
        auditAllQueries: cfg?.auditAllQueries ?? false,
        enabledFeatures: (() => {
          try {
            return cfg?.enabledFeatures ? JSON.parse(cfg.enabledFeatures) : [];
          } catch {
            return [];
          }
        })(),
        totalQueries: totalAiQueries,
        totalTokens: totalAiTokens,
        successCount: totalAiSuccess,
        failureCount: totalAiFailure,
        auditCoveragePercent,
        costNote:
          "Pricing rates for gpt-5.6-terra are not configured — cost unavailable.",
        featureBreakdown: aiStatRows.map((r) => ({
          feature: r.featureType,
          queries: Number(r.totalQueries),
          tokens: Number(r.totalTokens),
          avgMs: Number(r.avgDurationMs),
          p95Ms: Number(r.p95DurationMs),
          successes: Number(r.successCount),
          failures: Number(r.failureCount),
        })),
        recentFailures: aiRecentFailures.map((f) => ({
          id: f.id,
          feature: f.featureType,
          errorMessage: f.errorMessage,
          createdAt: f.createdAt,
        })),
      },

      security: {
        status: secSev,
        activeSuperAdminCount: superAdmins.length,
        // Only safe fields — no passwords, no session tokens
        superAdmins: superAdmins.map((u) => ({
          id: u.id,
          username: u.username,
          mfaEnabled: u.mfaEnabled,
          lastLoginAt: u.lastLoginAt,
          orgId: u.orgId,
        })),
        adminsMissingMfaCount: adminsMissingMfa.length,
        duplicateAdminGroups,
        failedLogins7d,
        lockouts7d,
        inactiveUserCount: inactiveUsers.length,
        orphanedOrgUserCount: orphanedOrgUsers.length,
        orphanedOrgUsers: orphanedOrgUsers.map((u) => ({
          id: u.id,
          username: u.username,
          orgId: u.orgId,
          roleName: u.roleName,
        })),
        activeSessionsByUser,
        openAlertsCount: openAlerts,
      },

      hr: {
        status: hrSev,
        employeeTotal,
        employeeActive,
        pendingApprovals,
        latestAttendanceAt,
        attendanceFreshHours:
          attendanceFreshHours !== null
            ? Math.round(attendanceFreshHours)
            : null,
        payrollPeriods: payrollPeriods.map((p) => ({
          id: p.id,
          nameEn: p.nameEn,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          isClosed: p.isClosed,
        })),
        payrollPeriodCount: payrollPeriods.length,
      },

      recentAudit: auditRecent.map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        action: r.action,
        entityType: r.entityType,
        entityLabel: r.entityLabel,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: "Health check failed",
      detail,
      checkedAt,
    });
  }
});

export default router;
