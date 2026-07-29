import { Router } from "express";
import { db, securityAlertsTable, systemUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ListAlertsQueryParams, AcknowledgeAlertBody } from "@workspace/api-zod";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

function buildAlertResponse(a: typeof securityAlertsTable.$inferSelect, acknowledgedByUserName?: string | null) {
  return {
    ...a,
    acknowledgedByUserName: acknowledgedByUserName ?? null,
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/alerts", async (req, res): Promise<void> => {
  const parsed = ListAlertsQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const conditions = [];
  if (q.severity) conditions.push(eq(securityAlertsTable.severity, q.severity));
  if (q.acknowledged !== undefined && q.acknowledged !== null) {
    conditions.push(eq(securityAlertsTable.acknowledged, q.acknowledged));
  }

  const alerts = conditions.length > 0
    ? await db.select().from(securityAlertsTable).where(and(...conditions))
    : await db.select().from(securityAlertsTable);

  const users = await db.select().from(systemUsersTable);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const result = alerts.map((a) => buildAlertResponse(
    a,
    a.acknowledgedByUserId ? (userMap[a.acknowledgedByUserId]?.fullNameEn ?? null) : null
  ));
  res.json(result);
});

router.patch("/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = AcknowledgeAlertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [alert] = await db.update(securityAlertsTable)
    .set({
      acknowledged: true,
      acknowledgedByUserId: parsed.data.acknowledgedByUserId,
      acknowledgedAt: new Date(),
      acknowledgedNote: parsed.data.acknowledgedNote ?? null,
    })
    .where(eq(securityAlertsTable.id, id))
    .returning();

  if (!alert) { res.status(404).json({ error: "Not found" }); return; }

  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, parsed.data.acknowledgedByUserId));
  res.json(buildAlertResponse(alert, user?.fullNameEn ?? null));
});

export default router;
