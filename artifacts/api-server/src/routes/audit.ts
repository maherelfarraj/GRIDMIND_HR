import { Router } from "express";
import { db, auditLogsTable, systemUsersTable } from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, ilike } from "drizzle-orm";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/audit-logs", async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const conditions = [];
  if (q.entityType) conditions.push(eq(auditLogsTable.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLogsTable.entityId, q.entityId));
  if (q.action) {
    // Supports a single action or a comma-separated list (e.g. "login.failed,login.lockout")
    const actions = q.action.split(",").map((a) => a.trim()).filter(Boolean);
    if (actions.length === 1) conditions.push(eq(auditLogsTable.action, actions[0]));
    else if (actions.length > 1) conditions.push(inArray(auditLogsTable.action, actions));
  }
  if (q.entityLabel) conditions.push(ilike(auditLogsTable.entityLabel, `%${q.entityLabel}%`));
  if (q.ipAddress) conditions.push(ilike(auditLogsTable.ipAddress, `%${q.ipAddress}%`));
  if (q.actorUserId) conditions.push(eq(auditLogsTable.actorUserId, q.actorUserId));
  if (q.from) conditions.push(gte(auditLogsTable.createdAt, new Date(q.from)));
  if (q.to) conditions.push(lte(auditLogsTable.createdAt, new Date(q.to)));

  const page = q.page ?? 1;
  const limit = q.limit ?? 50;
  const offset = (page - 1) * limit;

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = where
    ? await db.select().from(auditLogsTable)
        .where(where)
        .orderBy(sql`${auditLogsTable.createdAt} desc`)
        .limit(limit).offset(offset)
    : await db.select().from(auditLogsTable)
        .orderBy(sql`${auditLogsTable.createdAt} desc`)
        .limit(limit).offset(offset);

  const users = await db.select().from(systemUsersTable);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const data = logs.map((l) => ({
    id: l.id,
    actorUserId: l.actorUserId,
    actorUserName: l.actorUserId ? (userMap[l.actorUserId]?.fullNameEn ?? `User #${l.actorUserId}`) : null,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    entityLabel: l.entityLabel,
    changesJson: l.changesJson,
    ipAddress: l.ipAddress,
    userAgent: l.userAgent,
    createdAt: l.createdAt.toISOString(),
  }));

  const [{ total }] = where
    ? await db.select({ total: sql<number>`count(*)::int` }).from(auditLogsTable).where(where)
    : await db.select({ total: sql<number>`count(*)::int` }).from(auditLogsTable);
  res.json({ data, total, page, limit });
});

export default router;
