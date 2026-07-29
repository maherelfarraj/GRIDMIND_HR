import { Router } from "express";
import { db, publicHolidaysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /public-holidays?year=&applicableTo=
router.get("/public-holidays", async (req, res): Promise<void> => {
  const { year, applicableTo } = req.query as Record<string, string>;
  const conditions = [];
  if (year) conditions.push(eq(publicHolidaysTable.year, parseInt(year, 10)));
  if (applicableTo) conditions.push(eq(publicHolidaysTable.applicableTo, applicableTo));

  const holidays = conditions.length > 0
    ? await db.select().from(publicHolidaysTable).where(and(...conditions)).orderBy(publicHolidaysTable.date)
    : await db.select().from(publicHolidaysTable).orderBy(publicHolidaysTable.date);

  res.json(holidays);
});

router.post("/public-holidays", async (req, res): Promise<void> => {
  const { nameEn, nameAr, date, year, isRecurring, applicableTo, notes } = req.body;
  if (!nameEn || !nameAr || !date || !year) {
    res.status(400).json({ error: "nameEn, nameAr, date, year are required" });
    return;
  }
  const [h] = await db.insert(publicHolidaysTable).values({
    nameEn, nameAr, date, year,
    isRecurring: isRecurring ?? false,
    applicableTo: applicableTo ?? "all",
    notes: notes ?? null,
  }).returning();
  res.status(201).json(h);
});

router.patch("/public-holidays/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { nameEn, nameAr, date, year, isRecurring, applicableTo, notes } = req.body;
  const [h] = await db.update(publicHolidaysTable)
    .set({ nameEn, nameAr, date, year, isRecurring, applicableTo, notes })
    .where(eq(publicHolidaysTable.id, id))
    .returning();
  if (!h) { res.status(404).json({ error: "Not found" }); return; }
  res.json(h);
});

router.delete("/public-holidays/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, id));
  res.status(204).end();
});

export default router;
