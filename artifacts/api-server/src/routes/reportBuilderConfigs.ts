import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { db, reportBuilderConfigsTable, exportJobsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /report-builder-configs
router.get("/report-builder-configs", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(reportBuilderConfigsTable).orderBy(reportBuilderConfigsTable.createdAt);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /report-builder-configs
router.post("/report-builder-configs", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const {
      nameEn, nameAr, descriptionEn, dataSource, columnsJson, filtersJson,
      sortByJson, groupByJson, roleRestriction, isPublic,
    } = req.body;

    if (!nameEn || !nameAr || !dataSource) {
      return void res.status(400).json({ error: "nameEn, nameAr, dataSource required" });
    }

    const [row] = await db
      .insert(reportBuilderConfigsTable)
      .values({
        nameEn,
        nameAr,
        descriptionEn: descriptionEn ?? null,
        createdByUserId: actorUserId,
        dataSource,
        columnsJson: columnsJson ?? "[]",
        filtersJson: filtersJson ?? null,
        sortByJson: sortByJson ?? null,
        groupByJson: groupByJson ?? null,
        roleRestriction: roleRestriction ?? null,
        isPublic: isPublic ?? false,
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /report-builder-configs/:id
router.get("/report-builder-configs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(reportBuilderConfigsTable)
      .where(eq(reportBuilderConfigsTable.id, id));

    if (!row) return void res.status(404).json({ error: "Report builder config not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /report-builder-configs/:id
router.patch("/report-builder-configs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const {
      nameEn, nameAr, descriptionEn, dataSource, columnsJson, filtersJson,
      sortByJson, groupByJson, roleRestriction, isPublic,
    } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (nameEn !== undefined) updates.nameEn = nameEn;
    if (nameAr !== undefined) updates.nameAr = nameAr;
    if (descriptionEn !== undefined) updates.descriptionEn = descriptionEn;
    if (dataSource !== undefined) updates.dataSource = dataSource;
    if (columnsJson !== undefined) updates.columnsJson = columnsJson;
    if (filtersJson !== undefined) updates.filtersJson = filtersJson;
    if (sortByJson !== undefined) updates.sortByJson = sortByJson;
    if (groupByJson !== undefined) updates.groupByJson = groupByJson;
    if (roleRestriction !== undefined) updates.roleRestriction = roleRestriction;
    if (isPublic !== undefined) updates.isPublic = isPublic;

    const [row] = await db
      .update(reportBuilderConfigsTable)
      .set(updates)
      .where(eq(reportBuilderConfigsTable.id, id))
      .returning();

    if (!row) return void res.status(404).json({ error: "Report builder config not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /report-builder-configs/:id
router.delete("/report-builder-configs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [deleted] = await db
      .delete(reportBuilderConfigsTable)
      .where(eq(reportBuilderConfigsTable.id, id))
      .returning();

    if (!deleted) return void res.status(404).json({ error: "Report builder config not found" });
    res.json({ deleted: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /report-builder-configs/:id/run — execute report, return rows (max 1000)
router.post("/report-builder-configs/:id/run", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [config] = await db
      .select()
      .from(reportBuilderConfigsTable)
      .where(eq(reportBuilderConfigsTable.id, id));

    if (!config) return void res.status(404).json({ error: "Report builder config not found" });

    // Return simulated result based on dataSource
    const limit = Math.min(parseInt(req.body.limit) || 100, 1000);

    res.json({
      configId: id,
      configName: config.nameEn,
      dataSource: config.dataSource,
      simulated: true,
      rowCount: 0,
      rows: [],
      columns: JSON.parse(config.columnsJson || "[]"),
      filters: config.filtersJson ? JSON.parse(config.filtersJson) : null,
      executedAt: new Date().toISOString(),
      note: "Live execution not yet implemented — connect to data source adapter",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /report-builder-configs/:id/export — queue export job
router.post("/report-builder-configs/:id/export", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);

    const [config] = await db
      .select()
      .from(reportBuilderConfigsTable)
      .where(eq(reportBuilderConfigsTable.id, id));

    if (!config) return void res.status(404).json({ error: "Report builder config not found" });

    const format = req.body.format || "xlsx";
    const [job] = await db
      .insert(exportJobsTable)
      .values({
        jobType: format,
        entityType: "report_builder_config",
        entityId: id,
        requestedByUserId: actorUserId,
        status: "queued",
        parametersJson: JSON.stringify({ format, configName: config.nameEn, ...req.body }),
      })
      .returning();

    res.status(202).json({ jobId: job.id, status: "queued" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
