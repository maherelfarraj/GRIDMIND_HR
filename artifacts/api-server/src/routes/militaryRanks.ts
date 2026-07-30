import { Router } from "express";
import { db, militaryRanksTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router = Router();

// GET /military-ranks
router.get("/military-ranks", async (req, res): Promise<void> => {
  const { organizationType, category } = req.query as Record<string, string>;

  const conditions = [];
  if (organizationType) conditions.push(eq(militaryRanksTable.organizationType, organizationType));
  if (category) conditions.push(eq(militaryRanksTable.category, category));

  const rows = conditions.length
    ? await db.select().from(militaryRanksTable).where(and(...conditions)).orderBy(asc(militaryRanksTable.rankOrder))
    : await db.select().from(militaryRanksTable).orderBy(asc(militaryRanksTable.rankOrder));

  res.json(rows);
});

// POST /military-ranks
router.post("/military-ranks", async (req, res): Promise<void> => {
  const { rankCode, nameEn, nameAr, abbreviationEn, abbreviationAr, ...rest } = req.body;

  if (!rankCode || !nameEn || !nameAr || !abbreviationEn || !abbreviationAr) {
    res.status(400).json({ error: "rankCode, nameEn, nameAr, abbreviationEn, abbreviationAr are required" });
    return;
  }

  const [row] = await db
    .insert(militaryRanksTable)
    .values({ rankCode, nameEn, nameAr, abbreviationEn, abbreviationAr, ...rest })
    .returning();

  res.status(201).json(row);
});

// GET /military-ranks/:id
router.get("/military-ranks/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(militaryRanksTable).where(eq(militaryRanksTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Military rank not found" });
    return;
  }
  res.json(row);
});

// PATCH /military-ranks/:id
router.patch("/military-ranks/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(militaryRanksTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(militaryRanksTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Military rank not found" });
    return;
  }
  res.json(row);
});

// DELETE /military-ranks/:id
router.delete("/military-ranks/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(militaryRanksTable)
    .where(eq(militaryRanksTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Military rank not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
