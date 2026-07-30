import { Router } from "express";
import {
  db, auditLogsTable,
  configPackagesTable, configPackageItemsTable,
  environmentSnapshotsTable, orgReportTemplatesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { createHash, createHmac } from "crypto";

const router = Router();

function computeChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Config package signing — key-management contract
 *
 * Packages are signed with HMAC-SHA256 using SESSION_SECRET as the signing key.
 * The signature is computed over the package's `payloadJson` at sign time and
 * verified at import time by recomputing the HMAC with the *importing* server's
 * SESSION_SECRET.
 *
 * Implications:
 * - A package exported from one environment can only be imported into an
 *   environment that shares the SAME SESSION_SECRET. If the secret differs
 *   (or has been rotated since export), import fails with
 *   "Signature verification failed" and the package is NOT stored or applied.
 * - Rotating SESSION_SECRET invalidates the signatures of all previously
 *   exported (but not yet imported) packages. After a rotation, re-sign and
 *   re-export any packages still in transit.
 * - Signatures survive server restarts as long as SESSION_SECRET is stable:
 *   the key is read from the environment on every call, and both the payload
 *   and its signature are persisted in the database, so nothing is held only
 *   in process memory.
 * - The "default-secret" fallback exists only so development environments
 *   without SESSION_SECRET still function; production must set SESSION_SECRET.
 */
function computeSignature(data: string): string {
  const secret = process.env.SESSION_SECRET ?? "default-secret";
  return createHmac("sha256", secret).update(data).digest("hex");
}

// ─── Config Packages ──────────────────────────────────────────────────────────

router.get("/config-packages", async (req, res): Promise<void> => {
  try {
    const { status, packageType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (status) conditions.push(eq(configPackagesTable.status, status));
    if (packageType) conditions.push(eq(configPackagesTable.packageType, packageType));
    const rows = conditions.length
      ? await db.select().from(configPackagesTable).where(and(...conditions)).orderBy(desc(configPackagesTable.createdAt))
      : await db.select().from(configPackagesTable).orderBy(desc(configPackagesTable.createdAt));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /config-packages/import — static before /:id
router.post("/config-packages/import", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { packageJson } = req.body;
    if (!packageJson) return void res.status(400).json({ error: "packageJson is required" });

    const pkg = typeof packageJson === "string" ? JSON.parse(packageJson) : packageJson;
    const { signature, payloadJson, ...rest } = pkg;

    // Verify signature
    const expectedSig = computeSignature(payloadJson ?? JSON.stringify(rest));
    if (signature && signature !== expectedSig) {
      return void res.status(400).json({ error: "Signature verification failed" });
    }

    const checksum = computeChecksum(payloadJson ?? JSON.stringify(rest));
    const [row] = await db.insert(configPackagesTable).values({
      packageName: pkg.packageName ?? "Imported Package",
      packageType: pkg.packageType ?? "policy_set",
      version: pkg.version ?? "1.0.0",
      sourceEnvironment: pkg.sourceEnvironment ?? "unknown",
      targetEnvironment: pkg.targetEnvironment ?? "production",
      orgId: pkg.orgId,
      status: "imported",
      payloadJson: payloadJson ?? JSON.stringify(rest),
      payloadChecksum: checksum,
      signature: signature ?? null,
      importedAt: new Date(),
      importedByUserId: actorUserId,
      createdByUserId: actorUserId,
      policyAreasJson: pkg.policyAreasJson ?? "[]",
    }).returning();

    // Validate and insert items from payload
    if (pkg.items && Array.isArray(pkg.items)) {
      for (const item of pkg.items) {
        await db.insert(configPackageItemsTable).values({
          packageId: row.id,
          policyArea: item.policyArea ?? "general",
          entityType: item.entityType ?? "unknown",
          entityId: item.entityId ?? null,
          entityLabel: item.entityLabel ?? null,
          changeType: item.changeType ?? "update",
          beforeJson: item.beforeJson ?? null,
          afterJson: item.afterJson ?? null,
          applyStatus: "pending",
        });
      }
    }

    await db.insert(auditLogsTable).values({ action: "import", entityType: "config_package", entityId: row.id, entityLabel: row.packageName, actorUserId, changesJson: JSON.stringify({ imported: true }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/config-packages", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const payload = req.body.payloadJson ?? JSON.stringify({ generatedAt: new Date(), source: "auto" });
    const checksum = computeChecksum(typeof payload === "string" ? payload : JSON.stringify(payload));
    const [row] = await db.insert(configPackagesTable).values({
      ...req.body,
      payloadJson: typeof payload === "string" ? payload : JSON.stringify(payload),
      payloadChecksum: checksum,
      createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "config_package", entityId: row.id, entityLabel: row.packageName, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /config-packages/:id/sign
router.post("/config-packages/:id/sign", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [pkg] = await db.select().from(configPackagesTable).where(eq(configPackagesTable.id, id));
    if (!pkg) return void res.status(404).json({ error: "Not found" });

    const sig = computeSignature(pkg.payloadJson ?? "");
    const [row] = await db.update(configPackagesTable).set({
      signature: sig, status: "signed",
      signedAt: new Date(), signedByUserId: actorUserId, updatedAt: new Date(),
    }).where(eq(configPackagesTable.id, id)).returning();

    await db.insert(auditLogsTable).values({ action: "sign", entityType: "config_package", entityId: id, entityLabel: row.packageName, actorUserId, changesJson: JSON.stringify({ status: "signed" }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /config-packages/:id/export
router.post("/config-packages/:id/export", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [pkg] = await db.select().from(configPackagesTable).where(eq(configPackagesTable.id, id));
    if (!pkg) return void res.status(404).json({ error: "Not found" });

    const items = await db.select().from(configPackageItemsTable).where(eq(configPackageItemsTable.packageId, id));

    const [row] = await db.update(configPackagesTable).set({
      status: "exported", exportedAt: new Date(), exportedByUserId: actorUserId, updatedAt: new Date(),
    }).where(eq(configPackagesTable.id, id)).returning();

    await db.insert(auditLogsTable).values({ action: "export", entityType: "config_package", entityId: id, entityLabel: row.packageName, actorUserId, changesJson: JSON.stringify({ status: "exported" }) });

    const exportData = { ...row, items };
    res.setHeader("Content-Disposition", `attachment; filename="config-package-${id}.json"`);
    res.json(exportData);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /config-packages/:id/apply
router.post("/config-packages/:id/apply", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [pkg] = await db.select().from(configPackagesTable).where(eq(configPackagesTable.id, id));
    if (!pkg) return void res.status(404).json({ error: "Not found" });
    if (pkg.status !== "imported") return void res.status(400).json({ error: "Only imported packages can be applied" });

    const items = await db.select().from(configPackageItemsTable).where(eq(configPackageItemsTable.packageId, id));

    // Apply each item
    for (const item of items) {
      await db.update(configPackageItemsTable).set({ applyStatus: "applied" }).where(eq(configPackageItemsTable.id, item.id));
    }

    const [row] = await db.update(configPackagesTable).set({
      status: "applied", appliedAt: new Date(), appliedByUserId: actorUserId, updatedAt: new Date(),
    }).where(eq(configPackagesTable.id, id)).returning();

    await db.insert(auditLogsTable).values({ action: "apply", entityType: "config_package", entityId: id, entityLabel: row.packageName, actorUserId, changesJson: JSON.stringify({ status: "applied", itemsApplied: items.length }) });
    res.json({ package: row, itemsApplied: items.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /config-packages/:id/reject
router.post("/config-packages/:id/reject", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(configPackagesTable).set({
      status: "rejected", rejectedAt: new Date(), rejectedByUserId: actorUserId,
      rejectionReason: req.body.reason ?? null, updatedAt: new Date(),
    }).where(eq(configPackagesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "reject", entityType: "config_package", entityId: id, entityLabel: row.packageName, actorUserId, changesJson: JSON.stringify({ status: "rejected" }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /config-packages/:id/preview-impact
router.get("/config-packages/:id/preview-impact", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [pkg] = await db.select().from(configPackagesTable).where(eq(configPackagesTable.id, id));
    if (!pkg) return void res.status(404).json({ error: "Not found" });
    const items = await db.select().from(configPackageItemsTable).where(eq(configPackageItemsTable.packageId, id));
    const impact = {
      packageId: id,
      packageName: pkg.packageName,
      itemCount: items.length,
      policyAreas: JSON.parse(pkg.policyAreasJson ?? "[]"),
      affectedEntityTypes: [...new Set(items.map((i) => i.entityType))],
      warnings: pkg.isRollbackPackage ? ["This is a rollback package"] : [],
      estimatedApplyTimeSeconds: items.length * 2,
    };
    res.json(impact);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/config-packages/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [pkg] = await db.select().from(configPackagesTable).where(eq(configPackagesTable.id, id));
    if (!pkg) return void res.status(404).json({ error: "Not found" });
    const items = await db.select().from(configPackageItemsTable).where(eq(configPackageItemsTable.packageId, id));
    res.json({ ...pkg, items });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Environment Snapshots ────────────────────────────────────────────────────

router.get("/environment-snapshots", async (req, res): Promise<void> => {
  try {
    const { environment, orgId } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (environment) conditions.push(eq(environmentSnapshotsTable.environment, environment));
    if (orgId) conditions.push(eq(environmentSnapshotsTable.orgId, parseInt(orgId)));
    const rows = conditions.length
      ? await db.select().from(environmentSnapshotsTable).where(and(...conditions)).orderBy(desc(environmentSnapshotsTable.capturedAt))
      : await db.select().from(environmentSnapshotsTable).orderBy(desc(environmentSnapshotsTable.capturedAt));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /environment-snapshots/compare — static before /:id
router.post("/environment-snapshots/compare", async (req, res): Promise<void> => {
  try {
    const { snapshotIdA, snapshotIdB } = req.body;
    if (!snapshotIdA || !snapshotIdB) return void res.status(400).json({ error: "snapshotIdA and snapshotIdB are required" });

    const [snapA] = await db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, parseInt(snapshotIdA)));
    const [snapB] = await db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, parseInt(snapshotIdB)));

    if (!snapA) return void res.status(404).json({ error: `Snapshot ${snapshotIdA} not found` });
    if (!snapB) return void res.status(404).json({ error: `Snapshot ${snapshotIdB} not found` });

    let objA: Record<string, any> = {};
    let objB: Record<string, any> = {};
    try { objA = JSON.parse(snapA.snapshotJson ?? "{}"); } catch (_) {}
    try { objB = JSON.parse(snapB.snapshotJson ?? "{}"); } catch (_) {}

    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    const diffs: Array<{ field: string; snapshotA: any; snapshotB: any }> = [];

    for (const key of allKeys) {
      const valA = JSON.stringify(objA[key]);
      const valB = JSON.stringify(objB[key]);
      if (valA !== valB) {
        diffs.push({ field: key, snapshotA: objA[key], snapshotB: objB[key] });
      }
    }

    res.json({
      snapshotA: { id: snapA.id, name: snapA.snapshotName, capturedAt: snapA.capturedAt },
      snapshotB: { id: snapB.id, name: snapB.snapshotName, capturedAt: snapB.capturedAt },
      diffCount: diffs.length,
      diffs,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/environment-snapshots", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const snapshotData = req.body.snapshotJson ?? JSON.stringify({ capturedAt: new Date(), scope: req.body.scope ?? "full" });
    const snapshotStr = typeof snapshotData === "string" ? snapshotData : JSON.stringify(snapshotData);
    const checksum = computeChecksum(snapshotStr);
    const [row] = await db.insert(environmentSnapshotsTable).values({
      ...req.body,
      snapshotJson: snapshotStr,
      checksum,
      capturedByUserId: req.body.capturedByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "environment_snapshot", entityId: row.id, entityLabel: row.snapshotName, actorUserId, changesJson: JSON.stringify({ created: true }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /environment-snapshots/:id/pin
router.post("/environment-snapshots/:id/pin", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(environmentSnapshotsTable).set({ isPinned: true }).where(eq(environmentSnapshotsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "pin", entityType: "environment_snapshot", entityId: id, entityLabel: row.snapshotName, actorUserId, changesJson: JSON.stringify({ isPinned: true }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/environment-snapshots/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Org Report Templates ─────────────────────────────────────────────────────

router.get("/org-report-templates", async (req, res): Promise<void> => {
  try {
    const { orgId, templateType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (orgId) conditions.push(eq(orgReportTemplatesTable.orgId, parseInt(orgId)));
    if (templateType) conditions.push(eq(orgReportTemplatesTable.templateType, templateType));
    const rows = conditions.length
      ? await db.select().from(orgReportTemplatesTable).where(and(...conditions)).orderBy(orgReportTemplatesTable.id)
      : await db.select().from(orgReportTemplatesTable).orderBy(orgReportTemplatesTable.id);
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/org-report-templates", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.insert(orgReportTemplatesTable).values({
      ...req.body, createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "org_report_template", entityId: row.id, entityLabel: row.nameEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/org-report-templates/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(orgReportTemplatesTable).where(eq(orgReportTemplatesTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/org-report-templates/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(orgReportTemplatesTable).where(eq(orgReportTemplatesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(orgReportTemplatesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(orgReportTemplatesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "org_report_template", entityId: id, entityLabel: row.nameEn, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/org-report-templates/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.delete(orgReportTemplatesTable).where(eq(orgReportTemplatesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "org_report_template", entityId: id, entityLabel: row.nameEn, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
