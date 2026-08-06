import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  uatScriptsTable,
  uatTestRunsTable,
  uatTestRunStepsTable,
  auditLogsTable,
} from "@workspace/db";

const router = Router();

// ─── UAT SCRIPTS ──────────────────────────────────────────────────────────────

// GET /uat-scripts — list active scripts with optional filters
router.get("/uat-scripts", async (req, res): Promise<void> => {
  try {
    const { role, module } = req.query as Record<string, string>;
    const conditions: any[] = [eq(uatScriptsTable.isActive, true)];
    if (role) conditions.push(eq(uatScriptsTable.targetRole, role));
    if (module) conditions.push(eq(uatScriptsTable.module, module));

    const rows = await db
      .select()
      .from(uatScriptsTable)
      .where(and(...conditions))
      .orderBy(uatScriptsTable.scriptCode);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /uat-scripts — create script
router.post("/uat-scripts", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const { scriptCode, titleEn, titleAr, targetRole, module, orgTypeApplicability, estimatedMinutes, prerequisitesEn, stepsJson, acceptanceCriteriaJson, relatedGateCodes, version } = req.body;

    if (!scriptCode) return void res.status(400).json({ error: "scriptCode is required" });
    if (!titleEn) return void res.status(400).json({ error: "titleEn is required" });
    if (!titleAr) return void res.status(400).json({ error: "titleAr is required" });
    if (!targetRole) return void res.status(400).json({ error: "targetRole is required" });
    if (!module) return void res.status(400).json({ error: "module is required" });

    const [row] = await db
      .insert(uatScriptsTable)
      .values({
        scriptCode,
        titleEn,
        titleAr,
        targetRole,
        module,
        orgTypeApplicability: orgTypeApplicability ?? "all",
        estimatedMinutes: estimatedMinutes ?? 20,
        prerequisitesEn: prerequisitesEn ?? null,
        stepsJson: stepsJson ? JSON.stringify(stepsJson) : "[]",
        acceptanceCriteriaJson: acceptanceCriteriaJson ? JSON.stringify(acceptanceCriteriaJson) : "[]",
        relatedGateCodes: relatedGateCodes ?? null,
        isActive: true,
        version: version ?? "1.0",
        createdByUserId: actorUserId,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "uat_script",
      entityId: row.id,
      entityLabel: `UAT Script: ${scriptCode}`,
      actorUserId,
      changesJson: JSON.stringify({ scriptCode, targetRole, module }),
    });

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /uat-scripts/:id — script with full steps
router.get("/uat-scripts/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.select().from(uatScriptsTable).where(eq(uatScriptsTable.id, id));
    if (!row) return void res.status(404).json({ error: "UAT script not found" });

    const steps = row.stepsJson ? JSON.parse(row.stepsJson) : [];
    res.json({ ...row, steps });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /uat-scripts/:id
router.patch("/uat-scripts/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(uatScriptsTable).where(eq(uatScriptsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "UAT script not found" });

    const updates: Record<string, any> = { updatedAt: new Date() };
    const allowedFields = ["titleEn", "titleAr", "estimatedMinutes", "prerequisitesEn", "stepsJson", "acceptanceCriteriaJson", "relatedGateCodes", "isActive", "version"];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = (field === "stepsJson" || field === "acceptanceCriteriaJson") && typeof req.body[field] !== "string"
          ? JSON.stringify(req.body[field])
          : req.body[field];
      }
    }

    const [updated] = await db
      .update(uatScriptsTable)
      .set(updates)
      .where(eq(uatScriptsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "patch",
      entityType: "uat_script",
      entityId: id,
      entityLabel: `UAT Script: ${existing.scriptCode}`,
      actorUserId,
      changesJson: JSON.stringify(updates),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /uat-scripts/:id — soft delete
router.delete("/uat-scripts/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(uatScriptsTable).where(eq(uatScriptsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "UAT script not found" });

    const [updated] = await db
      .update(uatScriptsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(uatScriptsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "delete",
      entityType: "uat_script",
      entityId: id,
      entityLabel: `UAT Script Deleted: ${existing.scriptCode}`,
      actorUserId,
      changesJson: JSON.stringify({ scriptCode: existing.scriptCode }),
    });

    res.json({ deleted: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UAT TEST RUNS ────────────────────────────────────────────────────────────

// GET /uat-test-runs/summary — MUST come before /:id
router.get("/uat-test-runs/summary", async (req, res): Promise<void> => {
  try {
    const runs = await db.select().from(uatTestRunsTable);
    const totalRuns = runs.length;
    const passed = runs.filter((r: any) => r.result === "pass").length;
    const failed = runs.filter((r: any) => r.result === "fail").length;

    // Collect unique roles covered from passed runs
    const scripts = await db.select().from(uatScriptsTable);
    const scriptMap = new Map(scripts.map((s: any) => [s.id, s]));
    const rolesCoveredSet = new Set<string>();
    for (const run of runs.filter((r: any) => r.result === "pass")) {
      const script = scriptMap.get(run.scriptId);
      if (script) rolesCoveredSet.add(script.targetRole);
    }

    res.json({ totalRuns, passed, failed, rolesCovered: Array.from(rolesCoveredSet) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /uat-test-runs — start a run
router.post("/uat-test-runs", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const { scriptId, testerUserId, testerRole, testerNameEn, browserInfo, environment } = req.body;

    if (!scriptId) return void res.status(400).json({ error: "scriptId is required" });

    const [script] = await db.select().from(uatScriptsTable).where(eq(uatScriptsTable.id, scriptId));
    if (!script) return void res.status(404).json({ error: "UAT script not found" });

    const steps = script.stepsJson ? JSON.parse(script.stepsJson) : [];
    const totalSteps = steps.length;

    const [run] = await db
      .insert(uatTestRunsTable)
      .values({
        scriptId,
        testerUserId: testerUserId ?? actorUserId,
        testerRole: testerRole ?? script.targetRole,
        testerNameEn: testerNameEn ?? null,
        result: "in_progress",
        currentStep: 1,
        totalSteps,
        passedSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        environment: environment ?? "pilot",
        browserInfo: browserInfo ?? null,
        startedAt: new Date(),
      })
      .returning();

    // Create step rows
    if (steps.length > 0) {
      await db.insert(uatTestRunStepsTable).values(
        steps.map((step: any) => ({
          runId: run.id,
          stepNumber: step.stepNumber ?? step.step_number ?? 1,
          result: "pending",
          actualResultEn: null,
          defectId: null,
          notes: null,
          executedAt: null,
        }))
      );
    }

    await db.insert(auditLogsTable).values({
      action: "start",
      entityType: "uat_test_run",
      entityId: run.id,
      entityLabel: `UAT Run: script ${scriptId}`,
      actorUserId,
      changesJson: JSON.stringify({ scriptId, totalSteps }),
    });

    res.status(201).json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /uat-test-runs — list runs with optional scriptId filter
router.get("/uat-test-runs", async (req, res): Promise<void> => {
  try {
    const { scriptId } = req.query as Record<string, string>;
    const rows = scriptId
      ? await db.select().from(uatTestRunsTable).where(eq(uatTestRunsTable.scriptId, parseInt(scriptId, 10))).orderBy(desc(uatTestRunsTable.startedAt))
      : await db.select().from(uatTestRunsTable).orderBy(desc(uatTestRunsTable.startedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /uat-test-runs/:id — run with step results
router.get("/uat-test-runs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [run] = await db.select().from(uatTestRunsTable).where(eq(uatTestRunsTable.id, id));
    if (!run) return void res.status(404).json({ error: "UAT test run not found" });

    const steps = await db
      .select()
      .from(uatTestRunStepsTable)
      .where(eq(uatTestRunStepsTable.runId, id))
      .orderBy(uatTestRunStepsTable.stepNumber);

    res.json({ ...run, steps });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /uat-test-runs/:id/steps/:stepNumber — update step result
router.patch("/uat-test-runs/:id/steps/:stepNumber", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const runId = parseInt(req.params.id, 10);
    const stepNumber = parseInt(req.params.stepNumber, 10);
    const { result, actualResultEn, notes, defectId } = req.body;

    if (!result) return void res.status(400).json({ error: "result is required (pass/fail/skip)" });

    const [run] = await db.select().from(uatTestRunsTable).where(eq(uatTestRunsTable.id, runId));
    if (!run) return void res.status(404).json({ error: "UAT test run not found" });

    const [step] = await db
      .update(uatTestRunStepsTable)
      .set({
        result,
        actualResultEn: actualResultEn ?? null,
        notes: notes ?? null,
        defectId: defectId ?? null,
        executedAt: new Date(),
      })
      .where(and(
        eq(uatTestRunStepsTable.runId, runId),
        eq(uatTestRunStepsTable.stepNumber, stepNumber)
      ))
      .returning();

    if (!step) return void res.status(404).json({ error: "Step not found" });

    // Update run counters
    const allSteps = await db.select().from(uatTestRunStepsTable).where(eq(uatTestRunStepsTable.runId, runId));
    const passedSteps = allSteps.filter((s: any) => s.result === "pass").length;
    const failedSteps = allSteps.filter((s: any) => s.result === "fail").length;
    const skippedSteps = allSteps.filter((s: any) => s.result === "skip").length;
    const nextStep = Math.min(stepNumber + 1, run.totalSteps);

    await db
      .update(uatTestRunsTable)
      .set({ passedSteps, failedSteps, skippedSteps, currentStep: nextStep, updatedAt: new Date() } as any)
      .where(eq(uatTestRunsTable.id, runId));

    // Handle defect creation note
    let raisedDefectIds = run.raisedDefectIds ? JSON.parse(run.raisedDefectIds) : [];
    if (defectId && !raisedDefectIds.includes(defectId)) {
      raisedDefectIds.push(defectId);
      await db
        .update(uatTestRunsTable)
        .set({ raisedDefectIds: JSON.stringify(raisedDefectIds) } as any)
        .where(eq(uatTestRunsTable.id, runId));
    }

    res.json(step);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /uat-test-runs/:id/complete — finalize run
router.post("/uat-test-runs/:id/complete", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);

    const [run] = await db.select().from(uatTestRunsTable).where(eq(uatTestRunsTable.id, id));
    if (!run) return void res.status(404).json({ error: "UAT test run not found" });

    const allSteps = await db.select().from(uatTestRunStepsTable).where(eq(uatTestRunStepsTable.runId, id));
    const passedSteps = allSteps.filter((s: any) => s.result === "pass").length;
    const failedSteps = allSteps.filter((s: any) => s.result === "fail").length;
    const skippedSteps = allSteps.filter((s: any) => s.result === "skip").length;

    // Calculate overall result
    let overallResult: string;
    if (failedSteps > 0) {
      overallResult = "fail";
    } else if (skippedSteps > 0 && passedSteps > 0) {
      overallResult = "partial";
    } else if (passedSteps === run.totalSteps) {
      overallResult = "pass";
    } else {
      overallResult = "partial";
    }

    const now = new Date();
    const [updated] = await db
      .update(uatTestRunsTable)
      .set({
        result: overallResult,
        passedSteps,
        failedSteps,
        skippedSteps,
        completedAt: now,
        overallNotes: req.body.overallNotes ?? null,
      } as any)
      .where(eq(uatTestRunsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "complete",
      entityType: "uat_test_run",
      entityId: id,
      entityLabel: `UAT Run Complete: ${overallResult}`,
      actorUserId,
      changesJson: JSON.stringify({ overallResult, passedSteps, failedSteps, skippedSteps }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
