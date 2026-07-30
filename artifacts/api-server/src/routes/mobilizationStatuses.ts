import { Router } from "express";
import { db, mobilizationStatusesTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichMob(m: typeof mobilizationStatusesTable.$inferSelect) {
  let employeeNameEn: string | null = null;
  let employeeNameAr: string | null = null;
  if (m.employeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, m.employeeId));
    if (emp) {
      employeeNameEn = emp.firstNameEn + " " + emp.lastNameEn;
      employeeNameAr = (emp.firstNameAr ?? "") + " " + (emp.lastNameAr ?? "");
    }
  }
  return { ...m, employeeNameEn, employeeNameAr };
}

// GET /mobilization-statuses
router.get("/mobilization-statuses", async (req, res): Promise<void> => {
  const { status, readinessCode } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(mobilizationStatusesTable.status, status));
  if (readinessCode) conditions.push(eq(mobilizationStatusesTable.readinessCode, readinessCode));

  const rows = conditions.length
    ? await db.select().from(mobilizationStatusesTable).where(and(...conditions))
    : await db.select().from(mobilizationStatusesTable);

  const enriched = await Promise.all(rows.map(enrichMob));
  res.json(enriched);
});

// POST /mobilization-statuses — upsert by employeeId
router.post("/mobilization-statuses", async (req, res): Promise<void> => {
  const { employeeId, status, ...rest } = req.body;

  if (!employeeId || !status) {
    res.status(400).json({ error: "employeeId, status are required" });
    return;
  }

  const empId = parseInt(employeeId, 10);
  const [existing] = await db
    .select()
    .from(mobilizationStatusesTable)
    .where(eq(mobilizationStatusesTable.employeeId, empId));

  let row: typeof mobilizationStatusesTable.$inferSelect;

  if (existing) {
    const [updated] = await db
      .update(mobilizationStatusesTable)
      .set({ status, ...rest, updatedAt: new Date() })
      .where(eq(mobilizationStatusesTable.employeeId, empId))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(mobilizationStatusesTable)
      .values({ employeeId: empId, status, ...rest })
      .returning();
    row = inserted;
  }

  res.status(existing ? 200 : 201).json(await enrichMob(row));
});

// PATCH /mobilization-statuses/:id
router.patch("/mobilization-statuses/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(mobilizationStatusesTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(mobilizationStatusesTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Mobilization status not found" });
    return;
  }
  res.json(await enrichMob(row));
});

export default router;
