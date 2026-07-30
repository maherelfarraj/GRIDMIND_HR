import { Router } from "express";
import { db, orgUnitsTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /org-units — flat list with filters
router.get("/org-units", async (req, res): Promise<void> => {
  const { unitType, organizationType, parentId } = req.query as Record<string, string>;

  const conditions = [];
  if (unitType) conditions.push(eq(orgUnitsTable.unitType, unitType));
  if (organizationType) conditions.push(eq(orgUnitsTable.organizationType, organizationType));
  if (parentId !== undefined) {
    if (parentId === "null") {
      // handled manually below
    } else {
      conditions.push(eq(orgUnitsTable.parentId, parseInt(parentId, 10)));
    }
  }

  let rows = conditions.length
    ? await db.select().from(orgUnitsTable).where(and(...conditions))
    : await db.select().from(orgUnitsTable);

  if (parentId === "null") {
    rows = rows.filter((r) => r.parentId === null);
  }

  res.json(rows);
});

// GET /org-units/tree — MUST be before /:id
router.get("/org-units/tree", async (req, res): Promise<void> => {
  const allUnits = await db.select().from(orgUnitsTable);

  // Fetch all commanders in one pass
  const commanderIds = allUnits
    .filter((u) => u.commanderEmployeeId !== null)
    .map((u) => u.commanderEmployeeId as number);

  const commanderMap: Record<number, string> = {};
  if (commanderIds.length > 0) {
    const empRows = await db.select().from(employeesTable);
    for (const emp of empRows) {
      commanderMap[emp.id] = emp.firstNameEn + " " + emp.lastNameEn;
    }
  }

  type TreeNode = typeof orgUnitsTable.$inferSelect & {
    commanderNameEn: string | null;
    parentNameEn: string | null;
    children: TreeNode[];
  };

  const unitNameMap: Record<number, string> = {};
  for (const u of allUnits) {
    unitNameMap[u.id] = u.nameEn;
  }

  const nodeMap: Record<number, TreeNode> = {};
  for (const u of allUnits) {
    nodeMap[u.id] = {
      ...u,
      commanderNameEn: u.commanderEmployeeId ? (commanderMap[u.commanderEmployeeId] ?? null) : null,
      parentNameEn: u.parentId ? (unitNameMap[u.parentId] ?? null) : null,
      children: [],
    };
  }

  const roots: TreeNode[] = [];
  for (const node of Object.values(nodeMap)) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = nodeMap[node.parentId];
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  res.json(roots);
});

// POST /org-units
router.post("/org-units", async (req, res): Promise<void> => {
  const { unitCode, nameEn, nameAr, unitType, ...rest } = req.body;

  if (!unitCode || !nameEn || !nameAr || !unitType) {
    res.status(400).json({ error: "unitCode, nameEn, nameAr, unitType are required" });
    return;
  }

  const [row] = await db
    .insert(orgUnitsTable)
    .values({ unitCode, nameEn, nameAr, unitType, ...rest })
    .returning();

  res.status(201).json(row);
});

// GET /org-units/:id
router.get("/org-units/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [unit] = await db.select().from(orgUnitsTable).where(eq(orgUnitsTable.id, id));
  if (!unit) {
    res.status(404).json({ error: "Org unit not found" });
    return;
  }

  let commanderNameEn: string | null = null;
  if (unit.commanderEmployeeId) {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, unit.commanderEmployeeId));
    if (emp) commanderNameEn = emp.firstNameEn + " " + emp.lastNameEn;
  }

  let parentNameEn: string | null = null;
  if (unit.parentId) {
    const [parent] = await db.select().from(orgUnitsTable).where(eq(orgUnitsTable.id, unit.parentId));
    if (parent) parentNameEn = parent.nameEn;
  }

  res.json({ ...unit, commanderNameEn, parentNameEn });
});

// PATCH /org-units/:id
router.patch("/org-units/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .update(orgUnitsTable)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(orgUnitsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Org unit not found" });
    return;
  }
  res.json(row);
});

// DELETE /org-units/:id
router.delete("/org-units/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(orgUnitsTable)
    .where(eq(orgUnitsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Org unit not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
