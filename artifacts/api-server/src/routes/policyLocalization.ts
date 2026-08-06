import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import {
  db, auditLogsTable,
  policyLocalesTable, numberingSchemesTable, employmentTypeConfigsTable,
  calendarConfigsTable, retentionRulesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateEmploymentTypeConfigBody } from "@workspace/api-zod";
import { resolveOrgId, orgOwnershipGuard } from "../lib/orgContext";

const router = Router();

// Org-ownership guards: cross-org access to another org's config rows 404s.
router.use("/policy-locales/:id", orgOwnershipGuard(policyLocalesTable, policyLocalesTable.orgId, policyLocalesTable.id));
router.use("/numbering-schemes/:id", orgOwnershipGuard(numberingSchemesTable, numberingSchemesTable.orgId, numberingSchemesTable.id));
router.use("/employment-type-configs/:id", orgOwnershipGuard(employmentTypeConfigsTable, employmentTypeConfigsTable.orgId, employmentTypeConfigsTable.id));
router.use("/calendar-configs/:id", orgOwnershipGuard(calendarConfigsTable, calendarConfigsTable.orgId, calendarConfigsTable.id));
router.use("/retention-rules/:id", orgOwnershipGuard(retentionRulesTable, retentionRulesTable.orgId, retentionRulesTable.id));

// ─── Policy Locales ──────────────────────────────────────────────────────────

