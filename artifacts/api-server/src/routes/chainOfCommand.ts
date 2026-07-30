import { Router } from "express";
import { db, chainOfCommandTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichCoC(e: typeof chainOfCommandTable.$inferSelect) {
  let employeeNameEn: string | null = null;
  if (e.employeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, e.employeeId));
    if (emp) employeeNameEn = emp.firstNameEn + " " + emp.lastNameEn;
  }

  let supervisorNameEn: string | null = null;
  if (e.supervisorEmployeeId) {
    const [sup] = await db.select().from(employeesTable).where(eq(employeesTable.id, e.supervisorEmployeeId));
    if (sup) supervisorNameEn = sup.firstNameEn + " " + sup.lastNameEn;
  }

  return { ...e, employeeNameEn, supervisorNameEn };
}

// GET /chain-of-command
router.get("/chain-of-command", async (req, res): Promise<void> => {
  const { employeeId, supervisorEmployeeId } = req.query as Record<string, string>;

  const conditions = [];
  if (employeeId) conditions.push(eq(chainOfCommandTable.employeeId, parseInt(employeeId, 10)));
  if (supervisorEmployeeId) conditions.push(eq(chainOfCommandTable.supervisorEmployeeId, parseInt(supervisorEmployeeId, 10)));

  const rows = conditions.length
    ? await db.select().from(chainOfCommandTable).where(and(...conditions))
    : await db.select().from(chainOfCommandTable);

  const enriched = await Promise.all(rows.map(enrichCoC));
  res.json(enriched);
});

// POST /chain-of-command
router.post("/chain-of-command", async (req, res): Promise<void> => {
  const { employeeId, supervisorEmployeeId, relationshipType, effectiveFrom, ...rest } = req.body;

  if (!employeeId || !supervisorEmployeeId || !relationshipType || !effectiveFrom) {
    res.status(400).json({ error: "employeeId, supervisorEmployeeId, relationshipType, effectiveFrom are required" });
    return;
  }

  const [row] = await db
    .insert(chainOfCommandTable)
    .values({
      employeeId: parseInt(employeeId, 10),
      supervisorEmployeeId: parseInt(supervisorEmployeeId, 10),
      relationshipType,
      effectiveFrom,
      ...rest,
    })
    .returning();

  res.status(201).json(await enrichCoC(row));
});

// PATCH /chain-of-command/:id
router.patch("/chain-of-command/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(chainOfCommandTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(chainOfCommandTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Chain of command entry not found" });
    return;
  }
  res.json(await enrichCoC(row));
});

// DELETE /chain-of-command/:id
router.delete("/chain-of-command/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(chainOfCommandTable)
    .where(eq(chainOfCommandTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Chain of command entry not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
