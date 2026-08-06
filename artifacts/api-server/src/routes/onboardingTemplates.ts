import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc, sql } from "drizzle-orm";
import { db, onboardingTemplatesTable, onboardingTemplateItemsTable, auditLogsTable } from "@workspace/db";
import { CreateOnboardingTemplateBody, UpdateOnboardingTemplateBody } from "@workspace/api-zod";
import { validateBody } from "../middleware/validateBody.js";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(onboardingTemplatesTable);
    const rows = await db.select().from(onboardingTemplatesTable)
      .orderBy(desc(onboardingTemplatesTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", validateBody(CreateOnboardingTemplateBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(onboardingTemplatesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "onboarding_template", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(onboardingTemplatesTable).where(eq(onboardingTemplatesTable.id, parseInt(req.params.id as string)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", validateBody(UpdateOnboardingTemplateBody), async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(onboardingTemplatesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(onboardingTemplatesTable.id, parseInt(req.params.id as string))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "onboarding_template", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id/items", async (req, res): Promise<void> => {
  try {
    const templateId = parseInt(req.params.id as string);
    const rows = await db.select().from(onboardingTemplateItemsTable)
      .where(eq(onboardingTemplateItemsTable.templateId, templateId))
      .orderBy(onboardingTemplateItemsTable.sortOrder);
    res.json({ data: rows, total: rows.length, page: 1, limit: rows.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/:id/items", async (req, res): Promise<void> => {
  try {
    const templateId = parseInt(req.params.id as string);
    const [row] = await db.insert(onboardingTemplateItemsTable).values({ ...req.body, templateId }).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "onboarding_template_item", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
