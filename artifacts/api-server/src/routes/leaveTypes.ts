import { Router } from "express";
import { db, leaveTypesTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/leave-types", async (_req, res): Promise<void> => {
  const types = await db.select().from(leaveTypesTable).orderBy(leaveTypesTable.codeEn);
  res.json(types);
});

router.post("/leave-types", async (req, res): Promise<void> => {
  const actorUserId: number = (req as any).session?.userId ?? 1;
  const {
    codeEn, nameEn, nameAr, descriptionEn, descriptionAr, category,
    defaultDaysPerYear, accrualFrequency, accrualAmount, maxCarryoverDays,
    requiresApproval, requiresAttachment, minAdvanceNoticeDays,
    maxConsecutiveDays, applicableToGender, isActive, color,
  } = req.body;
  if (!codeEn || !nameEn || !nameAr) {
    res.status(400).json({ error: "codeEn, nameEn, nameAr are required" });
    return;
  }
  const [lt] = await db.insert(leaveTypesTable).values({
    codeEn, nameEn, nameAr,
    descriptionEn: descriptionEn ?? null,
    descriptionAr: descriptionAr ?? null,
    category: category ?? "general",
    defaultDaysPerYear: defaultDaysPerYear ?? 0,
    accrualFrequency: accrualFrequency ?? "annual",
    accrualAmount: accrualAmount ?? "0",
    maxCarryoverDays: maxCarryoverDays ?? 0,
    requiresApproval: requiresApproval ?? true,
    requiresAttachment: requiresAttachment ?? false,
    minAdvanceNoticeDays: minAdvanceNoticeDays ?? 0,
    maxConsecutiveDays: maxConsecutiveDays ?? null,
    applicableToGender: applicableToGender ?? "all",
    isActive: isActive ?? true,
    color: color ?? "#6366F1",
  }).returning();
  await db.insert(auditLogsTable).values({
    action: "create",
    entityType: "leave_type",
    entityId: lt.id,
    entityLabel: lt.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ after: { codeEn, nameEn, nameAr, category } }),
  });
  res.status(201).json(lt);
});

router.get("/leave-types/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [lt] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, id));
  if (!lt) { res.status(404).json({ error: "Not found" }); return; }
  res.json(lt);
});

router.patch("/leave-types/:id", async (req, res): Promise<void> => {
  const actorUserId: number = (req as any).session?.userId ?? 1;
  const id = parseInt(req.params.id, 10);
  const {
    nameEn, nameAr, descriptionEn, descriptionAr, category,
    defaultDaysPerYear, accrualFrequency, accrualAmount, maxCarryoverDays,
    requiresApproval, requiresAttachment, minAdvanceNoticeDays,
    maxConsecutiveDays, applicableToGender, isActive, color,
  } = req.body;
  const [before] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, id));
  const [lt] = await db.update(leaveTypesTable)
    .set({
      nameEn, nameAr, descriptionEn, descriptionAr, category,
      defaultDaysPerYear, accrualFrequency, accrualAmount, maxCarryoverDays,
      requiresApproval, requiresAttachment, minAdvanceNoticeDays,
      maxConsecutiveDays, applicableToGender, isActive, color,
      updatedAt: new Date(),
    })
    .where(eq(leaveTypesTable.id, id))
    .returning();
  if (!lt) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(auditLogsTable).values({
    action: "update",
    entityType: "leave_type",
    entityId: id,
    entityLabel: lt.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ before: before ?? null, after: req.body }),
  });
  res.json(lt);
});

router.delete("/leave-types/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, id));
  res.status(204).end();
});

export default router;
