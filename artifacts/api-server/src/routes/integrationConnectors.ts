import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  integrationConnectorsTable,
  connectionHealthLogTable,
  integrationEventLogTable,
} from "@workspace/db";

const router = Router();

// GET /integration-connectors — list (filter: connectorType, status, isActive)
router.get("/integration-connectors", async (req, res): Promise<void> => {
  try {
    const { connectorType, status, isActive } = req.query as Record<string, string>;
    const conditions = [];
    if (connectorType) conditions.push(eq(integrationConnectorsTable.connectorType, connectorType));
    if (status) conditions.push(eq(integrationConnectorsTable.status, status));
    if (isActive !== undefined) conditions.push(eq(integrationConnectorsTable.isActive, isActive === "true"));

    const rows = conditions.length > 0
      ? await db.select().from(integrationConnectorsTable).where(and(...conditions)).orderBy(integrationConnectorsTable.sortOrder)
      : await db.select().from(integrationConnectorsTable).orderBy(integrationConnectorsTable.sortOrder);

    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /integration-connectors — create
router.post("/integration-connectors", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const [row] = await db.insert(integrationConnectorsTable).values({ ...req.body }).returning();
    await db.insert(integrationEventLogTable).values({
      connectorId: row.id,
      eventType: "config_change",
      direction: "internal",
      success: true,
      messageEn: `Connector '${row.nameEn}' created`,
      actorUserId,
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /integration-connectors/:id — detail with latest health
router.get("/integration-connectors/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [connector] = await db.select().from(integrationConnectorsTable).where(eq(integrationConnectorsTable.id, id));
    if (!connector) { res.status(404).json({ error: "Not found" }); return; }

    const latestHealth = await db.select().from(connectionHealthLogTable)
      .where(eq(connectionHealthLogTable.connectorId, id))
      .orderBy(desc(connectionHealthLogTable.testedAt))
      .limit(1);

    res.json({ ...connector, latestHealth: latestHealth[0] ?? null });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /integration-connectors/:id — update config
router.patch("/integration-connectors/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.update(integrationConnectorsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(integrationConnectorsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(integrationEventLogTable).values({
      connectorId: id,
      eventType: "config_change",
      direction: "internal",
      success: true,
      messageEn: `Connector '${row.nameEn}' configuration updated`,
      detailsJson: JSON.stringify(req.body),
      actorUserId,
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /integration-connectors/:id — soft delete (set isActive=false)
router.delete("/integration-connectors/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.update(integrationConnectorsTable)
      .set({ isActive: false, status: "disabled", updatedAt: new Date() })
      .where(eq(integrationConnectorsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(integrationEventLogTable).values({
      connectorId: id,
      eventType: "config_change",
      direction: "internal",
      success: true,
      messageEn: `Connector '${row.nameEn}' disabled`,
      actorUserId,
    });
    res.json({ deleted: true, id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /integration-connectors/:id/test — simulate connection test
router.post("/integration-connectors/:id/test", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [connector] = await db.select().from(integrationConnectorsTable).where(eq(integrationConnectorsTable.id, id));
    if (!connector) { res.status(404).json({ error: "Not found" }); return; }

    // Simulate test based on current status
    const success = connector.status !== "error" && connector.status !== "disabled";
    const latencyMs = success ? Math.floor(Math.random() * 150) + 30 : null;
    const errorMsg = success ? null : `Connection test failed — ${connector.lastErrorMessage ?? "endpoint unreachable"}`;
    const testedAt = new Date();

    // Insert health log entry
    await db.insert(connectionHealthLogTable).values({
      connectorId: id,
      testedAt,
      success,
      latencyMs,
      errorMessage: errorMsg,
      checkedByUserId: actorUserId,
    });

    // Update connector status and timestamps
    await db.update(integrationConnectorsTable).set({
      lastTestedAt: testedAt,
      lastSuccessAt: success ? testedAt : connector.lastSuccessAt,
      lastErrorMessage: success ? null : errorMsg,
      status: success ? "healthy" : "error",
      updatedAt: new Date(),
    }).where(eq(integrationConnectorsTable.id, id));

    // Log event
    await db.insert(integrationEventLogTable).values({
      connectorId: id,
      eventType: "test",
      direction: "outbound",
      success,
      durationMs: latencyMs ?? undefined,
      messageEn: success
        ? `Connection test passed — ${connector.nameEn} (${latencyMs}ms)`
        : `Connection test failed — ${connector.nameEn}`,
      actorUserId,
    });

    res.json({ success, latencyMs, error: errorMsg, simulated: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /integration-connectors/:id/health — last N health log entries
router.get("/integration-connectors/:id/health", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 20;
    const rows = await db.select().from(connectionHealthLogTable)
      .where(eq(connectionHealthLogTable.connectorId, id))
      .orderBy(desc(connectionHealthLogTable.testedAt))
      .limit(limit);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
