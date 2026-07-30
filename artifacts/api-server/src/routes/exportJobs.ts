import { Router } from "express";
import { db, exportJobsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /export-jobs — list with optional filters: status, jobType
router.get("/export-jobs", async (req, res): Promise<void> => {
  try {
    const { status, jobType } = req.query;

    let rows = await db.select().from(exportJobsTable).orderBy(exportJobsTable.createdAt);

    if (status) rows = rows.filter(r => r.status === status);
    if (jobType) rows = rows.filter(r => r.jobType === jobType);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /export-jobs/:id
router.get("/export-jobs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(exportJobsTable).where(eq(exportJobsTable.id, id));
    if (!row) return void res.status(404).json({ error: "Export job not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /export-jobs/:id/retry — re-queue a failed job
router.post("/export-jobs/:id/retry", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(exportJobsTable).where(eq(exportJobsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Export job not found" });
    if (existing.status !== "failed") {
      return void res.status(400).json({ error: `Cannot retry job with status '${existing.status}'. Only 'failed' jobs can be retried.` });
    }

    const [updated] = await db
      .update(exportJobsTable)
      .set({ status: "queued", errorMessage: null, startedAt: null, completedAt: null })
      .where(eq(exportJobsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /export-jobs/:id — cancel queued job
router.delete("/export-jobs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(exportJobsTable).where(eq(exportJobsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Export job not found" });
    if (existing.status !== "queued") {
      return void res.status(400).json({ error: `Can only cancel 'queued' jobs. Current status: '${existing.status}'` });
    }

    await db.delete(exportJobsTable).where(eq(exportJobsTable.id, id));
    res.json({ deleted: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
