import { Router } from "express";
import { db, salaryGradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/salary-grades", async (req, res): Promise<void> => {
  const { organizationType } = req.query as Record<string, string>;
  let rows = await db.select().from(salaryGradesTable).orderBy(salaryGradesTable.gradeCode);
  if (organizationType) rows = rows.filter(r => r.organizationType === organizationType);
  res.json(rows);
});

router.post("/salary-grades", async (req, res): Promise<void> => {
  const {
    gradeCode, nameEn, nameAr, step, baseSalary,
    housingAllowancePct, transportAllowancePct, currency, organizationType, isActive,
  } = req.body;
  if (!gradeCode || !nameEn || !nameAr || baseSalary === undefined) {
    res.status(400).json({ error: "gradeCode, nameEn, nameAr, baseSalary are required" });
    return;
  }
  const [g] = await db.insert(salaryGradesTable).values({
    gradeCode, nameEn, nameAr,
    step: step ?? 1,
    baseSalary: String(baseSalary),
    housingAllowancePct: String(housingAllowancePct ?? "25"),
    transportAllowancePct: String(transportAllowancePct ?? "10"),
    currency: currency ?? "SAR",
    organizationType: organizationType ?? "commercial",
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json(g);
});

router.get("/salary-grades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [g] = await db.select().from(salaryGradesTable).where(eq(salaryGradesTable.id, id));
  if (!g) { res.status(404).json({ error: "Not found" }); return; }
  res.json(g);
});

router.patch("/salary-grades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const {
    nameEn, nameAr, step, baseSalary,
    housingAllowancePct, transportAllowancePct, currency, organizationType, isActive,
  } = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (nameEn !== undefined) updateData.nameEn = nameEn;
  if (nameAr !== undefined) updateData.nameAr = nameAr;
  if (step !== undefined) updateData.step = step;
  if (baseSalary !== undefined) updateData.baseSalary = String(baseSalary);
  if (housingAllowancePct !== undefined) updateData.housingAllowancePct = String(housingAllowancePct);
  if (transportAllowancePct !== undefined) updateData.transportAllowancePct = String(transportAllowancePct);
  if (currency !== undefined) updateData.currency = currency;
  if (organizationType !== undefined) updateData.organizationType = organizationType;
  if (isActive !== undefined) updateData.isActive = isActive;
  const [g] = await db.update(salaryGradesTable).set(updateData).where(eq(salaryGradesTable.id, id)).returning();
  if (!g) { res.status(404).json({ error: "Not found" }); return; }
  res.json(g);
});

router.delete("/salary-grades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(salaryGradesTable).where(eq(salaryGradesTable.id, id));
  res.status(204).end();
});

export default router;
