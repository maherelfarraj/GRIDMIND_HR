import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, healthChecksTable } from "@workspace/db";

const router = Router();

// GET /results — MUST be registered BEFORE /:id
router.get("/results", async (req, res): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const { checkType, status } = req.query as Record<string, string>;

    const conditions = [];
    if (checkType) conditions.push(eq(healthChecksTable.checkType, checkType));
    if (status) conditions.push(eq(healthChecksTable.status, status));

    const rows = conditions.length > 0
      ? await db.select().from(healthChecksTable).where(and(...conditions)).orderBy(desc(healthChecksTable.checkedAt)).limit(limit)
      : await db.select().from(healthChecksTable).orderBy(desc(healthChecksTable.checkedAt)).limit(limit);

    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /run — simulate health checks for given types
router.post("/run", async (req, res): Promise<void> => {
  try {
    const checkTypes: string[] = req.body.checkTypes ?? ["database", "storage", "api", "auth", "backup"];
    const results = [];

    for (const checkType of checkTypes) {
      const responseTimeMs = Math.floor(Math.random() * 200);
      const [row] = await db.insert(healthChecksTable).values({
        checkType,
        checkName: checkType.charAt(0).toUpperCase() + checkType.slice(1) + " Check",
        status: "pass",
        message: "Check passed",
        responseTimeMs,
        triggeredBy: "api",
      }).returning();
      results.push(row);
    }

    res.status(201).json({ results, simulated: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
