import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, desc } from "drizzle-orm";
import {
  db,
  goLiveGatesTable,
  readinessScorecardTable,
  auditLogsTable,
} from "@workspace/db";

const router = Router();

// Module → gate codes mapping
const MODULE_GATE_MAP: Record<string, string[]> = {
  authentication: ["AUTH_SESSION_GUARDS", "AUTH_KEYCLOAK_INTEGRATION"],
  payroll: ["PAYROLL_CONFIGURED", "MIGRATION_COMPLETE"],
  leave: ["LEAVE_TYPES_CONFIGURED", "HOLIDAYS_CONFIGURED"],
  attendance: ["DEVICES_ENROLLED", "MIGRATION_COMPLETE"],
  documents: [],
  recruitment: [],
  performance: [],
  training: [],
  reporting: ["AUDIT_LOGGING_ACTIVE"],
  backup_restore: ["DATA_BACKUP_VERIFIED", "DATA_RESTORE_TESTED", "BACKUP_SCHEDULE_CONFIGURED"],
  security: ["AUTH_SESSION_GUARDS", "AUTH_KEYCLOAK_INTEGRATION", "SECURITY_SCAN_RUN"],
  integration: ["AUTH_KEYCLOAK_INTEGRATION", "APPROVAL_CHAINS_CONFIGURED"],
  bilingual_ui: ["BILINGUAL_UI_VERIFIED"],
  approval_workflow: ["APPROVAL_CHAINS_CONFIGURED"],
  licensing: ["LICENSE_VALID"],
};

const MODULE_DISPLAYS: Record<string, { en: string; ar: string }> = {
  authentication: { en: "Authentication & Identity", ar: "المصادقة والهوية" },
  payroll: { en: "Payroll Management", ar: "إدارة الرواتب" },
  leave: { en: "Leave Management", ar: "إدارة الإجازات" },
  attendance: { en: "Attendance & Time", ar: "الحضور والوقت" },
  documents: { en: "Document Management", ar: "إدارة الوثائق" },
  recruitment: { en: "Recruitment", ar: "التوظيف" },
  performance: { en: "Performance Management", ar: "إدارة الأداء" },
  training: { en: "Training & Development", ar: "التدريب والتطوير" },
  reporting: { en: "Reporting & Analytics", ar: "التقارير والتحليلات" },
  backup_restore: { en: "Backup & Restore", ar: "النسخ الاحتياطي والاستعادة" },
  security: { en: "Security", ar: "الأمان" },
  integration: { en: "Integration", ar: "التكاملات" },
  bilingual_ui: { en: "Bilingual UI", ar: "واجهة المستخدم ثنائية اللغة" },
  approval_workflow: { en: "Approval Workflow", ar: "سير عمل الموافقة" },
  licensing: { en: "Licensing", ar: "الترخيص" },
};

// ─── GET /readiness-scorecard — list all scorecards ───────────────────────────
router.get("/readiness-scorecard", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(readinessScorecardTable)
      .orderBy(readinessScorecardTable.module);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /readiness-scorecard/recalculate — MUST come before /:module ────────
router.post("/readiness-scorecard/recalculate", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const gates = await db.select().from(goLiveGatesTable);
    const gateMap = new Map(gates.map((g: any) => [g.gateCode, g]));
    const now = new Date();
    const results: any[] = [];

    for (const [module, gateCodes] of Object.entries(MODULE_GATE_MAP)) {
      const display = MODULE_DISPLAYS[module] ?? { en: module, ar: module };
      const moduleGates = gateCodes.map((code) => gateMap.get(code)).filter(Boolean) as any[];
      const total = moduleGates.length;
      const passing = moduleGates.filter((g) => g.status === "pass" || g.isOverridden).length;
      const failing = moduleGates.filter((g) => g.status === "fail" && !g.isOverridden).length;
      const overridden = moduleGates.filter((g) => g.isOverridden).length;
      const score = total > 0 ? ((passing / total) * 100).toFixed(2) : "0.00";

      let readinessStatus: string;
      if (total === 0) {
        readinessStatus = "not_started";
      } else if (failing > 0) {
        readinessStatus = "blocked";
      } else if (passing === total) {
        readinessStatus = "ready";
      } else {
        readinessStatus = "partial";
      }

      const [upserted] = await db
        .insert(readinessScorecardTable)
        .values({
          module,
          moduleDisplayEn: display.en,
          moduleDisplayAr: display.ar,
          readinessStatus,
          totalGates: total,
          passingGates: passing,
          failingGates: failing,
          overriddenGates: overridden,
          readinessScore: score,
          coveredRolesJson: "[]",
          lastRecalculatedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: readinessScorecardTable.module,
          set: {
            moduleDisplayEn: display.en,
            moduleDisplayAr: display.ar,
            readinessStatus,
            totalGates: total,
            passingGates: passing,
            failingGates: failing,
            overriddenGates: overridden,
            readinessScore: score,
            lastRecalculatedAt: now,
            updatedAt: now,
          },
        })
        .returning();

      results.push(upserted);
    }

    await db.insert(auditLogsTable).values({
      action: "recalculate",
      entityType: "readiness_scorecard",
      entityId: 0,
      entityLabel: "Readiness Scorecard Recalculation",
      actorUserId,
      changesJson: JSON.stringify({ modulesRecalculated: results.length }),
    });

    res.json({ recalculated: results.length, scorecards: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /readiness-scorecard/:module — single module scorecard ───────────────
router.get("/readiness-scorecard/:module", async (req, res): Promise<void> => {
  try {
    const { module } = req.params;
    const [scorecard] = await db
      .select()
      .from(readinessScorecardTable)
      .where(eq(readinessScorecardTable.module, module));
    if (!scorecard) return void res.status(404).json({ error: "Scorecard not found" });

    // Fetch related gate details
    const gateCodes = MODULE_GATE_MAP[module] ?? [];
    const gates = await db
      .select()
      .from(goLiveGatesTable);
    const relatedGates = gates.filter((g: any) => gateCodes.includes(g.gateCode));

    res.json({ ...scorecard, gates: relatedGates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
