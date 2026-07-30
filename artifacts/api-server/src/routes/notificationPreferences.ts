import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, notificationPreferencesTable } from "@workspace/db";

const router = Router();

// GET / — get by userId
router.get("/", async (req, res): Promise<void> => {
  try {
    const sessionUserId = (req as any).session?.userId ?? 0;
    const userId = req.query.userId ? parseInt(req.query.userId as string) : sessionUserId;
    const [row] = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId));
    if (!row) { res.json(null); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /:userId — upsert preferences for userId
router.put("/:userId", async (req, res): Promise<void> => {
  try {
    const userId = parseInt(req.params.userId);
    const [existing] = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId));

    if (existing) {
      const [row] = await db.update(notificationPreferencesTable)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(notificationPreferencesTable.userId, userId))
        .returning();
      res.json(row);
    } else {
      const [row] = await db.insert(notificationPreferencesTable)
        .values({ ...req.body, userId })
        .returning();
      res.status(201).json(row);
    }
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
