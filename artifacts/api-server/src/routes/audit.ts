import { Router } from "express";
import { db, auditLogsTable, systemUsersTable } from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, ilike, or } from "drizzle-orm";
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
  if (q.actorUserName) {
    // Find users whose name matches the search string, then filter audit logs by those IDs
    const matchedUsers = await db
      .select({ id: systemUsersTable.id })
      .from(systemUsersTable)
      .where(or(
        ilike(systemUsersTable.fullNameEn, `%${q.actorUserName}%`),
        ilike(systemUsersTable.fullNameAr, `%${q.actorUserName}%`),
        ilike(systemUsersTable.username, `%${q.actorUserName}%`),
      ));
    const matchedIds = matchedUsers.map((u) => u.id);
    if (matchedIds.length === 0) {
      // No users match — return empty result immediately
      res.json({ data: [], total: 0, page: q.page ?? 1, limit: q.limit ?? 50 });
      return;
    }
    conditions.push(inArray(auditLogsTable.actorUserId, matchedIds));
  }
  if (q.from) conditions.push(gte(auditLogsTable.createdAt, new Date(q.from)));
  if (q.to) {
    // When `to` is a date-only string (YYYY-MM-DD), treat it as end-of-day
    // so the range is inclusive of all records on that day.
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(q.to)
      ? new Date(`${q.to}T23:59:59.999Z`)
      : new Date(q.to);
    conditions.push(lte(auditLogsTable.createdAt, toDate));
  }

  const page = q.page ?? 1;
  const VALID_LIMITS = [50, 100, 200] as const;
  const rawLimit = q.limit ?? 50;
  if (rawLimit !== null && !VALID_LIMITS.includes(rawLimit as (typeof VALID_LIMITS)[number])) {
    res.status(400).json({ error: `Invalid limit "${rawLimit}". Allowed values: 50, 100, 200.` });
    return;
  }
  const limit = (VALID_LIMITS as readonly number[]).includes(rawLimit) ? rawLimit : 50;
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
