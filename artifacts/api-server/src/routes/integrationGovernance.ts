import { Router } from "express";
import {
  db, auditLogsTable,
  integrationCredentialVaultRefsTable, integrationConnectionProfilesTable,
  integrationGovernanceRulesTable, integrationAuditLogTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// ─── Credential Vault Refs ────────────────────────────────────────────────────

router.get("/integration-governance/credential-vault-refs", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(integrationCredentialVaultRefsTable).orderBy(desc(integrationCredentialVaultRefsTable.createdAt));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/integration-governance/credential-vault-refs", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.insert(integrationCredentialVaultRefsTable).values({
      ...req.body, createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "credential_vault_ref", entityId: row.id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/integration-governance/credential-vault-refs/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/integration-governance/credential-vault-refs/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(integrationCredentialVaultRefsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(integrationCredentialVaultRefsTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "credential_vault_ref", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/integration-governance/credential-vault-refs/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.delete(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "credential_vault_ref", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Connection Profiles ──────────────────────────────────────────────────────

router.get("/integration-governance/connection-profiles", async (req, res): Promise<void> => {
  try {
    const { orgId, governanceStatus, integrationType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (orgId) conditions.push(eq(integrationConnectionProfilesTable.orgId, parseInt(orgId)));
    if (governanceStatus) conditions.push(eq(integrationConnectionProfilesTable.governanceStatus, governanceStatus));
    if (integrationType) conditions.push(eq(integrationConnectionProfilesTable.integrationType, integrationType));
    const rows = conditions.length
      ? await db.select().from(integrationConnectionProfilesTable).where(and(...conditions)).orderBy(desc(integrationConnectionProfilesTable.createdAt))
      : await db.select().from(integrationConnectionProfilesTable).orderBy(desc(integrationConnectionProfilesTable.createdAt));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/integration-governance/connection-profiles", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.insert(integrationConnectionProfilesTable).values({
      ...req.body, createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "connection_profile", entityId: row.id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /integration-governance/connection-profiles/:id/test — static before /:id
router.post("/integration-governance/connection-profiles/:id/test", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [profile] = await db.select().from(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, id));
    if (!profile) return void res.status(404).json({ error: "Not found" });

    const startTime = Date.now();
    // Simulate test (air-gap safe — no real connection attempt)
    const success = profile.governanceStatus !== "suspended";
    const latencyMs = Math.floor(Math.random() * 200) + 50;
    const testedAt = new Date();
    const message = success ? "Connection test simulated successfully" : "Profile is suspended";

    await db.update(integrationConnectionProfilesTable).set({
      lastTestResult: success ? "success" : "failure",
      lastTestMessage: message,
      lastTestedAt: testedAt,
      lastTestedByUserId: actorUserId,
      status: success ? "active" : "error",
      updatedAt: new Date(),
    }).where(eq(integrationConnectionProfilesTable.id, id));

    await db.insert(integrationAuditLogTable).values({
      profileId: id,
      integrationType: profile.integrationType,
      eventType: success ? "test_passed" : "test_failed",
      outcome: success ? "success" : "failure",
      message,
      metadataJson: JSON.stringify({ latencyMs }),
      actorUserId,
    });

    res.json({ success, message, latencyMs, testedAt: testedAt.toISOString() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /integration-governance/connection-profiles/:id/approve
router.post("/integration-governance/connection-profiles/:id/approve", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(integrationConnectionProfilesTable).set({
      governanceStatus: "approved",
      approvedByUserId: actorUserId,
      approvedAt: new Date(),
      approvalNotes: req.body.approvalNotes ?? null,
      updatedAt: new Date(),
    }).where(eq(integrationConnectionProfilesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });

    await db.insert(integrationAuditLogTable).values({
      profileId: id, integrationType: row.integrationType,
      eventType: "profile_approved", outcome: "success",
      message: "Profile approved", actorUserId,
    });

    await db.insert(auditLogsTable).values({ action: "approve", entityType: "connection_profile", entityId: id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ governanceStatus: "approved" }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /integration-governance/connection-profiles/:id/suspend
router.post("/integration-governance/connection-profiles/:id/suspend", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(integrationConnectionProfilesTable).set({
      governanceStatus: "suspended", status: "disabled", updatedAt: new Date(),
    }).where(eq(integrationConnectionProfilesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });

    await db.insert(integrationAuditLogTable).values({
      profileId: id, integrationType: row.integrationType,
      eventType: "profile_suspended", outcome: "warning",
      message: req.body.reason ?? "Profile suspended", actorUserId,
    });

    await db.insert(auditLogsTable).values({ action: "suspend", entityType: "connection_profile", entityId: id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ governanceStatus: "suspended" }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/integration-governance/connection-profiles/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/integration-governance/connection-profiles/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(integrationConnectionProfilesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(integrationConnectionProfilesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "connection_profile", entityId: id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/integration-governance/connection-profiles/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.delete(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "connection_profile", entityId: id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Governance Rules ─────────────────────────────────────────────────────────

router.get("/integration-governance/governance-rules", async (req, res): Promise<void> => {
  try {
    const { orgId, integrationType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (orgId) conditions.push(eq(integrationGovernanceRulesTable.orgId, parseInt(orgId)));
    if (integrationType) conditions.push(eq(integrationGovernanceRulesTable.integrationType, integrationType));
    const rows = conditions.length
      ? await db.select().from(integrationGovernanceRulesTable).where(and(...conditions))
      : await db.select().from(integrationGovernanceRulesTable);
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/integration-governance/governance-rules", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.insert(integrationGovernanceRulesTable).values({ ...req.body }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "governance_rule", entityId: row.id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/integration-governance/governance-rules/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(integrationGovernanceRulesTable).where(eq(integrationGovernanceRulesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(integrationGovernanceRulesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(integrationGovernanceRulesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "governance_rule", entityId: id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/integration-governance/governance-rules/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.delete(integrationGovernanceRulesTable).where(eq(integrationGovernanceRulesTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "governance_rule", entityId: id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Integration Audit Log ────────────────────────────────────────────────────

router.get("/integration-governance/audit-log", async (req, res): Promise<void> => {
  try {
    const { profileId, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const page = parseInt(pageStr ?? "1");
    const pageSize = parseInt(pageSizeStr ?? "50");
    const offset = (page - 1) * pageSize;
    const rows = profileId
      ? await db.select().from(integrationAuditLogTable)
          .where(eq(integrationAuditLogTable.profileId, parseInt(profileId)))
          .orderBy(desc(integrationAuditLogTable.occurredAt))
          .limit(pageSize).offset(offset)
      : await db.select().from(integrationAuditLogTable)
          .orderBy(desc(integrationAuditLogTable.occurredAt))
          .limit(pageSize).offset(offset);
    res.json({ data: rows, page, pageSize });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
