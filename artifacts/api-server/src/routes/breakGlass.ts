import { Router } from "express";
import { db, breakGlassAccessTable, systemUsersTable, auditLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichBGA(r: typeof breakGlassAccessTable.$inferSelect) {
  let userName: string | null = null;
  if (r.userId) {
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, r.userId));
    if (user) userName = user.fullNameEn ?? user.username;
  }
  return { ...r, userName };
}

// GET /break-glass
router.get("/break-glass", async (req, res): Promise<void> => {
  const { userId, isActive } = req.query as Record<string, string>;

  const conditions = [];
  if (userId) conditions.push(eq(breakGlassAccessTable.userId, parseInt(userId, 10)));
  if (isActive === "true") conditions.push(eq(breakGlassAccessTable.isActive, true));
  if (isActive === "false") conditions.push(eq(breakGlassAccessTable.isActive, false));

  const rows = conditions.length
    ? await db.select().from(breakGlassAccessTable).where(and(...conditions))
    : await db.select().from(breakGlassAccessTable);

  const enriched = await Promise.all(rows.map(enrichBGA));
  res.json(enriched);
});

// POST /break-glass
router.post("/break-glass", async (req, res): Promise<void> => {
  const { userId, resourceType, justification, ttlMinutes, ...rest } = req.body;

  if (!userId || !resourceType || !justification) {
    res.status(400).json({ error: "userId, resourceType, justification are required" });
    return;
  }

  const expiresAt = new Date(Date.now() + (ttlMinutes ?? 60) * 60000);

  const [newRecord] = await db
    .insert(breakGlassAccessTable)
    .values({
      userId: parseInt(userId, 10),
      resourceType,
      justification,
      isActive: true,
      expiresAt,
      ...rest,
    })
    .returning();

  // Log to audit
  await db.insert(auditLogsTable).values({
    action: "break_glass.granted",
    entityType: "break_glass_access",
    entityId: newRecord.id,
    entityLabel: resourceType,
    changesJson: JSON.stringify({ userId, resourceType, justification }),
  });

  res.status(201).json(await enrichBGA(newRecord));
});

// POST /break-glass/:id/revoke
router.post("/break-glass/:id/revoke", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { reason, revokedByUserId } = req.body;

  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  const [row] = await db
    .update(breakGlassAccessTable)
    .set({
      isActive: false,
      revokedAt: new Date(),
      revokedByUserId: revokedByUserId ? parseInt(revokedByUserId, 10) : null,
      revocationReason: reason,
    })
    .where(eq(breakGlassAccessTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Break-glass access record not found" });
    return;
  }

  // Log to audit
  await db.insert(auditLogsTable).values({
    action: "break_glass.revoked",
    entityType: "break_glass_access",
    entityId: id,
    entityLabel: row.resourceType,
    changesJson: JSON.stringify({ reason, revokedByUserId }),
  });

  res.json(await enrichBGA(row));
});

export default router;
