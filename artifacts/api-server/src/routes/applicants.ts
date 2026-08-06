import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, applicantsTable, auditLogsTable } from "@workspace/db";
import { CreateApplicantBody, UpdateApplicantBody } from "@workspace/api-zod";
import { validateBody } from "../middleware/validateBody.js";

const router = Router();

// GET /applicants — paginated list with optional type filter
router.get("/", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const { applicantType } = req.query as Record<string, string>;

    const conditions = [];
    if (applicantType) conditions.push(eq(applicantsTable.applicantType, applicantType));

    const query = db.select().from(applicantsTable);
    const countQuery = db.select({ count: sql`count(*)` }).from(applicantsTable);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(applicantsTable.createdAt)).limit(limit).offset(offset)
      : await query.orderBy(desc(applicantsTable.createdAt)).limit(limit).offset(offset);

    const [{ count }] = conditions.length > 0
      ? await countQuery.where(and(...conditions))
      : await countQuery;

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /applicants — create a new applicant
router.post("/", validateBody(CreateApplicantBody), async (req, res): Promise<void> => {
  try {
    const actorUserId: number = getActorUserId(req);
    const [row] = await db.insert(applicantsTable).values(req.body).returning();
    await db.insert(auditLogsTable).values({
      actorUserId, action: "create",
      entityType: "applicant", entityId: row.id,
      changesJson: JSON.stringify(req.body),
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /applicants/:id — single applicant
router.get("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const [row] = await db.select().from(applicantsTable).where(eq(applicantsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /applicants/:id — update an applicant
router.patch("/:id", validateBody(UpdateApplicantBody.partial()), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const actorUserId: number = getActorUserId(req);
    const [row] = await db.update(applicantsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(applicantsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({
      actorUserId, action: "update",
      entityType: "applicant", entityId: id,
      changesJson: JSON.stringify(req.body),
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
