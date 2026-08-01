import { Router } from "express";
import { db, payComponentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/pay-components", async (req, res): Promise<void> => {
  const { type, applicableTo } = req.query as Record<string, string>;
  let rows = await db.select().from(payComponentsTable).orderBy(payComponentsTable.sortOrder, payComponentsTable.nameEn);
  if (type) rows = rows.filter(r => r.type === type);
  if (applicableTo) rows = rows.filter(r => r.applicableTo === applicableTo || r.applicableTo === "all");
  res.json(rows);
});

router.post("/pay-components", async (req, res): Promise<void> => {
  const {
    codeEn, nameEn, nameAr, type, calculationMethod, value,
    percentageBase, isRecurring, isTaxable, isMandatory, applicableTo, isActive, sortOrder, notes,
  } = req.body;
  if (!codeEn || !nameEn || !nameAr || !type) {
    res.status(400).json({ error: "codeEn, nameEn, nameAr, type are required" });
    return;
  }
  const [c] = await db.insert(payComponentsTable).values({
    codeEn, nameEn, nameAr, type,
    calculationMethod: calculationMethod ?? "fixed",
    value: String(value ?? "0"),
    percentageBase: percentageBase ?? null,
    isRecurring: isRecurring ?? true,
    isTaxable: isTaxable ?? false,
    isMandatory: isMandatory ?? false,
    applicableTo: applicableTo ?? "all",
    isActive: isActive ?? true,
    sortOrder: sortOrder ?? 0,
    notes: notes ?? null,
  }).returning();
  res.status(201).json(c);
});

router.get("/pay-components/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [c] = await db.select().from(payComponentsTable).where(eq(payComponentsTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  res.json(c);
});

router.patch("/pay-components/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const {
    nameEn, nameAr, type, calculationMethod, value,
    percentageBase, isRecurring, isTaxable, isMandatory, applicableTo, isActive, sortOrder, notes,
  } = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (nameEn !== undefined) updateData.nameEn = nameEn;
  if (nameAr !== undefined) updateData.nameAr = nameAr;
  if (type !== undefined) updateData.type = type;
  if (calculationMethod !== undefined) updateData.calculationMethod = calculationMethod;
  if (value !== undefined) updateData.value = String(value);
  if (percentageBase !== undefined) updateData.percentageBase = percentageBase;
  if (isRecurring !== undefined) updateData.isRecurring = isRecurring;
  if (isTaxable !== undefined) updateData.isTaxable = isTaxable;
  if (isMandatory !== undefined) updateData.isMandatory = isMandatory;
  if (applicableTo !== undefined) updateData.applicableTo = applicableTo;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
  if (notes !== undefined) updateData.notes = notes;
  const [c] = await db.update(payComponentsTable).set(updateData).where(eq(payComponentsTable.id, id)).returning();
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  res.json(c);
});

router.delete("/pay-components/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(payComponentsTable).where(eq(payComponentsTable.id, id));
  res.status(204).end();
});

export default router;
