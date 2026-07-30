import { Router } from "express";
import { db, dualAuthRequestsTable, systemUsersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

async function enrichDualAuth(r: typeof dualAuthRequestsTable.$inferSelect) {
  let initiatedByUserName: string | null = null;
  if (r.initiatedByUserId) {
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, r.initiatedByUserId));
    if (user) initiatedByUserName = user.fullNameEn;
  }
  return { ...r, initiatedByUserName };
}

// GET /dual-auth
router.get("/dual-auth", async (req, res): Promise<void> => {
  const { status, actionType } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(dualAuthRequestsTable.status, status));
  if (actionType) conditions.push(eq(dualAuthRequestsTable.actionType, actionType));

  const rows = conditions.length
    ? await db.select().from(dualAuthRequestsTable).where(and(...conditions)).orderBy(desc(dualAuthRequestsTable.createdAt))
    : await db.select().from(dualAuthRequestsTable).orderBy(desc(dualAuthRequestsTable.createdAt));

  const enriched = await Promise.all(rows.map(enrichDualAuth));
  res.json(enriched);
});

// POST /dual-auth
router.post("/dual-auth", async (req, res): Promise<void> => {
  const { actionType, descriptionEn, ttlMinutes, initiatedByUserId, ...rest } = req.body;

  if (!actionType || !descriptionEn) {
    res.status(400).json({ error: "actionType, descriptionEn are required" });
    return;
  }

  if (!initiatedByUserId) {
    res.status(400).json({ error: "initiatedByUserId is required" });
    return;
  }

  const expiresAt = new Date(Date.now() + (ttlMinutes ?? 60) * 60000);

  const [row] = await db
    .insert(dualAuthRequestsTable)
    .values({
      actionType,
      descriptionEn,
      initiatedByUserId: parseInt(initiatedByUserId, 10),
      status: "pending",
      expiresAt,
      ...rest,
    })
    .returning();

  res.status(201).json(await enrichDualAuth(row));
});

// POST /dual-auth/:id/approve
router.post("/dual-auth/:id/approve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { approverUserId, notes } = req.body;

  const [request] = await db.select().from(dualAuthRequestsTable).where(eq(dualAuthRequestsTable.id, id));
  if (!request) {
    res.status(404).json({ error: "Dual-auth request not found" });
    return;
  }

  const approverId = parseInt(approverUserId, 10);
  let updated: typeof dualAuthRequestsTable.$inferSelect;

  if (request.status === "pending") {
    const [row] = await db
      .update(dualAuthRequestsTable)
      .set({
        firstApproverUserId: approverId,
        firstApprovedAt: new Date(),
        firstApproverNotes: notes ?? null,
        status: "first_approved",
        updatedAt: new Date(),
      })
      .where(eq(dualAuthRequestsTable.id, id))
      .returning();
    updated = row;
  } else if (request.status === "first_approved") {
    if (approverId === request.firstApproverUserId) {
      res.status(400).json({ error: "Separation of duties: same user cannot approve both steps" });
      return;
    }
    const [row] = await db
      .update(dualAuthRequestsTable)
      .set({
        secondApproverUserId: approverId,
        secondApprovedAt: new Date(),
        secondApproverNotes: notes ?? null,
        status: "approved",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dualAuthRequestsTable.id, id))
      .returning();
    updated = row;
  } else {
    res.status(400).json({ error: `Cannot approve request with status: ${request.status}` });
    return;
  }

  res.json(await enrichDualAuth(updated));
});

// POST /dual-auth/:id/reject
router.post("/dual-auth/:id/reject", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { approverUserId, notes } = req.body;

  const [row] = await db
    .update(dualAuthRequestsTable)
    .set({
      status: "rejected",
      rejectedByUserId: approverUserId ? parseInt(approverUserId, 10) : null,
      rejectionReason: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dualAuthRequestsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Dual-auth request not found" });
    return;
  }

  res.json(await enrichDualAuth(row));
});

export default router;
