import { Router } from "express";
import { db, systemConfigTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router = Router();

// GET /system-config — list all; optionally filter by ?category=xxx
router.get("/system-config", async (req, res): Promise<void> => {
  const { category } = req.query as Record<string, string>;
  let rows;
  if (category) {
    rows = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.category, category))
      .orderBy(asc(systemConfigTable.category), asc(systemConfigTable.key));
  } else {
    rows = await db
      .select()
      .from(systemConfigTable)
      .orderBy(asc(systemConfigTable.category), asc(systemConfigTable.key));
  }
  res.json(rows);
});

// PATCH /system-config — body is object like { "org.type": "military", "sec.level": "restricted" }
router.patch("/system-config", async (req, res): Promise<void> => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "Body must be an object of key-value pairs" });
    return;
  }

  const updated: typeof systemConfigTable.$inferSelect[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const [existing] = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, key));

    if (!existing) continue;
    if (existing.isReadonly) continue; // skip readonly silently

    const [row] = await db
      .update(systemConfigTable)
      .set({ value: String(value), updatedAt: new Date() })
      .where(eq(systemConfigTable.key, key))
      .returning();

    if (row) updated.push(row);
  }

  res.json(updated);
});

export default router;
