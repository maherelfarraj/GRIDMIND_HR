import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { db, organizationsTable, organizationBrandingTable, policyLocalesTable, calendarConfigsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /organizations
router.get("/organizations", async (req, res): Promise<void> => {
  try {
    const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.id);
    const brandings = await db.select().from(organizationBrandingTable);
    const brandingMap = Object.fromEntries(brandings.map((b) => [b.orgId, b]));
    const data = orgs.map((org) => ({ ...org, branding: brandingMap[org.id] ?? null }));
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /organizations
router.post("/organizations", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const { nameEn, nameAr, orgCode, orgType, ...rest } = req.body;
    if (!nameEn || !nameAr || !orgCode) {
      return void res.status(400).json({ error: "nameEn, nameAr, orgCode are required" });
    }
    const [org] = await db.insert(organizationsTable).values({
      nameEn, nameAr, orgCode, orgType: orgType ?? "company",
      createdByUserId: actorUserId, ...rest,
    }).returning();

    // Auto-create branding row
    await db.insert(organizationBrandingTable).values({ orgId: org.id, updatedByUserId: actorUserId });

    // Auto-create policy locale row
    await db.insert(policyLocalesTable).values({ orgId: org.id, updatedByUserId: actorUserId });

    // Auto-create calendar config row
    await db.insert(calendarConfigsTable).values({ orgId: org.id, updatedByUserId: actorUserId });

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "organization",
      entityId: org.id,
      entityLabel: org.nameEn,
      actorUserId,
      changesJson: JSON.stringify({ after: org }),
    });

    res.status(201).json(org);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /organizations/:id/employees-count
router.get("/organizations/:id/employees-count", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    res.json({ orgId: id, count: 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /organizations/:id/activate
router.post("/organizations/:id/activate", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);
    const [org] = await db
      .update(organizationsTable)
      .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizationsTable.id, id))
      .returning();
    if (!org) return void res.status(404).json({ error: "Organization not found" });

    await db.insert(auditLogsTable).values({
      action: "activate",
      entityType: "organization",
      entityId: org.id,
      entityLabel: org.nameEn,
      actorUserId,
      changesJson: JSON.stringify({ status: "active", activatedAt: org.activatedAt }),
    });

    res.json(org);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /organizations/:id
router.get("/organizations/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
    if (!org) return void res.status(404).json({ error: "Organization not found" });

    const [branding] = await db.select().from(organizationBrandingTable).where(eq(organizationBrandingTable.orgId, id));
    const [locale] = await db.select().from(policyLocalesTable).where(eq(policyLocalesTable.orgId, id));

    res.json({ ...org, branding: branding ?? null, locale: locale ?? null, stats: { employeeCount: 0 } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /organizations/:id
router.patch("/organizations/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);
    const [before] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
    if (!before) return void res.status(404).json({ error: "Organization not found" });

    const [org] = await db
      .update(organizationsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(organizationsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "update",
      entityType: "organization",
      entityId: org.id,
      entityLabel: org.nameEn,
      actorUserId,
      changesJson: JSON.stringify({ before, after: org }),
    });

    res.json(org);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /organizations/:id — soft-delete (archived)
router.delete("/organizations/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id, 10);
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
    if (!org) return void res.status(404).json({ error: "Organization not found" });
    if (org.isDefault) return void res.status(400).json({ error: "Cannot archive the default organization" });

    const [updated] = await db
      .update(organizationsTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(organizationsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "archive",
      entityType: "organization",
      entityId: org.id,
      entityLabel: org.nameEn,
      actorUserId,
      changesJson: JSON.stringify({ status: "archived" }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
