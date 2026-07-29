import { Router } from "express";
import { db, auditLogsTable, systemUsersTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/audit-logs", async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const conditions = [];
  if (q.entityType) conditions.push(eq(auditLogsTable.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLogsTable.entityId, q.entityId));
  if (q.actorUserId) conditions.push(eq(auditLogsTable.actorUserId, q.actorUserId));
  if (q.from) conditions.push(gte(auditLogsTable.createdAt, new Date(q.from)));
  if (q.to) conditions.push(lte(auditLogsTable.createdAt, new Date(q.to)));

  const page = q.page ?? 1;
  const limit = q.limit ?? 50;
  const offset = (page - 1) * limit;

  const logs = conditions.length > 0
    ? await db.select().from(auditLogsTable)
        .where(and(...conditions))
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

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogsTable);
  res.json({ data, total, page, limit });
});

export default router;
