import { Router } from "express";
import { db, documentsTable, employeesTable, systemUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateDocumentBody, UpdateDocumentBody, ListDocumentsQueryParams } from "@workspace/api-zod";
import { getActorUserId } from "../middleware/requireAuth.js";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function buildDocResponse(d: typeof documentsTable.$inferSelect) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, d.employeeId));
  const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, d.uploadedByUserId));
  return {
    ...d,
    employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
    uploadedByUserName: user?.fullNameEn ?? "System",
    expiresAt: d.expiresAt ?? null,
    issuedAt: d.issuedAt ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/documents", async (req, res): Promise<void> => {
  const parsed = ListDocumentsQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const conditions = [];
  if (q.employeeId) conditions.push(eq(documentsTable.employeeId, q.employeeId));
  if (q.category) conditions.push(eq(documentsTable.category, q.category));
  if (q.status) conditions.push(eq(documentsTable.status, q.status));

  const docs = conditions.length > 0
    ? await db.select().from(documentsTable).where(and(...conditions))
    : await db.select().from(documentsTable);

  const emps = await db.select().from(employeesTable);
  const users = await db.select().from(systemUsersTable);
  const empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const result = docs.map((d) => {
    const emp = empMap[d.employeeId];
    const user = userMap[d.uploadedByUserId];
    return {
      ...d,
      employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      uploadedByUserName: user?.fullNameEn ?? "System",
      expiresAt: d.expiresAt ?? null,
      issuedAt: d.issuedAt ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  });
  res.json(result);
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [doc] = await db.insert(documentsTable).values({
    ...parsed.data,
    // uploadedByUserId is not part of the public CreateDocumentBody spec;
    // it is attributed server-side from the authenticated session actor.
    uploadedByUserId: getActorUserId(req),
  }).returning();
  res.status(201).json(await buildDocResponse(doc));
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildDocResponse(doc));
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [doc] = await db.update(documentsTable).set(parsed.data).where(eq(documentsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await buildDocResponse(doc));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.status(204).end();
});

export default router;
