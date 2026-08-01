import { Router } from "express";
import { resolveHolidaysForDisplay } from "../lib/holidays";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import {
  db,
  goLiveGatesTable,
  auditLogsTable,
  backupRecordsTable,
  licenseRecordsTable,
  organizationsTable,
  salaryGradesTable,
  leaveTypesTable,
  publicHolidaysTable,
  attendanceDevicesTable,
  uatTestRunsTable,
  migrationStatusTable,
  approvalChainConfigsTable,
  integrationConnectionProfilesTable,
  securityTestRunsTable,
  restoreTestResultsTable,
} from "@workspace/db";
// restoreTestResultsTable — imported directly from pilotControl schema via @workspace/db
import { getBackupScheduleStatus } from "../lib/backupScheduler.js";

const router = Router();

// ─── Gate evaluation helpers ───────────────────────────────────────────────────

async function evaluateGate(gateCode: string): Promise<{
  status: "pass" | "fail" | "warn" | "pending";
  evidenceJson: string;
  blockerDescriptionEn: string | null;
}> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const currentYear = now.getFullYear();

  switch (gateCode) {
    case "AUTH_SESSION_GUARDS": {
      // DEMO MODE: The server has no real session middleware enforcing auth on endpoints.
      // All API routes accept unauthenticated requests by design for demo/pilot.
      // This gate is always "warn" until real session guards are wired in.
      return {
        status: "warn",
        evidenceJson: JSON.stringify({
          demoMode: true,
          note: "DEMO MODE — no session-based auth guards are active. All API endpoints accept unauthenticated requests. This is by design for the pilot but MUST be remediated before production go-live.",
          remediationRequired: "Add Passport.js or similar middleware to enforce req.session.userId on all mutating routes.",
        }),
        blockerDescriptionEn:
          "Session authentication guards are not active. All API endpoints accept unauthenticated requests in demo mode. This is a critical security gap that must be resolved before production go-live.",
      };
    }

    case "AUTH_KEYCLOAK_INTEGRATION": {
      const profiles = await db
        .select()
        .from(integrationConnectionProfilesTable)
        .where(
          sql`${integrationConnectionProfilesTable.integrationType} IN ('sso_oidc', 'sso_saml') AND ${integrationConnectionProfilesTable.governanceStatus} = 'approved'`
        );
      const passed = profiles.length > 0;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ profilesFound: profiles.length, profiles: profiles.map((p: any) => ({ id: p.id, integrationType: p.integrationType, status: p.status, governanceStatus: p.governanceStatus })) }),
        blockerDescriptionEn: passed ? null : "No approved SSO (Keycloak OIDC/SAML) integration profile found. Configure and approve a Keycloak connection profile before go-live.",
      };
    }

    case "DATA_BACKUP_VERIFIED": {
      const records = await db
        .select()
        .from(backupRecordsTable)
        .where(
          and(
            eq(backupRecordsTable.isVerified, true),
            gte(backupRecordsTable.verifiedAt, sevenDaysAgo)
          )
        )
        .limit(5);
      const passed = records.length > 0;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ verifiedBackupsInLast7Days: records.length, recent: records.map((r: any) => ({ id: r.id, backupType: r.backupType, verifiedAt: r.verifiedAt })) }),
        blockerDescriptionEn: passed ? null : "No verified backup found in the last 7 days. Run and verify a backup before go-live.",
      };
    }

    case "DATA_RESTORE_TESTED": {
      const records = await db
        .select()
        .from(restoreTestResultsTable)
        .where(
          and(
            eq(restoreTestResultsTable.result, "pass"),
            gte(restoreTestResultsTable.testedAt, thirtyDaysAgo)
          )
        )
        .limit(5);
      const passed = records.length > 0;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ passedRestoreTestsInLast30Days: records.length, recent: records.map((r: any) => ({ id: r.id, restoreType: r.restoreType, testedAt: r.testedAt })) }),
        blockerDescriptionEn: passed ? null : "No successful restore test found in the last 30 days. Perform a full restore test before go-live.",
      };
    }

    case "LICENSE_VALID": {
      const today = now.toISOString().slice(0, 10);
      const licenses = await db
        .select()
        .from(licenseRecordsTable)
        .where(eq(licenseRecordsTable.isActive, true));
      const validLicense = licenses.find((l: any) => !l.validUntil || l.validUntil >= today);
      return {
        status: validLicense ? "pass" : "fail",
        evidenceJson: JSON.stringify({ activeLicenses: licenses.length, valid: !!validLicense, details: validLicense ? { id: validLicense.id, edition: validLicense.edition, validUntil: validLicense.validUntil } : null }),
        blockerDescriptionEn: validLicense ? null : "No valid active license found. Activate a license before go-live.",
      };
    }

    case "ORG_CONFIGURED": {
      const orgs = await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.status, "active"));
      const passed = orgs.length >= 1;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ activeOrgs: orgs.length }),
        blockerDescriptionEn: passed ? null : "No active organization configured. Configure at least one active organization.",
      };
    }

    case "PAYROLL_CONFIGURED": {
      const grades = await db
        .select()
        .from(salaryGradesTable)
        .where(eq(salaryGradesTable.isActive, true));
      const passed = grades.length >= 1;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ activeSalaryGrades: grades.length }),
        blockerDescriptionEn: passed ? null : "No active salary grades found. Configure salary grades before go-live.",
      };
    }

    case "LEAVE_TYPES_CONFIGURED": {
      const types = await db
        .select()
        .from(leaveTypesTable)
        .where(eq(leaveTypesTable.isActive, true));
      const passed = types.length >= 2;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ activeLeaveTypes: types.length }),
        blockerDescriptionEn: passed ? null : `Only ${types.length} active leave type(s) configured; at least 2 required.`,
      };
    }

    case "HOLIDAYS_CONFIGURED": {
      // Recurring holidays count for every year, whatever year they were stored under.
      const holidayRows = await db.select().from(publicHolidaysTable);
      const holidays = resolveHolidaysForDisplay(holidayRows, { year: currentYear });
      const passed = holidays.length >= 1;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ holidaysForCurrentYear: holidays.length, year: currentYear }),
        blockerDescriptionEn: passed ? null : `No public holidays configured for ${currentYear}. Add at least one holiday for the current year.`,
      };
    }

    case "DEVICES_ENROLLED": {
      const devices = await db
        .select()
        .from(attendanceDevicesTable)
        .where(eq(attendanceDevicesTable.status, "online"));
      const passed = devices.length >= 1;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ activeDevices: devices.length }),
        blockerDescriptionEn: passed ? null : "No active attendance devices enrolled. Enroll at least one device.",
      };
    }

    case "AUDIT_LOGGING_ACTIVE": {
      const entries = await db
        .select()
        .from(auditLogsTable)
        .where(gte(auditLogsTable.createdAt, twentyFourHoursAgo))
        .limit(10);
      const passed = entries.length > 0;
      return {
        status: passed ? "pass" : "warn",
        evidenceJson: JSON.stringify({ auditEntriesInLast24Hours: entries.length }),
        blockerDescriptionEn: passed ? null : "No audit log entries in the last 24 hours. Verify audit logging is active.",
      };
    }

    case "PILOT_UAT_COMPLETE": {
      const runs = await db
        .select()
        .from(uatTestRunsTable)
        .where(eq(uatTestRunsTable.result, "pass"));
      const passed = runs.length >= 5;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ passedUatRuns: runs.length, required: 5 }),
        blockerDescriptionEn: passed ? null : `Only ${runs.length} passed UAT run(s); at least 5 required before go-live.`,
      };
    }

    case "SECURITY_SCAN_RUN": {
      const runs = await db
        .select()
        .from(securityTestRunsTable)
        .where(
          and(
            eq(securityTestRunsTable.status, "complete"),
            gte(securityTestRunsTable.completedAt, thirtyDaysAgo)
          )
        )
        .limit(3);
      const passed = runs.length > 0;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ completedSecurityRunsInLast30Days: runs.length, recent: runs.map((r: any) => ({ id: r.id, overallPosture: r.overallPosture, completedAt: r.completedAt })) }),
        blockerDescriptionEn: passed ? null : "No completed security test run in the last 30 days. Run security tests before go-live.",
      };
    }

    case "MIGRATION_COMPLETE": {
      const items = await db.select().from(migrationStatusTable);
      const required = items.filter((i: any) => i.priority === "required");
      const complete = required.filter((i: any) => i.status === "complete");
      const incomplete = required.filter((i: any) => i.status !== "complete");
      const passed = incomplete.length === 0 && required.length > 0;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ totalMigrations: items.length, requiredMigrations: required.length, completeMigrations: complete.length, incompleteMigrations: incomplete.map((i: any) => ({ code: i.migrationCode, status: i.status })) }),
        blockerDescriptionEn: passed ? null : `${incomplete.length} required migration(s) are not complete: ${incomplete.map((i: any) => i.migrationCode).join(", ")}`,
      };
    }

    case "BILINGUAL_UI_VERIFIED": {
      // Manual gate — requires human sign-off
      return {
        status: "pending",
        evidenceJson: JSON.stringify({ note: "Manual gate — requires human sign-off by QA/UI team confirming all UI strings are wrapped in t() helper for both English and Arabic." }),
        blockerDescriptionEn: "Bilingual UI verification is a manual gate. A QA reviewer must confirm all UI strings are properly internationalized before go-live.",
      };
    }

    case "APPROVAL_CHAINS_CONFIGURED": {
      const chains = await db
        .select()
        .from(approvalChainConfigsTable)
        .where(eq(approvalChainConfigsTable.isActive, true));
      const passed = chains.length >= 1;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({ activeApprovalChains: chains.length }),
        blockerDescriptionEn: passed ? null : "No active approval chain configurations found. Configure at least one approval chain.",
      };
    }

    case "BACKUP_SCHEDULE_CONFIGURED": {
      // Real evidence: the in-process node-cron scheduler's live status, not a
      // proxy count of backup records.
      const schedule = getBackupScheduleStatus();
      const passed = schedule.enabled && schedule.valid && schedule.running;
      return {
        status: passed ? "pass" : "fail",
        evidenceJson: JSON.stringify({
          scheduler: schedule,
          note: "Evidence taken directly from the API server's node-cron backup scheduler (nightly full backup + retention pruning).",
        }),
        blockerDescriptionEn: passed
          ? null
          : schedule.enabled
            ? schedule.valid
              ? "Backup scheduler is not running. Restart the API server to start the scheduled backup job."
              : `BACKUP_CRON expression "${schedule.cronExpression}" is invalid — the backup scheduler could not start.`
            : "Scheduled backups are disabled via BACKUP_SCHEDULE_ENABLED=\"false\". Enable the backup schedule before go-live.",
      };
    }

    default:
      return {
        status: "pending",
        evidenceJson: JSON.stringify({ note: `Unknown gate code: ${gateCode}` }),
        blockerDescriptionEn: null,
      };
  }
}

