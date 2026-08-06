import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import {
  db,
  pilotAccountsTable,
  pilotScenariosTable,
  pilotScenarioProgressTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /pilot/accounts — list active pilot accounts
// ─────────────────────────────────────────────────────────────────────────────
router.get("/pilot/accounts", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(pilotAccountsTable)
      .where(eq(pilotAccountsTable.isActive, true))
      .orderBy(pilotAccountsTable.sortOrder);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /pilot/accounts — create/upsert a pilot account
// ─────────────────────────────────────────────────────────────────────────────
router.post("/pilot/accounts", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const { persona, labelEn, labelAr, systemUsername, roleType, descriptionEn, descriptionAr, permittedPathsJson, sortOrder } = req.body;

    if (!persona) return void res.status(400).json({ error: "persona is required" });
    if (!labelEn) return void res.status(400).json({ error: "labelEn is required" });
    if (!labelAr) return void res.status(400).json({ error: "labelAr is required" });
    if (!systemUsername) return void res.status(400).json({ error: "systemUsername is required" });
    if (!roleType) return void res.status(400).json({ error: "roleType is required" });

    const [row] = await db
      .insert(pilotAccountsTable)
      .values({
        persona,
        labelEn,
        labelAr,
        systemUsername,
        roleType,
        descriptionEn: descriptionEn ?? null,
        descriptionAr: descriptionAr ?? null,
        permittedPathsJson: permittedPathsJson ? JSON.stringify(permittedPathsJson) : null,
        isActive: true,
        sortOrder: sortOrder ?? 0,
      })
      .onConflictDoUpdate({
        target: pilotAccountsTable.persona,
        set: {
          labelEn,
          labelAr,
          systemUsername,
          roleType,
          descriptionEn: descriptionEn ?? null,
          descriptionAr: descriptionAr ?? null,
          permittedPathsJson: permittedPathsJson ? JSON.stringify(permittedPathsJson) : null,
          sortOrder: sortOrder ?? 0,
        },
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "upsert",
      entityType: "pilot_account",
      entityId: row.id,
      entityLabel: `Pilot account: ${persona}`,
      actorUserId,
      changesJson: JSON.stringify({ persona, labelEn, roleType }),
    });

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pilot/scenarios — list active scenarios
// ─────────────────────────────────────────────────────────────────────────────
router.get("/pilot/scenarios", async (req, res): Promise<void> => {
  try {
    const { category } = req.query as Record<string, string>;
    const rows = category
      ? await db.select().from(pilotScenariosTable).where(and(eq(pilotScenariosTable.isActive, true), eq(pilotScenariosTable.category, category))).orderBy(pilotScenariosTable.sortOrder)
      : await db.select().from(pilotScenariosTable).where(eq(pilotScenariosTable.isActive, true)).orderBy(pilotScenariosTable.sortOrder);
    res.json(rows.map((r) => ({ ...r, steps: JSON.parse(r.stepsJson ?? "[]") })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pilot/scenarios/:id — get scenario with steps parsed
// ─────────────────────────────────────────────────────────────────────────────
router.get("/pilot/scenarios/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.select().from(pilotScenariosTable).where(eq(pilotScenariosTable.id, id));
    if (!row) return void res.status(404).json({ error: "Scenario not found" });
    res.json({ ...row, steps: JSON.parse(row.stepsJson ?? "[]") });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /pilot/scenarios — create scenario
// ─────────────────────────────────────────────────────────────────────────────
router.post("/pilot/scenarios", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const {
      scenarioCode, titleEn, titleAr, descriptionEn, descriptionAr,
      category, applicableTo, estimatedMinutes, stepsJson, targetPersonas, sortOrder,
    } = req.body;

    if (!scenarioCode) return void res.status(400).json({ error: "scenarioCode is required" });
    if (!titleEn) return void res.status(400).json({ error: "titleEn is required" });
    if (!titleAr) return void res.status(400).json({ error: "titleAr is required" });

    const [row] = await db
      .insert(pilotScenariosTable)
      .values({
        scenarioCode,
        titleEn,
        titleAr,
        descriptionEn: descriptionEn ?? null,
        descriptionAr: descriptionAr ?? null,
        category: category ?? "general",
        applicableTo: applicableTo ?? "all",
        estimatedMinutes: estimatedMinutes ?? 15,
        stepsJson: Array.isArray(stepsJson) ? JSON.stringify(stepsJson) : (stepsJson ?? "[]"),
        targetPersonas: targetPersonas ?? null,
        isActive: true,
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "pilot_scenario",
      entityId: row.id,
      entityLabel: `Pilot scenario: ${scenarioCode}`,
      actorUserId,
      changesJson: JSON.stringify({ scenarioCode, titleEn, category }),
    });

    res.status(201).json({ ...row, steps: JSON.parse(row.stepsJson ?? "[]") });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /pilot/progress/:scenarioId/start — create/update progress row
// ─────────────────────────────────────────────────────────────────────────────
router.post("/pilot/progress/:scenarioId/start", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const scenarioId = parseInt(req.params.scenarioId, 10);

    const [scenario] = await db.select().from(pilotScenariosTable).where(eq(pilotScenariosTable.id, scenarioId));
    if (!scenario) return void res.status(404).json({ error: "Scenario not found" });

    // Check if progress exists
    const existing = await db
      .select()
      .from(pilotScenarioProgressTable)
      .where(and(eq(pilotScenarioProgressTable.scenarioId, scenarioId), eq(pilotScenarioProgressTable.userId, actorUserId)))
      .limit(1);

    let row;
    if (existing.length > 0) {
      const [updated] = await db
        .update(pilotScenarioProgressTable)
        .set({ status: "in_progress", startedAt: new Date(), currentStep: 1 })
        .where(eq(pilotScenarioProgressTable.id, existing[0].id))
        .returning();
      row = updated;
    } else {
      const [created] = await db
        .insert(pilotScenarioProgressTable)
        .values({
          scenarioId,
          userId: actorUserId,
          status: "in_progress",
          currentStep: 1,
          startedAt: new Date(),
        })
        .returning();
      row = created;
    }

    await db.insert(auditLogsTable).values({
      action: "start",
      entityType: "pilot_scenario_progress",
      entityId: row.id,
      entityLabel: `Pilot scenario started: ${scenario.scenarioCode}`,
      actorUserId,
      changesJson: JSON.stringify({ scenarioId, status: "in_progress" }),
    });

    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /pilot/progress/:scenarioId/advance — increment currentStep
// ─────────────────────────────────────────────────────────────────────────────
router.post("/pilot/progress/:scenarioId/advance", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const scenarioId = parseInt(req.params.scenarioId, 10);

    const [progress] = await db
      .select()
      .from(pilotScenarioProgressTable)
      .where(and(eq(pilotScenarioProgressTable.scenarioId, scenarioId), eq(pilotScenarioProgressTable.userId, actorUserId)))
      .limit(1);

    if (!progress) return void res.status(404).json({ error: "Progress not found. Start the scenario first." });

    const [scenario] = await db.select().from(pilotScenariosTable).where(eq(pilotScenariosTable.id, scenarioId));
    const steps = JSON.parse(scenario?.stepsJson ?? "[]");
    const maxStep = steps.length || 1;
    const nextStep = Math.min(progress.currentStep + 1, maxStep);

    const [updated] = await db
      .update(pilotScenarioProgressTable)
      .set({ currentStep: nextStep })
      .where(eq(pilotScenarioProgressTable.id, progress.id))
      .returning();

    res.json({ ...updated, maxStep });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /pilot/progress/:scenarioId/complete — mark complete
// ─────────────────────────────────────────────────────────────────────────────
router.post("/pilot/progress/:scenarioId/complete", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const scenarioId = parseInt(req.params.scenarioId, 10);

    const [progress] = await db
      .select()
      .from(pilotScenarioProgressTable)
      .where(and(eq(pilotScenarioProgressTable.scenarioId, scenarioId), eq(pilotScenarioProgressTable.userId, actorUserId)))
      .limit(1);

    if (!progress) return void res.status(404).json({ error: "Progress not found. Start the scenario first." });

    const [updated] = await db
      .update(pilotScenarioProgressTable)
      .set({ status: "complete", completedAt: new Date() })
      .where(eq(pilotScenarioProgressTable.id, progress.id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "complete",
      entityType: "pilot_scenario_progress",
      entityId: updated.id,
      entityLabel: `Pilot scenario completed: scenarioId=${scenarioId}`,
      actorUserId,
      changesJson: JSON.stringify({ scenarioId, status: "complete" }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pilot/progress — get all progress for current user
// ─────────────────────────────────────────────────────────────────────────────
router.get("/pilot/progress", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const rows = await db
      .select()
      .from(pilotScenarioProgressTable)
      .where(eq(pilotScenarioProgressTable.userId, actorUserId))
      .orderBy(desc(pilotScenarioProgressTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /pilot/reset — delete all progress rows for actorUserId
// ─────────────────────────────────────────────────────────────────────────────
router.post("/pilot/reset", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);

    const deleted = await db
      .delete(pilotScenarioProgressTable)
      .where(eq(pilotScenarioProgressTable.userId, actorUserId))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "reset",
      entityType: "pilot_scenario_progress",
      entityId: null,
      entityLabel: `Pilot progress reset for user ${actorUserId}`,
      actorUserId,
      changesJson: JSON.stringify({ deletedCount: deleted.length }),
    });

    res.json({ deleted: deleted.length, simulated: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
