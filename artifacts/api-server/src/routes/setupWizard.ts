import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { db, setupWizardProgressTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /setup/wizard — return current progress (or create default if none)
router.get("/setup/wizard", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(setupWizardProgressTable).limit(1);
    if (rows.length > 0) {
      const row = rows[0];
      return void res.json({
        ...row,
        completedSteps: JSON.parse(row.completedStepsJson ?? "[]"),
        answers: JSON.parse(row.answersJson ?? "{}"),
      });
    }

    // Create default row
    const [created] = await db
      .insert(setupWizardProgressTable)
      .values({
        instanceId: "default",
        currentStep: "org_profile",
        completedStepsJson: "[]",
        isComplete: false,
        answersJson: "{}",
      })
      .returning();

    res.status(201).json({
      ...created,
      completedSteps: [],
      answers: {},
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /setup/wizard — update currentStep, completedSteps, answersJson
router.patch("/setup/wizard", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) {
      res.status(403).json({ error: "Insufficient privileges to update setup wizard" });
      return;
    }
    const { currentStep, completedSteps, answersJson } = req.body;

    const rows = await db.select().from(setupWizardProgressTable).limit(1);
    let wizardId: number;

    if (rows.length === 0) {
      const [created] = await db
        .insert(setupWizardProgressTable)
        .values({
          instanceId: "default",
          currentStep: currentStep ?? "org_profile",
          completedStepsJson: completedSteps ? JSON.stringify(completedSteps) : "[]",
          isComplete: false,
          answersJson: answersJson ? JSON.stringify(answersJson) : "{}",
        })
        .returning();
      wizardId = created.id;
    } else {
      wizardId = rows[0].id;
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (currentStep !== undefined) updateData.currentStep = currentStep;
    if (completedSteps !== undefined) updateData.completedStepsJson = JSON.stringify(completedSteps);
    if (answersJson !== undefined) updateData.answersJson = JSON.stringify(answersJson);

    const [updated] = await db
      .update(setupWizardProgressTable)
      .set(updateData)
      .where(eq(setupWizardProgressTable.id, wizardId))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "update",
      entityType: "setup_wizard_progress",
      entityId: wizardId,
      entityLabel: `Setup Wizard step: ${updated.currentStep}`,
      actorUserId,
      changesJson: JSON.stringify({ currentStep, completedSteps, answersJson }),
    });

    res.json({
      ...updated,
      completedSteps: JSON.parse(updated.completedStepsJson ?? "[]"),
      answers: JSON.parse(updated.answersJson ?? "{}"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /setup/wizard/complete — mark isComplete=true
router.post("/setup/wizard/complete", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) {
      res.status(403).json({ error: "Insufficient privileges to complete setup wizard" });
      return;
    }

    const rows = await db.select().from(setupWizardProgressTable).limit(1);
    if (rows.length === 0) {
      return void res.status(404).json({ error: "Wizard progress not found" });
    }

    const [updated] = await db
      .update(setupWizardProgressTable)
      .set({
        isComplete: true,
        completedAt: new Date(),
        completedByUserId: actorUserId,
        currentStep: "complete",
        updatedAt: new Date(),
      })
      .where(eq(setupWizardProgressTable.id, rows[0].id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "complete",
      entityType: "setup_wizard_progress",
      entityId: updated.id,
      entityLabel: "Setup Wizard completed",
      actorUserId,
      changesJson: JSON.stringify({ isComplete: true }),
    });

    res.json({
      ...updated,
      completedSteps: JSON.parse(updated.completedStepsJson ?? "[]"),
      answers: JSON.parse(updated.answersJson ?? "{}"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /setup/wizard/reset — reset to initial state
router.post("/setup/wizard/reset", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) {
      res.status(403).json({ error: "Insufficient privileges to reset setup wizard" });
      return;
    }

    const rows = await db.select().from(setupWizardProgressTable).limit(1);
    if (rows.length === 0) {
      return void res.status(404).json({ error: "Wizard progress not found" });
    }

    const [updated] = await db
      .update(setupWizardProgressTable)
      .set({
        currentStep: "org_profile",
        completedStepsJson: "[]",
        isComplete: false,
        completedAt: null,
        completedByUserId: null,
        answersJson: "{}",
        updatedAt: new Date(),
      })
      .where(eq(setupWizardProgressTable.id, rows[0].id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "reset",
      entityType: "setup_wizard_progress",
      entityId: updated.id,
      entityLabel: "Setup Wizard reset",
      actorUserId,
      changesJson: JSON.stringify({ reset: true }),
    });

    res.json({
      ...updated,
      completedSteps: [],
      answers: {},
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