const AUTOMATED_GATE_CODES = [
  "AUTH_SESSION_GUARDS",
  "AUTH_KEYCLOAK_INTEGRATION",
  "DATA_BACKUP_VERIFIED",
  "DATA_RESTORE_TESTED",
  "LICENSE_VALID",
  "ORG_CONFIGURED",
  "PAYROLL_CONFIGURED",
  "LEAVE_TYPES_CONFIGURED",
  "HOLIDAYS_CONFIGURED",
  "DEVICES_ENROLLED",
  "AUDIT_LOGGING_ACTIVE",
  "PILOT_UAT_COMPLETE",
  "SECURITY_SCAN_RUN",
  "MIGRATION_COMPLETE",
  "APPROVAL_CHAINS_CONFIGURED",
  "BACKUP_SCHEDULE_CONFIGURED",
];

// ─── GET /go-live-gates/summary ─ MUST come before /:gateCode ─────────────────
router.get("/go-live-gates/summary", async (req, res): Promise<void> => {
  try {
    const gates = await db.select().from(goLiveGatesTable).orderBy(goLiveGatesTable.sortOrder);
    const total = gates.length;
    const passed = gates.filter((g: any) => g.status === "pass" || g.isOverridden).length;
    const failed = gates.filter((g: any) => g.status === "fail" && !g.isOverridden).length;
    const warnings = gates.filter((g: any) => g.status === "warn" && !g.isOverridden).length;
    const blocked = gates.filter((g: any) => g.status === "blocked" && !g.isOverridden).length;
    const criticalBlockers = gates.filter(
      (g: any) => g.severity === "critical" && (g.status === "fail" || g.status === "blocked") && !g.isOverridden
    );
    const isReadyForGoLive = criticalBlockers.length === 0 && failed === 0 && blocked === 0;

    res.json({
      totalGates: total,
      passed,
      failed,
      warnings,
      blocked,
      criticalBlockers: criticalBlockers.map((g: any) => ({
        id: g.id,
        gateCode: g.gateCode,
        titleEn: g.titleEn,
        severity: g.severity,
        status: g.status,
        blockerDescriptionEn: g.blockerDescriptionEn,
      })),
      isReadyForGoLive,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /go-live-gates — list all gates ──────────────────────────────────────
router.get("/go-live-gates", async (req, res): Promise<void> => {
  try {
    const gates = await db.select().from(goLiveGatesTable).orderBy(goLiveGatesTable.sortOrder);

    // Group by category
    const grouped: Record<string, typeof gates> = {};
    for (const gate of gates) {
      if (!grouped[gate.category]) grouped[gate.category] = [];
      grouped[gate.category].push(gate);
    }

    res.json({ gates, grouped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /go-live-gates/evaluate — run all automated evaluations ──────────────
router.post("/go-live-gates/evaluate", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const now = new Date();
    const results: any[] = [];

    for (const gateCode of AUTOMATED_GATE_CODES) {
      const evaluation = await evaluateGate(gateCode);

      const [upserted] = await db
        .insert(goLiveGatesTable)
        .values({
          gateCode,
          category: "automated",
          titleEn: gateCode,
          titleAr: gateCode,
          severity: "critical",
          status: evaluation.status,
          evaluationType: "automated",
          evidenceJson: evaluation.evidenceJson,
          blockerDescriptionEn: evaluation.blockerDescriptionEn,
          evaluatedByUserId: actorUserId,
          lastEvaluatedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: goLiveGatesTable.gateCode,
          set: {
            status: evaluation.status,
            evidenceJson: evaluation.evidenceJson,
            blockerDescriptionEn: evaluation.blockerDescriptionEn,
            evaluatedByUserId: actorUserId,
            lastEvaluatedAt: now,
            updatedAt: now,
          },
        })
        .returning();

      results.push(upserted);
    }

    await db.insert(auditLogsTable).values({
      action: "evaluate_all",
      entityType: "go_live_gates",
      entityId: 0,
      entityLabel: "Go-Live Gate Evaluation",
      actorUserId,
      changesJson: JSON.stringify({ evaluatedCount: results.length }),
    });

    const evaluated = results.length;
    const passed = results.filter((g) => g.status === "pass").length;
    const failed = results.filter((g) => g.status === "fail").length;

    res.json({ evaluated, passed, failed, gates: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /go-live-gates/:gateCode — single gate ───────────────────────────────
router.get("/go-live-gates/:gateCode", async (req, res): Promise<void> => {
  try {
    const { gateCode } = req.params;
    const [gate] = await db
      .select()
      .from(goLiveGatesTable)
      .where(eq(goLiveGatesTable.gateCode, gateCode));
    if (!gate) return void res.status(404).json({ error: "Gate not found" });
    res.json(gate);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /go-live-gates/:gateCode — update status/notes manually ────────────
router.patch("/go-live-gates/:gateCode", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { gateCode } = req.params;
    const { status, notes, blockerDescriptionEn, remediationEn } = req.body;

    const [gate] = await db
      .select()
      .from(goLiveGatesTable)
      .where(eq(goLiveGatesTable.gateCode, gateCode));
    if (!gate) return void res.status(404).json({ error: "Gate not found" });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.descriptionEn = notes;
    if (blockerDescriptionEn !== undefined) updates.blockerDescriptionEn = blockerDescriptionEn;
    if (remediationEn !== undefined) updates.remediationEn = remediationEn;

    const [updated] = await db
      .update(goLiveGatesTable)
      .set(updates)
      .where(eq(goLiveGatesTable.gateCode, gateCode))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "patch",
      entityType: "go_live_gate",
      entityId: gate.id,
      entityLabel: `Gate: ${gateCode}`,
      actorUserId,
      changesJson: JSON.stringify(updates),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /go-live-gates/:gateCode/override ───────────────────────────────────
router.post("/go-live-gates/:gateCode/override", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { gateCode } = req.params;
    const { reason } = req.body;

    if (!reason) return void res.status(400).json({ error: "reason is required for override" });

    const [gate] = await db
      .select()
      .from(goLiveGatesTable)
      .where(eq(goLiveGatesTable.gateCode, gateCode));
    if (!gate) return void res.status(404).json({ error: "Gate not found" });

    const now = new Date();
    const [updated] = await db
      .update(goLiveGatesTable)
      .set({
        isOverridden: true,
        overriddenByUserId: actorUserId,
        overrideReason: reason,
        overriddenAt: now,
        updatedAt: now,
      })
      .where(eq(goLiveGatesTable.gateCode, gateCode))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "override",
      entityType: "go_live_gate",
      entityId: gate.id,
      entityLabel: `Gate Override: ${gateCode}`,
      actorUserId,
      changesJson: JSON.stringify({ reason, gateCode, previousStatus: gate.status }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