router.get("/policy-locales", async (req, res): Promise<void> => {
  try {
    // Tenant-scoped: always the active org context
    const effectiveOrgId = await resolveOrgId(req);
    const rows = await db.select().from(policyLocalesTable).where(eq(policyLocalesTable.orgId, effectiveOrgId));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/policy-locales", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const [row] = await db.insert(policyLocalesTable).values({ ...req.body, orgId: await resolveOrgId(req), updatedByUserId: actorUserId }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "policy_locale", entityId: row.id, entityLabel: `Org ${row.orgId} locale`, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/policy-locales/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(policyLocalesTable).where(eq(policyLocalesTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/policy-locales/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(policyLocalesTable).where(eq(policyLocalesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(policyLocalesTable).set({ ...req.body, updatedByUserId: actorUserId, updatedAt: new Date() }).where(eq(policyLocalesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "policy_locale", entityId: id, entityLabel: `Org ${row.orgId} locale`, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/policy-locales/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.delete(policyLocalesTable).where(eq(policyLocalesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "policy_locale", entityId: id, entityLabel: `Org ${row.orgId} locale`, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Numbering Schemes ───────────────────────────────────────────────────────

router.get("/numbering-schemes", async (req, res): Promise<void> => {
  try {
    // Tenant-scoped: always the active org context
    const effectiveOrgId = await resolveOrgId(req);
    const rows = await db.select().from(numberingSchemesTable).where(eq(numberingSchemesTable.orgId, effectiveOrgId));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/numbering-schemes", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const [row] = await db.insert(numberingSchemesTable).values({ ...req.body, orgId: await resolveOrgId(req) }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "numbering_scheme", entityId: row.id, entityLabel: row.entityType, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /numbering-schemes/:id/increment — static before /:id
router.post("/numbering-schemes/:id/increment", async (req, res): Promise<void> => {
  try {
    const { isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [scheme] = await db.select().from(numberingSchemesTable).where(eq(numberingSchemesTable.id, id));
    if (!scheme) return void res.status(404).json({ error: "Not found" });

    const next = scheme.currentSequence + 1;
    await db.update(numberingSchemesTable).set({ currentSequence: next, updatedAt: new Date() }).where(eq(numberingSchemesTable.id, id));

    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const padded = String(next).padStart(scheme.sequencePadding, "0");

    let formatted = scheme.template
      .replace("{YYYY}", yyyy)
      .replace("{YY}", yyyy.slice(2))
      .replace("{MM}", mm)
      .replace("{NNNN}", padded)
      .replace("{NNN}", String(next).padStart(3, "0"))
      .replace("{NN}", String(next).padStart(2, "0"));

    res.json({ nextNumber: formatted, sequence: next });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/numbering-schemes/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(numberingSchemesTable).where(eq(numberingSchemesTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/numbering-schemes/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(numberingSchemesTable).where(eq(numberingSchemesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(numberingSchemesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(numberingSchemesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "numbering_scheme", entityId: id, entityLabel: row.entityType, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/numbering-schemes/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.delete(numberingSchemesTable).where(eq(numberingSchemesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "numbering_scheme", entityId: id, entityLabel: row.entityType, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Employment Type Configs ──────────────────────────────────────────────────

router.get("/employment-type-configs", async (req, res): Promise<void> => {
  try {
    // Tenant-scoped: always the active org context
    const effectiveOrgId = await resolveOrgId(req);
    const rows = await db.select().from(employmentTypeConfigsTable).where(eq(employmentTypeConfigsTable.orgId, effectiveOrgId));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/employment-type-configs", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const parsed = CreateEmploymentTypeConfigBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const [row] = await db.insert(employmentTypeConfigsTable).values({ ...parsed.data, orgId: parsed.data.orgId ?? await resolveOrgId(req) }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "employment_type_config", entityId: row.id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/employment-type-configs/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(employmentTypeConfigsTable).where(eq(employmentTypeConfigsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/employment-type-configs/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(employmentTypeConfigsTable).where(eq(employmentTypeConfigsTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(employmentTypeConfigsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(employmentTypeConfigsTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "employment_type_config", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/employment-type-configs/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.delete(employmentTypeConfigsTable).where(eq(employmentTypeConfigsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "employment_type_config", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Calendar Configs ─────────────────────────────────────────────────────────

router.get("/calendar-configs", async (req, res): Promise<void> => {
  try {
    // Tenant-scoped: always the active org context
    const effectiveOrgId = await resolveOrgId(req);
    const rows = await db.select().from(calendarConfigsTable).where(eq(calendarConfigsTable.orgId, effectiveOrgId));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/calendar-configs", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const [row] = await db.insert(calendarConfigsTable).values({ ...req.body, orgId: await resolveOrgId(req), updatedByUserId: actorUserId }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "calendar_config", entityId: row.id, entityLabel: `Org ${row.orgId} calendar`, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/calendar-configs/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(calendarConfigsTable).where(eq(calendarConfigsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/calendar-configs/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(calendarConfigsTable).where(eq(calendarConfigsTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(calendarConfigsTable).set({ ...req.body, updatedByUserId: actorUserId, updatedAt: new Date() }).where(eq(calendarConfigsTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "calendar_config", entityId: id, entityLabel: `Org ${row.orgId} calendar`, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/calendar-configs/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.delete(calendarConfigsTable).where(eq(calendarConfigsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "calendar_config", entityId: id, entityLabel: `Org ${row.orgId} calendar`, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Retention Rules ──────────────────────────────────────────────────────────

router.get("/retention-rules", async (req, res): Promise<void> => {
  try {
    // Tenant-scoped: always the active org context
    const effectiveOrgId = await resolveOrgId(req);
    const rows = await db.select().from(retentionRulesTable).where(eq(retentionRulesTable.orgId, effectiveOrgId));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/retention-rules", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const [row] = await db.insert(retentionRulesTable).values({ ...req.body, orgId: await resolveOrgId(req) }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "retention_rule", entityId: row.id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/retention-rules/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(retentionRulesTable).where(eq(retentionRulesTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/retention-rules/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(retentionRulesTable).where(eq(retentionRulesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(retentionRulesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(retentionRulesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "retention_rule", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/retention-rules/:id", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    const id = parseInt(req.params.id);
    const [row] = await db.delete(retentionRulesTable).where(eq(retentionRulesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "retention_rule", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
