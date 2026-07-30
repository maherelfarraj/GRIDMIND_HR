import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, updatePackagesTable, deploymentEventsTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list all packages
router.get("/", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(updatePackagesTable);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST / — register new package
router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(updatePackagesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "update_package", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /:id — get
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(updatePackagesTable)
      .where(eq(updatePackagesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update status
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.update(updatePackagesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(updatePackagesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "update", entityType: "update_package", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/verify — set signatureVerified:true
router.post("/:id/verify", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.update(updatePackagesTable)
      .set({ signatureVerified: true, verifiedAt: new Date(), status: "verified", updatedAt: new Date() })
      .where(eq(updatePackagesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ action: "verify", entityType: "update_package", entityId: id, changesJson: JSON.stringify({ signatureVerified: true }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /:id/install — install package
router.post("/:id/install", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { confirmedByUserId } = req.body;
    const userId = confirmedByUserId ?? (req as any).session?.userId ?? null;

    const [pkg] = await db.select().from(updatePackagesTable).where(eq(updatePackagesTable.id, id));
    if (!pkg) { res.status(404).json({ error: "Not found" }); return; }

    const now = new Date();
    const [row] = await db.update(updatePackagesTable)
      .set({ status: "installed", installedAt: now, installedByUserId: userId, updatedAt: now })
      .where(eq(updatePackagesTable.id, id))
      .returning();

    await db.insert(deploymentEventsTable).values({
      eventType: "update",
      description: `Package ${pkg.packageName} v${pkg.packageVersion} installed`,
      performedByUserId: userId,
      outcome: "success",
      detailsJson: JSON.stringify({ packageId: id, packageVersion: pkg.packageVersion }),
    });

    await db.insert(auditLogsTable).values({ action: "install", entityType: "update_package", entityId: id, changesJson: JSON.stringify({ status: "installed", userId }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
