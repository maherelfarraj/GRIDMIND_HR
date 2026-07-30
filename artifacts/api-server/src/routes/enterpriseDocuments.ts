import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  enterpriseDocumentsTable,
  documentCategoriesTable,
  documentVersionsTable,
  documentAccessLogsTable,
  documentAcknowledgementsTable,
  auditLogsTable,
} from "@workspace/db";

const router = Router();

// GET / — list
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { categoryId, employeeId, classificationLevel, status, scope } = req.query as Record<string, string>;

    const conditions = [];
    if (categoryId) conditions.push(eq(enterpriseDocumentsTable.categoryId, parseInt(categoryId)));
    if (employeeId) conditions.push(eq(enterpriseDocumentsTable.employeeId, parseInt(employeeId)));
    if (classificationLevel) conditions.push(eq(enterpriseDocumentsTable.classificationLevel, classificationLevel));
    if (status) conditions.push(eq(enterpriseDocumentsTable.status, status));
    if (scope) conditions.push(eq(enterpriseDocumentsTable.scope, scope));

    const [{ count }] = conditions.length > 0
      ? await db.select({ count: sql<number>`count(*)` }).from(enterpriseDocumentsTable).where(and(...conditions))
      : await db.select({ count: sql<number>`count(*)` }).from(enterpriseDocumentsTable);

    const rows = conditions.length > 0
      ? await db.select().from(enterpriseDocumentsTable).where(and(...conditions)).orderBy(desc(enterpriseDocumentsTable.createdAt)).limit(limit).offset(offset)
      : await db.select().from(enterpriseDocumentsTable).orderBy(desc(enterpriseDocumentsTable.createdAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — create doc record
router.post("/", async (req, res): Promise<void> => {
  try {
    const documentNumber = "DOC-" + Date.now();
    const userId = (req as any).session?.userId ?? null;
    const [row] = await db.insert(enterpriseDocumentsTable).values({
      ...req.body,
      documentNumber,
      uploadedByUserId: userId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "enterprise_document", entityId: row.id, entityLabel: documentNumber, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get single + include category name
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [doc] = await db.select().from(enterpriseDocumentsTable).where(eq(enterpriseDocumentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }
    const [cat] = await db.select().from(documentCategoriesTable).where(eq(documentCategoriesTable.id, doc.categoryId));
    res.json({ ...doc, categoryNameEn: cat?.nameEn ?? null, categoryNameAr: cat?.nameAr ?? null });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.update(enterpriseDocumentsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(enterpriseDocumentsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "enterprise_document", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id/versions — list versions
router.get("/:id/versions", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const versions = await db.select().from(documentVersionsTable)
      .where(eq(documentVersionsTable.documentId, id))
      .orderBy(desc(documentVersionsTable.uploadedAt));
    res.json(versions);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/versions — insert new version (bump currentVersionNumber)
router.post("/:id/versions", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [doc] = await db.select().from(enterpriseDocumentsTable).where(eq(enterpriseDocumentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Bump version number
    const currentVer = parseFloat(doc.currentVersionNumber) || 1.0;
    const newVer = (currentVer + 0.1).toFixed(1);

    // Mark previous versions as not current
    await db.update(documentVersionsTable)
      .set({ isCurrentVersion: false })
      .where(eq(documentVersionsTable.documentId, id));

    const userId = (req as any).session?.userId ?? null;
    const [version] = await db.insert(documentVersionsTable).values({
      ...req.body,
      documentId: id,
      versionNumber: newVer,
      uploadedByUserId: userId,
      isCurrentVersion: true,
    }).returning();

    // Update document's current version reference
    await db.update(enterpriseDocumentsTable)
      .set({ currentVersionId: version.id, currentVersionNumber: newVer, updatedAt: new Date() })
      .where(eq(enterpriseDocumentsTable.id, id));

    res.status(201).json(version);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id/access-logs — list access events paginated
router.get("/:id/access-logs", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(documentAccessLogsTable).where(eq(documentAccessLogsTable.documentId, id));
    const rows = await db.select().from(documentAccessLogsTable)
      .where(eq(documentAccessLogsTable.documentId, id))
      .orderBy(desc(documentAccessLogsTable.accessedAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/acknowledge — insert DocumentAcknowledgement
router.post("/:id/acknowledge", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const userId = (req as any).session?.userId ?? 0;
    const [ack] = await db.insert(documentAcknowledgementsTable).values({
      documentId: id,
      employeeId: userId,
      status: "acknowledged",
      acknowledgedAt: new Date(),
    }).returning();
    // Increment acknowledgedCount
    await db.update(enterpriseDocumentsTable)
      .set({ acknowledgedCount: sql`${enterpriseDocumentsTable.acknowledgedCount} + 1`, updatedAt: new Date() })
      .where(eq(enterpriseDocumentsTable.id, id));
    res.status(201).json(ack);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/legal-hold
router.post("/:id/legal-hold", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const userId = (req as any).session?.userId ?? null;
    const { reason } = req.body;
    const [row] = await db.update(enterpriseDocumentsTable)
      .set({
        isOnLegalHold: true,
        legalHoldReason: reason ?? null,
        legalHoldPlacedAt: new Date(),
        legalHoldPlacedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(eq(enterpriseDocumentsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "legal_hold", entityType: "enterprise_document", entityId: id, changesJson: JSON.stringify({ reason }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/remove-legal-hold
router.post("/:id/remove-legal-hold", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.update(enterpriseDocumentsTable)
      .set({ isOnLegalHold: false, updatedAt: new Date() })
      .where(eq(enterpriseDocumentsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "remove_legal_hold", entityType: "enterprise_document", entityId: id, changesJson: JSON.stringify({}) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id/download — insert access log, return storagePath + fileName
router.get("/:id/download", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const userId = (req as any).session?.userId ?? 0;

    const [doc] = await db.select().from(enterpriseDocumentsTable).where(eq(enterpriseDocumentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    // Get current version
    let storagePath: string | null = null;
    let fileName: string | null = null;
    if (doc.currentVersionId) {
      const [ver] = await db.select().from(documentVersionsTable)
        .where(eq(documentVersionsTable.id, doc.currentVersionId));
      if (ver) { storagePath = ver.storagePath; fileName = ver.fileName; }
    }

    // Insert access log
    await db.insert(documentAccessLogsTable).values({
      documentId: id,
      versionId: doc.currentVersionId ?? null,
      userId,
      action: "download",
      outcome: "allowed",
    });

    res.json({ storagePath, fileName });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
