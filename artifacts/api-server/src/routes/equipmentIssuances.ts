import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc, sql } from "drizzle-orm";
import { db, equipmentIssuancesTable, idCardRecordsTable, auditLogsTable } from "@workspace/db";

// Equipment Issuances Router
const equipmentRouter = Router();

equipmentRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(equipmentIssuancesTable);
    const rows = await db.select().from(equipmentIssuancesTable)
      .orderBy(desc(equipmentIssuancesTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

equipmentRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(equipmentIssuancesTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "equipment_issuance", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

equipmentRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(equipmentIssuancesTable).where(eq(equipmentIssuancesTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

equipmentRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(equipmentIssuancesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(equipmentIssuancesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "equipment_issuance", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

equipmentRouter.post("/:id/return", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(equipmentIssuancesTable)
      .set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() })
      .where(eq(equipmentIssuancesTable.id, parseInt(req.params.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "return", entityType: "equipment_issuance", entityId: row.id, changesJson: JSON.stringify({ status: "returned" }) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ID Card Records Router
const idCardRouter = Router();

idCardRouter.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql`count(*)` }).from(idCardRecordsTable);
    const rows = await db.select().from(idCardRecordsTable)
      .orderBy(desc(idCardRecordsTable.createdAt))
      .limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

idCardRouter.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(idCardRecordsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "create", entityType: "id_card_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

idCardRouter.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(idCardRecordsTable).where(eq(idCardRecordsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

idCardRouter.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(idCardRecordsTable).set(req.body).where(eq(idCardRecordsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: getActorUserId(req), action: "update", entityType: "id_card_record", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export const equipmentIssuancesRouter = equipmentRouter;
export const idCardRecordsRouter = idCardRouter;
