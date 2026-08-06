import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, desc } from "drizzle-orm";
import {
  db,
  migrationStatusTable,
  auditLogsTable,
} from "@workspace/db";

const router = Router();

// ─── GET /migration-status/summary — MUST come before /:id ────────────────────
router.get("/migration-status/summary", async (req, res): Promise<void> => {
  try {
    const items = await db.select().from(migrationStatusTable);
    const total = items.length;
    const complete = items.filter((i: any) => i.status === "complete").length;
    const incomplete = items.filter((i: any) => i.status !== "complete" && i.status !== "skipped").length;
    const blockers = items.filter((i: any) => i.isGoLiveBlocker && i.status !== "complete").length;

    res.json({
      total,
      complete,
      incomplete,
      blockers,
      byStatus: {
        not_started: items.filter((i: any) => i.status === "not_started").length,
        in_progress: items.filter((i: any) => i.status === "in_progress").length,
        complete: items.filter((i: any) => i.status === "complete").length,
        failed: items.filter((i: any) => i.status === "failed").length,
        skipped: items.filter((i: any) => i.status === "skipped").length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /migration-status — list all items ───────────────────────────────────
router.get("/migration-status", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(migrationStatusTable)
      .orderBy(migrationStatusTable.sortOrder);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /migration-status — create item ─────────────────────────────────────
router.post("/migration-status", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const { migrationCode, titleEn, titleAr, descriptionEn, priority, totalRecords, sourceSystem, isGoLiveBlocker, sortOrder } = req.body;

    if (!migrationCode) return void res.status(400).json({ error: "migrationCode is required" });
    if (!titleEn) return void res.status(400).json({ error: "titleEn is required" });
    if (!titleAr) return void res.status(400).json({ error: "titleAr is required" });

    const [row] = await db
      .insert(migrationStatusTable)
      .values({
        migrationCode,
        titleEn,
        titleAr,
        descriptionEn: descriptionEn ?? null,
        priority: priority ?? "required",
        totalRecords: totalRecords ?? null,
        sourceSystem: sourceSystem ?? null,
        isGoLiveBlocker: isGoLiveBlocker ?? false,
        sortOrder: sortOrder ?? 0,
        status: "not_started",
        migratedRecords: 0,
        failedRecords: 0,
        progressPercent: "0",
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "migration_status",
      entityId: row.id,
      entityLabel: `Migration: ${migrationCode}`,
      actorUserId,
      changesJson: JSON.stringify({ migrationCode, titleEn }),
    });

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /migration-status/:id — update status/progress ────────────────────
router.patch("/migration-status/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(migrationStatusTable).where(eq(migrationStatusTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Migration item not found" });

    const allowedFields = ["status", "migratedRecords", "failedRecords", "progressPercent", "errorSummary", "totalRecords", "isGoLiveBlocker"];
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.status === "in_progress" && !existing.startedAt) {
      updates.startedAt = new Date();
      updates.runByUserId = actorUserId;
    }

    const [updated] = await db
      .update(migrationStatusTable)
      .set(updates)
      .where(eq(migrationStatusTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "patch",
      entityType: "migration_status",
      entityId: id,
      entityLabel: `Migration: ${existing.migrationCode}`,
      actorUserId,
      changesJson: JSON.stringify(updates),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /migration-status/:id/complete — mark complete ──────────────────────
router.post("/migration-status/:id/complete", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(migrationStatusTable).where(eq(migrationStatusTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Migration item not found" });

    const now = new Date();
    const totalRecords = existing.totalRecords ?? req.body.totalRecords ?? 0;
    const migratedRecords = req.body.migratedRecords ?? totalRecords;

    const [updated] = await db
      .update(migrationStatusTable)
      .set({
        status: "complete",
        completedAt: now,
        migratedRecords,
        progressPercent: "100.00",
        errorSummary: req.body.errorSummary ?? null,
        updatedAt: now,
      })
      .where(eq(migrationStatusTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "complete",
      entityType: "migration_status",
      entityId: id,
      entityLabel: `Migration Complete: ${existing.migrationCode}`,
      actorUserId,
      changesJson: JSON.stringify({ migratedRecords, summary: req.body.errorSummary }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
