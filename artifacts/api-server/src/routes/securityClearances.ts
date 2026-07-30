import { Router } from "express";
import { db, securityClearancesTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichClearance(c: typeof securityClearancesTable.$inferSelect) {
  let employeeNameEn: string | null = null;
  let employeeNameAr: string | null = null;
  if (c.employeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, c.employeeId));
    if (emp) {
      employeeNameEn = emp.firstNameEn + " " + emp.lastNameEn;
      employeeNameAr = (emp.firstNameAr ?? "") + " " + (emp.lastNameAr ?? "");
    }
  }
  return { ...c, employeeNameEn, employeeNameAr };
}

// GET /security-clearances
router.get("/security-clearances", async (req, res): Promise<void> => {
  const { clearanceLevel, status } = req.query as Record<string, string>;

  const conditions = [];
  if (clearanceLevel) conditions.push(eq(securityClearancesTable.clearanceLevel, clearanceLevel));
  if (status) conditions.push(eq(securityClearancesTable.status, status));

  const rows = conditions.length
    ? await db.select().from(securityClearancesTable).where(and(...conditions))
    : await db.select().from(securityClearancesTable);

  const enriched = await Promise.all(rows.map(enrichClearance));
  res.json(enriched);
});

// POST /security-clearances — upsert by employeeId
router.post("/security-clearances", async (req, res): Promise<void> => {
  const { employeeId, clearanceLevel, ...rest } = req.body;

  if (!employeeId || !clearanceLevel) {
    res.status(400).json({ error: "employeeId, clearanceLevel are required" });
    return;
  }

  const empId = parseInt(employeeId, 10);
  const [existing] = await db
    .select()
    .from(securityClearancesTable)
    .where(eq(securityClearancesTable.employeeId, empId));

  let row: typeof securityClearancesTable.$inferSelect;

  if (existing) {
    const [updated] = await db
      .update(securityClearancesTable)
      .set({ clearanceLevel, ...rest, updatedAt: new Date() })
      .where(eq(securityClearancesTable.employeeId, empId))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(securityClearancesTable)
      .values({ employeeId: empId, clearanceLevel, ...rest })
      .returning();
    row = inserted;
  }

  res.status(existing ? 200 : 201).json(await enrichClearance(row));
});

// GET /security-clearances/:id
router.get("/security-clearances/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(securityClearancesTable).where(eq(securityClearancesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Security clearance not found" });
    return;
  }
  res.json(await enrichClearance(row));
});

// PATCH /security-clearances/:id
router.patch("/security-clearances/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(securityClearancesTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(securityClearancesTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Security clearance not found" });
    return;
  }
  res.json(await enrichClearance(row));
});

export default router;
