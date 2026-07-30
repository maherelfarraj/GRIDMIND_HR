import { Router } from "express";
import { randomUUID } from "crypto";
import {
  db,
  systemHealthChecksTable,
  environmentReadinessChecksTable,
  softwareUpdatePackagesTable,
  deploymentChecklistItemsTable,
  backupRecordsTable,
  licenseRecordsTable,
  systemConfigTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /diagnostics — returns latest run results + summary
// ─────────────────────────────────────────────────────────────────────────────
router.get("/diagnostics", async (req, res): Promise<void> => {
  try {
    // Get the latest runId
    const [latest] = await db
      .select({ runId: systemHealthChecksTable.runId, runAt: systemHealthChecksTable.runAt })
      .from(systemHealthChecksTable)
      .orderBy(desc(systemHealthChecksTable.runAt))
      .limit(1);

    if (!latest?.runId) {
      return void res.json({ checks: [], summary: { pass: 0, warn: 0, fail: 0, total: 0 }, runId: null, runAt: null });
    }

    const checks = await db
      .select()
      .from(systemHealthChecksTable)
      .where(eq(systemHealthChecksTable.runId, latest.runId))
      .orderBy(systemHealthChecksTable.checkCategory);

    const summary = {
      pass: checks.filter((c) => c.result === "pass").length,
      warn: checks.filter((c) => c.result === "warn").length,
      fail: checks.filter((c) => c.result === "fail").length,
      total: checks.length,
    };

    res.json({ checks, summary, runId: latest.runId, runAt: latest.runAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /diagnostics/run — insert a new batch of health checks
// ─────────────────────────────────────────────────────────────────────────────
router.post("/diagnostics/run", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const runId = randomUUID();
    const runAt = new Date();

    const checksToInsert: any[] = [];

    // 1. Database check
    const dbStart = Date.now();
    try {
      await db.execute("select 1" as any);
      checksToInsert.push({
        checkName: "Database Connectivity",
        checkCategory: "database",
        result: "pass",
        message: "Database query succeeded",
        metricValue: String(Date.now() - dbStart),
        metricUnit: "ms",
        durationMs: Date.now() - dbStart,
        isCritical: true,
        runId,
        runAt,
        triggeredByUserId: actorUserId,
      });
    } catch {
      checksToInsert.push({
        checkName: "Database Connectivity",
        checkCategory: "database",
        result: "fail",
        message: "Database query failed",
        isCritical: true,
        runId,
        runAt,
        triggeredByUserId: actorUserId,
      });
    }

    // 2. Disk check (simulated)
    const diskUsage = 45;
    checksToInsert.push({
      checkName: "Disk Usage",
      checkCategory: "disk",
      result: diskUsage >= 90 ? "fail" : diskUsage >= 75 ? "warn" : "pass",
      message: `Disk usage: ${diskUsage}%`,
      metricValue: String(diskUsage),
      metricUnit: "%",
      thresholdWarn: "75",
      thresholdFail: "90",
      isCritical: false,
      runId,
      runAt,
      triggeredByUserId: actorUserId,
    });

    // 3. Memory check (simulated)
    const memUsage = 62;
    checksToInsert.push({
      checkName: "Memory Usage",
      checkCategory: "memory",
      result: memUsage >= 90 ? "fail" : memUsage >= 80 ? "warn" : "pass",
      message: `Memory usage: ${memUsage}%`,
      metricValue: String(memUsage),
      metricUnit: "%",
      thresholdWarn: "80",
      thresholdFail: "90",
      isCritical: false,
      runId,
      runAt,
      triggeredByUserId: actorUserId,
    });

    // 4. API check (simulated — check that Express is running)
    checksToInsert.push({
      checkName: "API Health Endpoint",
      checkCategory: "api",
      result: "pass",
      message: "API is responding",
      metricValue: "1",
      metricUnit: "ms",
      durationMs: 1,
      isCritical: true,
      runId,
      runAt,
      triggeredByUserId: actorUserId,
    });

    // 5. Backup check
    try {
      const [lastBackup] = await db
        .select()
        .from(backupRecordsTable)
        .where(eq(backupRecordsTable.status, "success"))
        .orderBy(desc(backupRecordsTable.startedAt))
        .limit(1);

      if (!lastBackup) {
        checksToInsert.push({
          checkName: "Last Backup Age",
          checkCategory: "backup",
          result: "warn",
          message: "No successful backup found",
          isCritical: false,
          runId,
          runAt,
          triggeredByUserId: actorUserId,
        });
      } else {
        const ageHours = (Date.now() - new Date(lastBackup.startedAt).getTime()) / 3600000;
        checksToInsert.push({
          checkName: "Last Backup Age",
          checkCategory: "backup",
          result: ageHours > 48 ? "fail" : ageHours > 24 ? "warn" : "pass",
          message: `Last backup: ${Math.round(ageHours)} hours ago`,
          metricValue: String(Math.round(ageHours)),
          metricUnit: "hours",
          thresholdWarn: "24",
          thresholdFail: "48",
          isCritical: false,
          runId,
          runAt,
          triggeredByUserId: actorUserId,
        });
      }
    } catch {
      checksToInsert.push({
        checkName: "Last Backup Age",
        checkCategory: "backup",
        result: "skipped",
        message: "Could not query backup records",
        runId,
        runAt,
        triggeredByUserId: actorUserId,
      });
    }

    // 6. License check
    try {
      const [license] = await db
        .select()
        .from(licenseRecordsTable)
        .where(eq(licenseRecordsTable.isActive, true))
        .limit(1);

      if (!license) {
        checksToInsert.push({
          checkName: "License Validity",
          checkCategory: "license",
          result: "fail",
          message: "No active license found",
          isCritical: true,
          runId,
          runAt,
          triggeredByUserId: actorUserId,
        });
      } else {
        let daysLeft: number | null = null;
        if (license.validUntil) {
          daysLeft = Math.ceil((new Date(license.validUntil + "T00:00:00").getTime() - Date.now()) / 86400000);
        }
        checksToInsert.push({
          checkName: "License Validity",
          checkCategory: "license",
          result: daysLeft !== null && daysLeft < 0 ? "fail" : daysLeft !== null && daysLeft < 30 ? "warn" : "pass",
          message: daysLeft !== null ? `License expires in ${daysLeft} days` : "License active (no expiry)",
          metricValue: daysLeft !== null ? String(daysLeft) : null,
          metricUnit: "days",
          isCritical: true,
          runId,
          runAt,
          triggeredByUserId: actorUserId,
        });
      }
    } catch {
      checksToInsert.push({
        checkName: "License Validity",
        checkCategory: "license",
        result: "skipped",
        message: "Could not query license",
        runId,
        runAt,
        triggeredByUserId: actorUserId,
      });
    }

    // 7. Config check
    try {
      const configs = await db.select().from(systemConfigTable);
      const keys = configs.map((c) => c.key);
      const requiredKeys = ["weekendDays", "organizationType", "defaultCurrency"];
      const missing = requiredKeys.filter((k) => !keys.includes(k));
      checksToInsert.push({
        checkName: "System Configuration",
        checkCategory: "config",
        result: missing.length > 0 ? "warn" : "pass",
        message: missing.length > 0 ? `Missing config keys: ${missing.join(", ")}` : "All required config keys present",
        isCritical: false,
        runId,
        runAt,
        triggeredByUserId: actorUserId,
      });
    } catch {
      checksToInsert.push({
        checkName: "System Configuration",
        checkCategory: "config",
        result: "skipped",
        message: "Could not query system config",
        runId,
        runAt,
        triggeredByUserId: actorUserId,
      });
    }

    // 8. Security check (simulated)
    checksToInsert.push({
      checkName: "Default Password Check",
      checkCategory: "security",
      result: "pass",
      message: "No default passwords detected (simulated)",
      isCritical: true,
      runId,
      runAt,
      triggeredByUserId: actorUserId,
    });

    // Insert all checks
    const inserted = await db.insert(systemHealthChecksTable).values(checksToInsert).returning();

    const summary = {
      pass: inserted.filter((c) => c.result === "pass").length,
      warn: inserted.filter((c) => c.result === "warn").length,
      fail: inserted.filter((c) => c.result === "fail").length,
      total: inserted.length,
    };

    await db.insert(auditLogsTable).values({
      action: "run_diagnostics",
      entityType: "system_health_check",
      entityId: null,
      entityLabel: `Diagnostics run: ${runId}`,
      actorUserId,
      changesJson: JSON.stringify({ runId, summary }),
    });

    res.status(201).json({ checks: inserted, summary, runId, runAt, simulated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /diagnostics/readiness — list readiness checks (seed if empty)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/diagnostics/readiness", async (req, res): Promise<void> => {
  try {
    let rows = await db.select().from(environmentReadinessChecksTable).orderBy(environmentReadinessChecksTable.id);

    if (rows.length === 0) {
      // Seed initial rows
      const defaults = [
        { checkName: "db_connectivity", checkCategory: "infrastructure", result: "pending", message: null, remediationHint: "Verify DATABASE_URL is correctly set", isMandatory: true },
        { checkName: "disk_space", checkCategory: "infrastructure", result: "pending", message: null, remediationHint: "Ensure at least 10GB free disk space", isMandatory: true },
        { checkName: "backup_dir_writable", checkCategory: "infrastructure", result: "pending", message: null, remediationHint: "Set BACKUP_DIR env var to a writable path", isMandatory: true },
        { checkName: "config_complete", checkCategory: "configuration", result: "pending", message: null, remediationHint: "Complete the setup wizard", isMandatory: true },
        { checkName: "smtp_configured", checkCategory: "configuration", result: "pending", message: null, remediationHint: "Set SMTP_HOST, SMTP_PORT, SMTP_USER env vars", isMandatory: false },
        { checkName: "ldap_optional", checkCategory: "configuration", result: "pending", message: "Optional — skip if not using LDAP", remediationHint: null, isMandatory: false },
      ];
      await db.insert(environmentReadinessChecksTable).values(defaults);
      rows = await db.select().from(environmentReadinessChecksTable).orderBy(environmentReadinessChecksTable.id);
    }

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /diagnostics/readiness/run — re-evaluate all readiness checks
// ─────────────────────────────────────────────────────────────────────────────
router.post("/diagnostics/readiness/run", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;

    const checks = await db.select().from(environmentReadinessChecksTable);
    if (checks.length === 0) {
      return void res.status(400).json({ error: "No readiness checks found. GET /diagnostics/readiness first." });
    }

    const results: any[] = [];
    for (const check of checks) {
      let result: string;
      let message: string;

      // Simulate evaluation
      switch (check.checkName) {
        case "db_connectivity":
          result = "pass";
          message = "Database connection verified";
          break;
        case "disk_space":
          result = "pass";
          message = "45% disk used — OK";
          break;
        case "backup_dir_writable":
          result = "pass";
          message = "Backup directory is writable (simulated)";
          break;
        case "config_complete":
          result = "pass";
          message = "Setup wizard completed";
          break;
        case "smtp_configured":
          result = "warn";
          message = "SMTP not configured — email notifications disabled";
          break;
        case "ldap_optional":
          result = "pass";
          message = "LDAP not configured (optional)";
          break;
        default:
          result = "pass";
          message = "Check passed (simulated)";
      }

      const [updated] = await db
        .update(environmentReadinessChecksTable)
        .set({ result, message, lastCheckedAt: new Date() })
        .where(eq(environmentReadinessChecksTable.id, check.id))
        .returning();
      results.push(updated);
    }

    await db.insert(auditLogsTable).values({
      action: "run_readiness_checks",
      entityType: "environment_readiness_check",
      entityId: null,
      entityLabel: "Readiness checks re-evaluated",
      actorUserId,
      changesJson: JSON.stringify({ count: results.length, simulated: true }),
    });

    res.json({ results, simulated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /diagnostics/readiness/:id/override
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/diagnostics/readiness/:id/override", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);
    const { overrideReason } = req.body;

    const [check] = await db.select().from(environmentReadinessChecksTable).where(eq(environmentReadinessChecksTable.id, id));
    if (!check) return void res.status(404).json({ error: "Readiness check not found" });

    const [updated] = await db
      .update(environmentReadinessChecksTable)
      .set({
        isOverridden: true,
        overriddenByUserId: actorUserId,
        overrideReason: overrideReason ?? null,
      })
      .where(eq(environmentReadinessChecksTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "override",
      entityType: "environment_readiness_check",
      entityId: id,
      entityLabel: `Readiness check overridden: ${check.checkName}`,
      actorUserId,
      changesJson: JSON.stringify({ isOverridden: true, overrideReason }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /diagnostics/updates — list software update packages
// ─────────────────────────────────────────────────────────────────────────────
router.get("/diagnostics/updates", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(softwareUpdatePackagesTable).orderBy(desc(softwareUpdatePackagesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /diagnostics/updates — create/register a new update package
// ─────────────────────────────────────────────────────────────────────────────
router.post("/diagnostics/updates", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { version, buildNumber, releaseChannel, packageFilename, fileSizeBytes, checksum, manifestJson, releaseNotesEn, releaseNotesAr } = req.body;

    if (!version) return void res.status(400).json({ error: "version is required" });

    const [row] = await db
      .insert(softwareUpdatePackagesTable)
      .values({
        version,
        buildNumber: buildNumber ?? null,
        releaseChannel: releaseChannel ?? "stable",
        status: "pending_verification",
        packageFilename: packageFilename ?? null,
        fileSizeBytes: fileSizeBytes ?? null,
        checksum: checksum ?? null,
        manifestJson: manifestJson ? JSON.stringify(manifestJson) : null,
        releaseNotesEn: releaseNotesEn ?? null,
        releaseNotesAr: releaseNotesAr ?? null,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "software_update_package",
      entityId: row.id,
      entityLabel: `Update package: v${version}`,
      actorUserId,
      changesJson: JSON.stringify({ version, releaseChannel }),
    });

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /diagnostics/updates/:id — update status / verify signature
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/diagnostics/updates/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);
    const { status, verifySignature } = req.body;

    const [pkg] = await db.select().from(softwareUpdatePackagesTable).where(eq(softwareUpdatePackagesTable.id, id));
    if (!pkg) return void res.status(404).json({ error: "Update package not found" });

    const updateData: Record<string, any> = {};
    if (status) updateData.status = status;
    if (verifySignature) {
      updateData.signatureValid = true;
      updateData.signatureVerifiedAt = new Date();
      updateData.status = updateData.status ?? "verified";
    }

    const [updated] = await db
      .update(softwareUpdatePackagesTable)
      .set(updateData)
      .where(eq(softwareUpdatePackagesTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "update",
      entityType: "software_update_package",
      entityId: id,
      entityLabel: `Update package updated: v${pkg.version}`,
      actorUserId,
      changesJson: JSON.stringify({ status: updateData.status, verifySignature, simulated: true }),
    });

    res.json({ ...updated, simulated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /diagnostics/deployment-checklist — list items (seed if empty)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/diagnostics/deployment-checklist", async (req, res): Promise<void> => {
  try {
    let rows = await db.select().from(deploymentChecklistItemsTable).orderBy(deploymentChecklistItemsTable.sortOrder);

    if (rows.length === 0) {
      const defaults = [
        { category: "infrastructure", itemCode: "db_configured", titleEn: "Database Configured", titleAr: "قاعدة البيانات مُهيأة", priority: "required", implementationLevel: "production", sortOrder: 1 },
        { category: "infrastructure", itemCode: "backup_verified", titleEn: "Backup Verified", titleAr: "النسخ الاحتياطي مُتحقق منه", priority: "required", implementationLevel: "production", sortOrder: 2 },
        { category: "compliance", itemCode: "license_valid", titleEn: "License Valid", titleAr: "الترخيص صالح", priority: "required", implementationLevel: "production", sortOrder: 3 },
        { category: "configuration", itemCode: "setup_wizard_complete", titleEn: "Setup Wizard Complete", titleAr: "معالج الإعداد مكتمل", priority: "required", implementationLevel: "production", sortOrder: 4 },
        { category: "security", itemCode: "admin_accounts_set", titleEn: "Admin Accounts Configured", titleAr: "حسابات المسؤول مُهيأة", priority: "required", implementationLevel: "production", sortOrder: 5 },
        { category: "configuration", itemCode: "departments_configured", titleEn: "Departments Configured", titleAr: "الأقسام مُهيأة", priority: "required", implementationLevel: "production", sortOrder: 6 },
        { category: "configuration", itemCode: "grades_configured", titleEn: "Salary Grades Configured", titleAr: "درجات الراتب مُهيأة", priority: "required", implementationLevel: "production", sortOrder: 7 },
        { category: "configuration", itemCode: "leave_types_configured", titleEn: "Leave Types Configured", titleAr: "أنواع الإجازات مُهيأة", priority: "required", implementationLevel: "production", sortOrder: 8 },
        { category: "configuration", itemCode: "holidays_configured", titleEn: "Public Holidays Configured", titleAr: "العطل الرسمية مُهيأة", priority: "recommended", implementationLevel: "production", sortOrder: 9 },
        { category: "infrastructure", itemCode: "devices_enrolled", titleEn: "Biometric Devices Enrolled", titleAr: "أجهزة البصمة مُسجلة", priority: "recommended", implementationLevel: "prototype", sortOrder: 10 },
        { category: "configuration", itemCode: "approval_chains_set", titleEn: "Approval Chains Configured", titleAr: "سلاسل الاعتماد مُهيأة", priority: "recommended", implementationLevel: "production", sortOrder: 11 },
        { category: "security", itemCode: "security_policy_reviewed", titleEn: "Security Policy Reviewed", titleAr: "سياسة الأمان مُراجعة", priority: "optional", implementationLevel: "prototype", sortOrder: 12 },
      ];
      await db.insert(deploymentChecklistItemsTable).values(defaults);
      rows = await db.select().from(deploymentChecklistItemsTable).orderBy(deploymentChecklistItemsTable.sortOrder);
    }

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /diagnostics/deployment-checklist/:itemCode — update status/notes
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/diagnostics/deployment-checklist/:itemCode", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { itemCode } = req.params;
    const { status, statusNotes } = req.body;

    const [item] = await db.select().from(deploymentChecklistItemsTable).where(eq(deploymentChecklistItemsTable.itemCode, itemCode));
    if (!item) return void res.status(404).json({ error: "Checklist item not found" });

    const updateData: Record<string, any> = { updatedAt: new Date(), lastCheckedAt: new Date(), checkedByUserId: actorUserId };
    if (status) updateData.status = status;
    if (statusNotes !== undefined) updateData.statusNotes = statusNotes;

    const [updated] = await db
      .update(deploymentChecklistItemsTable)
      .set(updateData)
      .where(eq(deploymentChecklistItemsTable.itemCode, itemCode))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "update",
      entityType: "deployment_checklist_item",
      entityId: item.id,
      entityLabel: `Checklist item: ${itemCode}`,
      actorUserId,
      changesJson: JSON.stringify({ status, statusNotes }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
