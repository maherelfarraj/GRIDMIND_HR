import { Router } from "express";
import { eq, and, asc, sql } from "drizzle-orm";
import { db, reportDefinitionsTable, reportOutputsTable, auditLogsTable } from "@workspace/db";
import { CreateReportDefinitionBody, UpdateReportDefinitionBody } from "@workspace/api-zod";
import { validateBody } from "../middleware/validateBody.js";
import { getActorUserId } from "../middleware/requireAuth.js";

const router = Router();

// GET / — list sorted by nameEn
router.get("/", async (req, res): Promise<void> => {
  try {
    const { reportType, isSystemReport } = req.query as Record<string, string>;
    const conditions = [];
    if (reportType) conditions.push(eq(reportDefinitionsTable.reportType, reportType));
    if (isSystemReport !== undefined) conditions.push(eq(reportDefinitionsTable.isSystemReport, isSystemReport === "true"));

    const rows = conditions.length > 0
      ? await db.select().from(reportDefinitionsTable).where(and(...conditions)).orderBy(asc(reportDefinitionsTable.nameEn))
      : await db.select().from(reportDefinitionsTable).orderBy(asc(reportDefinitionsTable.nameEn));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create (set isSystemReport:false for user-created)
router.post("/", validateBody(CreateReportDefinitionBody), async (req, res): Promise<void> => {
  try {
    const userId = getActorUserId(req);
    const [row] = await db.insert(reportDefinitionsTable).values({
      ...req.body,
      isSystemReport: false,
      createdByUserId: userId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "report_definition", entityId: row.id, actorUserId: userId, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(reportDefinitionsTable)
      .where(eq(reportDefinitionsTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update (block if isSystemReport and trying to change reportType)
router.patch("/:id", validateBody(UpdateReportDefinitionBody), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(reportDefinitionsTable).where(eq(reportDefinitionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (existing.isSystemReport && req.body.reportType && req.body.reportType !== existing.reportType) {
      res.status(400).json({ error: "Cannot change reportType of a system report" });
      return;
    }

    const [row] = await db.update(reportDefinitionsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(reportDefinitionsTable.id, id))
      .returning();
    const patchUserId = getActorUserId(req);
    await db.insert(auditLogsTable).values({ action: "update", entityType: "report_definition", entityId: row.id, actorUserId: patchUserId, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/run — run report and produce output
router.post("/:id/run", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const [def] = await db.select().from(reportDefinitionsTable).where(eq(reportDefinitionsTable.id, id));
    if (!def) { res.status(404).json({ error: "Report definition not found" }); return; }

    const userId = getActorUserId(req);
    const { filtersJson, exportFormat, language } = req.body;
    const fmt = exportFormat ?? "pdf";
    const now = new Date();

    // Insert pending output
    const [output] = await db.insert(reportOutputsTable).values({
      reportDefinitionId: id,
      generatedByUserId: userId,
      filtersJson: filtersJson ? JSON.stringify(filtersJson) : null,
      outputFormat: fmt,
      language: language ?? "en",
      status: "pending",
      generationStartedAt: now,
    }).returning();

    // Simulate immediate completion
    const rowCount = Math.floor(Math.random() * 500) + 1;
    const storagePath = "/reports/" + Date.now() + "." + fmt;
    const fileName = def.nameEn.replace(/\s+/g, "_") + "_" + Date.now() + "." + fmt;

    const [completed] = await db.update(reportOutputsTable)
      .set({
        status: "ready",
        generationCompletedAt: new Date(),
        rowCount,
        storagePath,
        fileName,
      })
      .where(eq(reportOutputsTable.id, output.id))
      .returning();

    await db.insert(auditLogsTable).values({ action: "run", entityType: "report_definition", entityId: id, actorUserId: userId, changesJson: JSON.stringify({ exportFormat: fmt, language, rowCount }) });
    res.status(201).json({ ...completed, simulated: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
