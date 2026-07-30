import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, documentTemplatesTable, enterpriseDocumentsTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list active templates
router.get("/", async (req, res): Promise<void> => {
  try {
    const { templateType, organizationType } = req.query as Record<string, string>;
    const conditions = [eq(documentTemplatesTable.isActive, true)];
    if (templateType) conditions.push(eq(documentTemplatesTable.templateType, templateType));
    if (organizationType) conditions.push(eq(documentTemplatesTable.organizationType, organizationType));
    const rows = await db.select().from(documentTemplatesTable).where(and(...conditions));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(documentTemplatesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "document_template", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get one
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(documentTemplatesTable)
      .where(eq(documentTemplatesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(documentTemplatesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(documentTemplatesTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "document_template", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/generate — create EnterpriseDocument from template
router.post("/:id/generate", async (req, res): Promise<void> => {
  try {
    const [template] = await db.select().from(documentTemplatesTable)
      .where(eq(documentTemplatesTable.id, parseInt(req.params.id)));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const { employeeId, language, extraFields } = req.body;
    const documentNumber = "DOC-" + Date.now();
    const titleEn = template.nameEn + " — " + (employeeId ?? "unknown");

    const [doc] = await db.insert(enterpriseDocumentsTable).values({
      documentNumber,
      categoryId: template.categoryId ?? 1,
      employeeId: employeeId ? parseInt(employeeId) : null,
      scope: "employee_record",
      titleEn,
      titleAr: template.nameAr + " — " + (employeeId ?? "unknown"),
      classificationLevel: "internal",
      status: "draft",
      uploadedByUserId: (req as any).session?.userId ?? null,
      tagsJson: extraFields ? JSON.stringify(extraFields) : null,
    }).returning();

    await db.insert(auditLogsTable).values({ action: "generate", entityType: "enterprise_document", entityId: doc.id, changesJson: JSON.stringify({ templateId: template.id, employeeId, language }) });
    res.status(201).json(doc);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
