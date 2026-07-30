import { Router } from "express";
import { db, organizationBrandingTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /organization-branding/:orgId
router.get("/organization-branding/:orgId", async (req, res): Promise<void> => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const [row] = await db.select().from(organizationBrandingTable).where(eq(organizationBrandingTable.orgId, orgId));
    if (!row) return void res.status(404).json({ error: "Branding not found for this organization" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /organization-branding/:orgId — upsert
router.put("/organization-branding/:orgId", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const orgId = parseInt(req.params.orgId, 10);

    const [existing] = await db.select().from(organizationBrandingTable).where(eq(organizationBrandingTable.orgId, orgId));

    let row;
    if (existing) {
      [row] = await db
        .update(organizationBrandingTable)
        .set({ ...req.body, orgId, updatedByUserId: actorUserId, updatedAt: new Date() })
        .where(eq(organizationBrandingTable.orgId, orgId))
        .returning();
    } else {
      [row] = await db
        .insert(organizationBrandingTable)
        .values({ ...req.body, orgId, updatedByUserId: actorUserId })
        .returning();
    }

    await db.insert(auditLogsTable).values({
      action: existing ? "update" : "create",
      entityType: "organization_branding",
      entityId: orgId,
      entityLabel: `Org ${orgId} branding`,
      actorUserId,
      changesJson: JSON.stringify({ before: existing ?? null, after: row }),
    });

    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
