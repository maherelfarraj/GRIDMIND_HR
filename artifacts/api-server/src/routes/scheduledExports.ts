import { Router } from "express";
import { db, scheduledExportsTable, exportJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /scheduled-exports
router.get("/scheduled-exports", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(scheduledExportsTable).orderBy(scheduledExportsTable.createdAt);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /scheduled-exports
router.post("/scheduled-exports", async (req, res): Promise<void> => {
  try {
    const {
      reportBuilderConfigId, nameEn, cronExpression, timezone, format,
      recipientUserIds, isActive, nextRunAt,
    } = req.body;

    if (!nameEn || !cronExpression) {
      return void res.status(400).json({ error: "nameEn and cronExpression are required" });
    }

    const [row] = await db
      .insert(scheduledExportsTable)
      .values({
        reportBuilderConfigId: reportBuilderConfigId ?? null,
        nameEn,
        cronExpression,
        timezone: timezone ?? "Asia/Riyadh",
        format: format ?? "xlsx",
        recipientUserIds: recipientUserIds ? JSON.stringify(recipientUserIds) : null,
        isActive: isActive ?? true,
        nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /scheduled-exports/:id
router.get("/scheduled-exports/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(scheduledExportsTable).where(eq(scheduledExportsTable.id, id));
    if (!row) return void res.status(404).json({ error: "Scheduled export not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /scheduled-exports/:id
router.patch("/scheduled-exports/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const {
      reportBuilderConfigId, nameEn, cronExpression, timezone, format,
      recipientUserIds, isActive, nextRunAt,
    } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (reportBuilderConfigId !== undefined) updates.reportBuilderConfigId = reportBuilderConfigId;
    if (nameEn !== undefined) updates.nameEn = nameEn;
    if (cronExpression !== undefined) updates.cronExpression = cronExpression;
    if (timezone !== undefined) updates.timezone = timezone;
    if (format !== undefined) updates.format = format;
    if (recipientUserIds !== undefined) updates.recipientUserIds = JSON.stringify(recipientUserIds);
    if (isActive !== undefined) updates.isActive = isActive;
    if (nextRunAt !== undefined) updates.nextRunAt = nextRunAt ? new Date(nextRunAt) : null;

    const [row] = await db
      .update(scheduledExportsTable)
      .set(updates)
      .where(eq(scheduledExportsTable.id, id))
      .returning();

    if (!row) return void res.status(404).json({ error: "Scheduled export not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /scheduled-exports/:id
router.delete("/scheduled-exports/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [deleted] = await db
      .delete(scheduledExportsTable)
      .where(eq(scheduledExportsTable.id, id))
      .returning();

    if (!deleted) return void res.status(404).json({ error: "Scheduled export not found" });
    res.json({ deleted: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /scheduled-exports/:id/run-now — manually trigger (creates export_job)
router.post("/scheduled-exports/:id/run-now", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);

    const [schedule] = await db.select().from(scheduledExportsTable).where(eq(scheduledExportsTable.id, id));
    if (!schedule) return void res.status(404).json({ error: "Scheduled export not found" });

    const [job] = await db
      .insert(exportJobsTable)
      .values({
        jobType: schedule.format,
        entityType: "scheduled_export",
        entityId: id,
        requestedByUserId: actorUserId,
        status: "queued",
        parametersJson: JSON.stringify({
          triggeredManually: true,
          scheduledExportId: id,
          scheduleName: schedule.nameEn,
          format: schedule.format,
          reportBuilderConfigId: schedule.reportBuilderConfigId,
        }),
      })
      .returning();

    // Update lastRunAt
    await db
      .update(scheduledExportsTable)
      .set({ lastRunAt: new Date() })
      .where(eq(scheduledExportsTable.id, id));

    res.status(202).json({ jobId: job.id, status: "queued", scheduledExportId: id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
