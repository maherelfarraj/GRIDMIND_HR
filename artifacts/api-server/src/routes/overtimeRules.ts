import { Router } from "express";
import { db, overtimeRulesTable, departmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActorAdminStatus } from "../lib/adminAuth.js";

const router = Router();

router.get("/overtime-rules", async (req, res): Promise<void> => {
  const rules = await db.select().from(overtimeRulesTable).orderBy(overtimeRulesTable.id);
  const enriched = await Promise.all(
    rules.map(async (r) => {
      let deptNameEn: string | null = null;
      let deptNameAr: string | null = null;
      if (r.departmentId) {
        const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, r.departmentId));
        if (dept) { deptNameEn = dept.nameEn; deptNameAr = dept.nameAr; }
      }
      return {
        ...r,
        multiplierWeekday: parseFloat(String(r.multiplierWeekday)),
        multiplierWeekend: parseFloat(String(r.multiplierWeekend)),
        multiplierHoliday: parseFloat(String(r.multiplierHoliday)),
        deptNameEn, deptNameAr,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        createdAt: r.createdAt.toISOString(),
      };
    })
  );
  res.json(enriched);
});

router.post("/overtime-rules", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const { nameEn, nameAr, departmentId, maxDailyMinutes, maxWeeklyMinutes,
          multiplierWeekday, multiplierWeekend, multiplierHoliday,
          requiresApproval, effectiveFrom, effectiveTo, notes } = req.body;
  if (!nameEn || !nameAr || !effectiveFrom) {
    res.status(400).json({ error: "nameEn, nameAr, effectiveFrom required" });
    return;
  }
  const [rule] = await db.insert(overtimeRulesTable).values({
    nameEn, nameAr, departmentId: departmentId ?? null,
    maxDailyMinutes: maxDailyMinutes ?? 120, maxWeeklyMinutes: maxWeeklyMinutes ?? 600,
    multiplierWeekday: multiplierWeekday ?? "1.50",
    multiplierWeekend: multiplierWeekend ?? "2.00",
    multiplierHoliday: multiplierHoliday ?? "2.50",
    requiresApproval: requiresApproval ?? true,
    effectiveFrom, effectiveTo: effectiveTo ?? null, notes: notes ?? null,
  }).returning();
  res.status(201).json({
    ...rule,
    multiplierWeekday: parseFloat(String(rule.multiplierWeekday)),
    multiplierWeekend: parseFloat(String(rule.multiplierWeekend)),
    multiplierHoliday: parseFloat(String(rule.multiplierHoliday)),
    createdAt: rule.createdAt.toISOString(),
  });
});

router.get("/overtime-rules/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [rule] = await db.select().from(overtimeRulesTable).where(eq(overtimeRulesTable.id, id));
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...rule, createdAt: rule.createdAt.toISOString() });
});

router.patch("/overtime-rules/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const id = parseInt(req.params.id, 10);
  const updates = req.body;
  const [rule] = await db.update(overtimeRulesTable).set(updates)
    .where(eq(overtimeRulesTable.id, id)).returning();
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...rule, createdAt: rule.createdAt.toISOString() });
});

router.delete("/overtime-rules/:id", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(overtimeRulesTable).where(eq(overtimeRulesTable.id, id));
  res.status(204).end();
});

export default router;
