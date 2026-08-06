import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  pilotDefectsTable,
  auditLogsTable,
} from "@workspace/db";

const router = Router();

// ─── GET /pilot-defects/blockers — MUST come before /:id ──────────────────────
router.get("/pilot-defects/blockers", async (req, res): Promise<void> => {
  try {
    const blockers = await db
      .select()
      .from(pilotDefectsTable)
      .where(eq(pilotDefectsTable.isGoLiveBlocker, true))
      .orderBy(pilotDefectsTable.severity, desc(pilotDefectsTable.reportedAt));
    res.json(blockers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /pilot-defects — list with optional filters ──────────────────────────
router.get("/pilot-defects", async (req, res): Promise<void> => {
  try {
    const { module, severity, status, isBlocker } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (module) conditions.push(eq(pilotDefectsTable.module, module));
    if (severity) conditions.push(eq(pilotDefectsTable.severity, severity));
    if (status) conditions.push(eq(pilotDefectsTable.status, status));
    if (isBlocker !== undefined) {
      conditions.push(eq(pilotDefectsTable.isGoLiveBlocker, isBlocker === "true"));
    }

    const rows = conditions.length
      ? await db.select().from(pilotDefectsTable).where(and(...conditions)).orderBy(desc(pilotDefectsTable.reportedAt))
      : await db.select().from(pilotDefectsTable).orderBy(desc(pilotDefectsTable.reportedAt));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /pilot-defects — create defect ──────────────────────────────────────
router.post("/pilot-defects", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const { module, titleEn, titleAr, descriptionEn, stepsToReproduce, severity, isGoLiveBlocker, relatedGateCode, sourceTestCode, assignedToUserId } = req.body;

    if (!module) return void res.status(400).json({ error: "module is required" });
    if (!titleEn) return void res.status(400).json({ error: "titleEn is required" });

    // Auto-generate defect code: DEF-{NNN}
    const existing = await db.select({ id: pilotDefectsTable.id }).from(pilotDefectsTable);
    const nextNum = existing.length + 1;
    const defectCode = `DEF-${String(nextNum).padStart(3, "0")}`;

    const [row] = await db
      .insert(pilotDefectsTable)
      .values({
        defectCode,
        module,
        titleEn,
        titleAr: titleAr ?? null,
        descriptionEn: descriptionEn ?? null,
        stepsToReproduce: stepsToReproduce ?? null,
        severity: severity ?? "medium",
        status: "open",
        isGoLiveBlocker: isGoLiveBlocker ?? false,
        relatedGateCode: relatedGateCode ?? null,
        sourceTestCode: sourceTestCode ?? null,
        assignedToUserId: assignedToUserId ?? null,
        reportedByUserId: actorUserId,
        reportedAt: new Date(),
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "pilot_defect",
      entityId: row.id,
      entityLabel: `Defect: ${defectCode}`,
      actorUserId,
      changesJson: JSON.stringify({ defectCode, module, titleEn, severity }),
    });

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /pilot-defects/:id ────────────────────────────────────────────────────
router.get("/pilot-defects/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.select().from(pilotDefectsTable).where(eq(pilotDefectsTable.id, id));
    if (!row) return void res.status(404).json({ error: "Defect not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /pilot-defects/:id — update status/assignment/notes ────────────────
router.patch("/pilot-defects/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(pilotDefectsTable).where(eq(pilotDefectsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Defect not found" });

    const allowedFields = ["status", "severity", "assignedToUserId", "titleEn", "titleAr", "descriptionEn", "stepsToReproduce", "isGoLiveBlocker", "relatedGateCode"];
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const [updated] = await db
      .update(pilotDefectsTable)
      .set(updates)
      .where(eq(pilotDefectsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "patch",
      entityType: "pilot_defect",
      entityId: id,
      entityLabel: `Defect: ${existing.defectCode}`,
      actorUserId,
      changesJson: JSON.stringify(updates),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /pilot-defects/:id/resolve ──────────────────────────────────────────
router.post("/pilot-defects/:id/resolve", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(pilotDefectsTable).where(eq(pilotDefectsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Defect not found" });

    const now = new Date();
    const [updated] = await db
      .update(pilotDefectsTable)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolvedByUserId: actorUserId,
        resolutionNotes: req.body.resolutionNotes ?? null,
        updatedAt: now,
      })
      .where(eq(pilotDefectsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "resolve",
      entityType: "pilot_defect",
      entityId: id,
      entityLabel: `Defect Resolved: ${existing.defectCode}`,
      actorUserId,
      changesJson: JSON.stringify({ resolutionNotes: req.body.resolutionNotes }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /pilot-defects/:id/verify ───────────────────────────────────────────
router.post("/pilot-defects/:id/verify", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(pilotDefectsTable).where(eq(pilotDefectsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Defect not found" });

    const now = new Date();
    const [updated] = await db
      .update(pilotDefectsTable)
      .set({
        status: "verified",
        verifiedAt: now,
        verifiedByUserId: actorUserId,
        updatedAt: now,
      })
      .where(eq(pilotDefectsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "verify",
      entityType: "pilot_defect",
      entityId: id,
      entityLabel: `Defect Verified: ${existing.defectCode}`,
      actorUserId,
      changesJson: JSON.stringify({ verifiedByUserId: actorUserId }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
