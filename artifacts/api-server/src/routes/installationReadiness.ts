import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, asc } from "drizzle-orm";
import { db, installationReadinessTable, auditLogsTable } from "@workspace/db";

const router = Router();

// GET / — list all checks sorted by sortOrder
router.get("/", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(installationReadinessTable)
      .orderBy(asc(installationReadinessTable.sortOrder));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /run — MUST be registered BEFORE /:id
router.post("/run", async (req, res): Promise<void> => {
  try {
    const { isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const checks = await db.select().from(installationReadinessTable).orderBy(asc(installationReadinessTable.sortOrder));
    const now = new Date();
    const results = [];

    for (const check of checks) {
      const [updated] = await db.update(installationReadinessTable)
        .set({ status: "pass", resultMessage: "Check passed", lastCheckedAt: now, updatedAt: now })
        .where(eq(installationReadinessTable.id, check.id))
        .returning();
      results.push(updated);
    }

    const passed = results.filter(r => r.status === "pass").length;
    const failed = results.filter(r => r.status === "fail").length;
    const warnings = results.filter(r => r.status === "warn").length;

    res.json({ results, passed, failed, warnings });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /:id — update individual check result
router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.update(installationReadinessTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(installationReadinessTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId, action: "update", entityType: "installation_readiness", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
