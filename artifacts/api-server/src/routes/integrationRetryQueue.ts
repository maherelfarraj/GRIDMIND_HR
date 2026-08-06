import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, and } from "drizzle-orm";
import {
  db,
  integrationRetryQueueTable,
  integrationEventLogTable,
} from "@workspace/db";

const router = Router();

// POST /integration-retry-queue/clear-abandoned — MUST be before /:id
router.post("/integration-retry-queue/clear-abandoned", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const deleted = await db.delete(integrationRetryQueueTable)
      .where(eq(integrationRetryQueueTable.status, "abandoned"))
      .returning();
    await db.insert(integrationEventLogTable).values({
      connectorId: null,
      eventType: "config_change",
      direction: "internal",
      success: true,
      messageEn: `Cleared ${deleted.length} abandoned retry queue entries`,
      actorUserId,
    });
    res.json({ deleted: deleted.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /integration-retry-queue — list (filter: connectorId, status)
router.get("/integration-retry-queue", async (req, res): Promise<void> => {
  try {
    const { connectorId, status } = req.query as Record<string, string>;
    const conditions = [];
    if (connectorId) conditions.push(eq(integrationRetryQueueTable.connectorId, parseInt(connectorId)));
    if (status) conditions.push(eq(integrationRetryQueueTable.status, status));

    const rows = conditions.length > 0
      ? await db.select().from(integrationRetryQueueTable).where(and(...conditions))
      : await db.select().from(integrationRetryQueueTable);

    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /integration-retry-queue/:id/retry — bump attemptCount, set retrying, update nextRetryAt
router.post("/integration-retry-queue/:id/retry", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(integrationRetryQueueTable).where(eq(integrationRetryQueueTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
    const [row] = await db.update(integrationRetryQueueTable)
      .set({
        status: "retrying",
        attemptCount: existing.attemptCount + 1,
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(integrationRetryQueueTable.id, id))
      .returning();

    await db.insert(integrationEventLogTable).values({
      connectorId: existing.connectorId,
      eventType: "retry",
      direction: "outbound",
      entityType: existing.operationType,
      success: true,
      messageEn: `Retry #${row.attemptCount} queued for operation '${existing.operationType}'`,
      actorUserId,
    });

    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /integration-retry-queue/:id — abandon
router.delete("/integration-retry-queue/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);
    const [row] = await db.update(integrationRetryQueueTable)
      .set({ status: "abandoned", updatedAt: new Date() })
      .where(eq(integrationRetryQueueTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    await db.insert(integrationEventLogTable).values({
      connectorId: row.connectorId,
      eventType: "retry",
      direction: "outbound",
      entityType: row.operationType,
      success: false,
      messageEn: `Retry queue entry #${id} abandoned for operation '${row.operationType}'`,
      actorUserId,
    });

    res.json({ abandoned: true, id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
