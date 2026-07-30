import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, employmentContractsTable, auditLogsTable } from "@workspace/db";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { employeeId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (employeeId) conditions.push(eq(employmentContractsTable.employeeId, parseInt(employeeId)));
    if (status) conditions.push(eq(employmentContractsTable.status, status));

    const query = db.select().from(employmentContractsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(employmentContractsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(employmentContractsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(employmentContractsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/", async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(employmentContractsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "create", entityType: "employment_contract", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(employmentContractsTable).where(eq(employmentContractsTable.id, parseInt(req.params.id)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.update(employmentContractsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(employmentContractsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({ actorUserId: (req as any).session?.userId ?? null, action: "update", entityType: "employment_contract", entityId: row.id, changesJson: JSON.stringify(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
