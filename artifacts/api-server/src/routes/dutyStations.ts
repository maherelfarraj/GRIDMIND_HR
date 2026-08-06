import { Router } from "express";
import { db, dutyStationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActorAdminStatus } from "../lib/adminAuth.js";

const router = Router();

// GET /duty-stations
router.get("/duty-stations", async (req, res): Promise<void> => {
  const rows = await db.select().from(dutyStationsTable);
  res.json(rows);
});

// POST /duty-stations
router.post("/duty-stations", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const { stationCode, nameEn, nameAr, ...rest } = req.body;

  if (!stationCode || !nameEn || !nameAr) {
    res.status(400).json({ error: "stationCode, nameEn, nameAr are required" });
    return;
  }

  const [row] = await db
    .insert(dutyStationsTable)
    .values({ stationCode, nameEn, nameAr, ...rest })
    .returning();

  res.status(201).json(row);
});

// GET /duty-stations/:id
router.get("/duty-stations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(dutyStationsTable).where(eq(dutyStationsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Duty station not found" });
    return;
  }
  res.json(row);
});

// PATCH /duty-stations/:id
router.patch("/duty-stations/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(dutyStationsTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(dutyStationsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Duty station not found" });
    return;
  }
  res.json(row);
});

// DELETE /duty-stations/:id
router.delete("/duty-stations/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(dutyStationsTable)
    .where(eq(dutyStationsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Duty station not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
