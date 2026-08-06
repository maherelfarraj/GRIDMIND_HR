import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import {
  db, auditLogsTable,
  integrationCredentialVaultRefsTable, integrationConnectionProfilesTable,
  integrationGovernanceRulesTable, integrationAuditLogTable, systemUsersTable,
} from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { resolveOrgId, orgOwnershipGuard } from "../lib/orgContext";
import { testLdapConnection, type AdapterResult } from "../lib/ldap-adapter.js";
import { testSmtpConnection } from "../lib/smtp-adapter.js";
import { testDeviceConnection } from "../lib/device-adapter.js";
import { runHealthChecksOnce, raiseHealthRecoveryIfAlerted } from "../lib/health-monitor.js";
import { resolveProfileConnection } from "../lib/profile-connection.js";
import { getSecurityEmailDeliveryStatus } from "../lib/email-alert-status.js";
import { getPepperRotationStatus } from "./attendanceGateway.js";

const router = Router();

// Org-ownership guards: cross-org access to another org's rows 404s.
router.use("/integration-governance/connection-profiles/:id", orgOwnershipGuard(integrationConnectionProfilesTable, integrationConnectionProfilesTable.orgId, integrationConnectionProfilesTable.id));
router.use("/integration-governance/governance-rules/:id", orgOwnershipGuard(integrationGovernanceRulesTable, integrationGovernanceRulesTable.orgId, integrationGovernanceRulesTable.id));

// ─── Vault-ref helpers ────────────────────────────────────────────────────────

/**
 * Returns warning strings for every vault key ref that isn't set in process.env.
 * Never exposes secret values, lengths, or partial contents — only the key name.
 */
function vaultRefWarnings(vaultKeyRef: string, vaultSecretRef?: string | null): string[] {
  const warnings: string[] = [];
  if (!process.env[vaultKeyRef]) {
    warnings.push(`referenced secret ${vaultKeyRef} is not configured`);
  }
  if (vaultSecretRef && !process.env[vaultSecretRef]) {
    warnings.push(`referenced secret ${vaultSecretRef} is not configured`);
  }
  return warnings;
}

/** Adds a `configured` boolean to a vault-ref row. Never exposes the secret value. */
function withConfigured<T extends { vaultKeyRef: string }>(row: T): T & { configured: boolean } {
  return { ...row, configured: Boolean(process.env[row.vaultKeyRef]) };
}

// ─── Security Email Delivery Status ──────────────────────────────────────────

router.get("/integration-governance/security-email-status", async (_req, res): Promise<void> => {
  try {
    res.json(getSecurityEmailDeliveryStatus());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Gateway Pepper Rotation Window ──────────────────────────────────────────

// Surfaces whether the GATEWAY_KEY_PEPPER_PREVIOUS rotation window is still
// open, and whether it can be closed (all envelopes re-wrapped). Admins see a
// governance-page notice instead of relying only on the startup log line.
router.get("/integration-governance/pepper-rotation-status", async (_req, res): Promise<void> => {
  try {
    res.json(await getPepperRotationStatus());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Credential Vault Refs ────────────────────────────────────────────────────

router.get("/integration-governance/credential-vault-refs", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(integrationCredentialVaultRefsTable).orderBy(desc(integrationCredentialVaultRefsTable.createdAt));
    res.json(rows.map(withConfigured));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/integration-governance/credential-vault-refs", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const [row] = await db.insert(integrationCredentialVaultRefsTable).values({
      ...req.body, createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "credential_vault_ref", entityId: row.id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    const warnings = vaultRefWarnings(row.vaultKeyRef, row.vaultSecretRef);
    res.status(201).json({ ...withConfigured(row), warnings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/integration-governance/credential-vault-refs/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(withConfigured(row));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/integration-governance/credential-vault-refs/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(integrationCredentialVaultRefsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(integrationCredentialVaultRefsTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "credential_vault_ref", entityId: id, entityLabel: row.labelEn, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    const warnings = vaultRefWarnings(row.vaultKeyRef, row.vaultSecretRef);
    res.json({ ...withConfigured(row), warnings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/integration-governance/credential-vault-refs/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);

    // Confirm the vault ref exists before opening a transaction.
    const [row] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, id));
    if (!row) return void res.status(404).json({ error: "Not found" });

    // All mutations run in a single transaction: unlink affected profiles,
    // write per-profile audit rows, delete the ref, write the delete audit row.
    // Any failure rolls back the entire operation — no partial state is possible.
    const unlinkedProfileCount = await db.transaction(async (tx) => {
      // Null out credentialVaultRefId on every profile that referenced this ref.
      const affectedProfiles = await tx
        .update(integrationConnectionProfilesTable)
        .set({ credentialVaultRefId: null, updatedAt: new Date() })
        .where(eq(integrationConnectionProfilesTable.credentialVaultRefId, id))
        .returning();

      // Audit each unlinked profile individually so the trail is queryable.
      for (const profile of affectedProfiles) {
        await tx.insert(auditLogsTable).values({
          action: "unlink",
          entityType: "connection_profile",
          entityId: profile.id,
          entityLabel: profile.profileName,
          actorUserId,
          changesJson: JSON.stringify({
            reason: "credential_vault_ref_deleted",
            deletedVaultRefId: id,
            deletedVaultRefLabel: row.labelEn,
            before: { credentialVaultRefId: id },
            after: { credentialVaultRefId: null },
          }),
        });
      }

      // Delete the vault ref itself.
      await tx.delete(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, id));

      // Audit the deletion, recording which profiles were unlinked.
      await tx.insert(auditLogsTable).values({
        action: "delete",
        entityType: "credential_vault_ref",
        entityId: id,
        entityLabel: row.labelEn,
        actorUserId,
        changesJson: JSON.stringify({
          deleted: row,
          unlinkedProfileIds: affectedProfiles.map(p => p.id),
        }),
      });

      return affectedProfiles.length;
    });

    res.json({ success: true, unlinkedProfileCount });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Connection Profiles ──────────────────────────────────────────────────────

router.get("/integration-governance/connection-profiles", async (req, res): Promise<void> => {
  try {
    const { governanceStatus, integrationType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    conditions.push(eq(integrationConnectionProfilesTable.orgId, await resolveOrgId(req)));
    if (governanceStatus) conditions.push(eq(integrationConnectionProfilesTable.governanceStatus, governanceStatus));
    if (integrationType) conditions.push(eq(integrationConnectionProfilesTable.integrationType, integrationType));
    const baseQuery = db
      .select({
        profile: integrationConnectionProfilesTable,
        lastTestedByNameEn: systemUsersTable.fullNameEn,
        lastTestedByNameAr: systemUsersTable.fullNameAr,
      })
      .from(integrationConnectionProfilesTable)
      .leftJoin(systemUsersTable, eq(integrationConnectionProfilesTable.lastTestedByUserId, systemUsersTable.id));
    const rows = conditions.length
      ? await baseQuery.where(and(...conditions)).orderBy(desc(integrationConnectionProfilesTable.createdAt))
      : await baseQuery.orderBy(desc(integrationConnectionProfilesTable.createdAt));
    res.json(rows.map(r => ({ ...r.profile, lastTestedByNameEn: r.lastTestedByNameEn, lastTestedByNameAr: r.lastTestedByNameAr })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/integration-governance/connection-profiles", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const [row] = await db.insert(integrationConnectionProfilesTable).values({
      ...req.body,
      orgId: await resolveOrgId(req), createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "connection_profile", entityId: row.id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ after: row }) });
    const warnings: string[] = [];
    if (row.credentialVaultRefId) {
      const [vaultRef] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, row.credentialVaultRefId));
      if (vaultRef) warnings.push(...vaultRefWarnings(vaultRef.vaultKeyRef, vaultRef.vaultSecretRef));
    }
    res.status(201).json({ ...row, warnings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /integration-governance/connection-profiles/:id/test — static before /:id
router.post("/integration-governance/connection-profiles/:id/test", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);
    const [profile] = await db.select().from(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, id));
    if (!profile) return void res.status(404).json({ error: "Not found" });

    const testRecipient = req.body?.testRecipient;
    if (testRecipient !== undefined && testRecipient !== null && testRecipient !== "") {
      if (typeof testRecipient !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient.trim())) {
        return void res.status(400).json({ error: "Invalid testRecipient: must be a well-formed email address" });
      }
    }

    const testedAt = new Date();
    let success: boolean;
    let message: string;
    let latencyMs: number;
    let simulated: boolean;

    if (profile.governanceStatus === "suspended") {
      success = false;
      message = "Profile is suspended";
      latencyMs = 0;
      simulated = false;
    } else {
      // Per-profile connection settings resolved via shared helper (same logic
      // as the scheduled health monitor so both paths honour per-profile
      // hosts/secrets, falling back to global env vars for absent fields).
      const connOpts = await resolveProfileConnection(profile);

      // Real adapters for LDAP / AD, SMTP, and attendance devices.
      let result: AdapterResult | null = null;
      switch (profile.integrationType) {
        case "ldap":
        case "active_directory":
          result = await testLdapConnection(connOpts.ldap);
          break;
        case "smtp":
          result = await testSmtpConnection(
            typeof testRecipient === "string" ? testRecipient.trim() : undefined,
            connOpts.smtp,
          );
          break;
        case "attendance_device":
          result = await testDeviceConnection(connOpts.device);
          break;
      }
      if (result) {
        success = result.success;
        message = result.message;
        latencyMs = result.latencyMs;
        simulated = false;
      } else {
        // No real adapter for this integration type yet — simulated (air-gap safe).
        success = true;
        message = "Connection test simulated successfully (no real adapter for this integration type)";
        latencyMs = Math.floor(Math.random() * 200) + 50;
        simulated = true;
      }
    }

    await db.update(integrationConnectionProfilesTable).set({
      lastTestResult: success ? "success" : "failure",
      lastTestMessage: message,
      lastTestedAt: testedAt,
      lastTestedByUserId: actorUserId,
      lastTestLatencyMs: latencyMs,
      lastTestSimulated: simulated,
      status: success ? "active" : "error",
      // A manual test participates in the health-failure streak: success
      // clears it, failure extends it (same semantics as the scheduled check).
      consecutiveFailures: success ? 0 : profile.consecutiveFailures + 1,
      updatedAt: new Date(),
    }).where(eq(integrationConnectionProfilesTable.id, id));

    await db.insert(integrationAuditLogTable).values({
      profileId: id,
      integrationType: profile.integrationType,
      eventType: success ? "test_passed" : "test_failed",
      outcome: success ? "success" : "failure",
      message,
      metadataJson: JSON.stringify({ latencyMs, simulated, attempts: 1 }),
      actorUserId,
    });

    // A manual test clears the streak on success too — if the profile had an
    // outstanding health alert, raise the same recovery notice as the
    // scheduled monitor (atomic claim — no duplicates if a sweep races this).
    if (success) {
      await raiseHealthRecoveryIfAlerted(profile, { message, latencyMs, simulated, actorUserId });
    }

    res.json({ success, message, latencyMs, simulated, testedAt: testedAt.toISOString() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /integration-governance/health-checks/run — manually trigger one
// health-monitor sweep (same logic the background scheduler runs every minute).
router.post("/integration-governance/health-checks/run", async (req, res): Promise<void> => {
  try {
    // force=true ignores the per-profile interval (checks every monitored profile now)
    const result = await runHealthChecksOnce({ force: req.body?.force === true });
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /integration-governance/connection-profiles/:id/approve
router.post("/integration-governance/connection-profiles/:id/approve", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
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
    const actorUserId = getActorUserId(req);
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
    const [r] = await db
      .select({
        profile: integrationConnectionProfilesTable,
        lastTestedByNameEn: systemUsersTable.fullNameEn,
        lastTestedByNameAr: systemUsersTable.fullNameAr,
      })
      .from(integrationConnectionProfilesTable)
      .leftJoin(systemUsersTable, eq(integrationConnectionProfilesTable.lastTestedByUserId, systemUsersTable.id))
      .where(eq(integrationConnectionProfilesTable.id, parseInt(req.params.id)));
    if (!r) return void res.status(404).json({ error: "Not found" });
    res.json({ ...r.profile, lastTestedByNameEn: r.lastTestedByNameEn, lastTestedByNameAr: r.lastTestedByNameAr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Explicit allowlist for PATCH /connection-profiles/:id.
// Only fields that an admin may legitimately edit are accepted.
// Health-monitoring state (consecutiveFailures), governance status, and all
// last-test-result fields are managed by dedicated endpoints and must not be
// overwritten via the generic update path.
const CONNECTION_PROFILE_PATCH_ALLOWLIST = new Set([
  "profileName",
  "profileNameAr",
  "connectionParamsJson",
  "credentialVaultRefId",
  "environment",
  "status",
  "isHealthMonitoringEnabled",
  "healthCheckIntervalMinutes",
  "alertOnFailureCount",
  "retryEnabled",
  "retryMaxAttempts",
  "retryBackoffSeconds",
  "isAirGapSafe",
]);

router.patch("/integration-governance/connection-profiles/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const id = parseInt(req.params.id);

    // Reject any key that is not on the allowlist.
    const body = req.body as Record<string, unknown>;
    const unknown = Object.keys(body).filter(k => !CONNECTION_PROFILE_PATCH_ALLOWLIST.has(k));
    if (unknown.length > 0) {
      return void res.status(400).json({ error: `Unknown or read-only field(s): ${unknown.join(", ")}` });
    }

    // Range-validate numeric health/retry fields when present.
    if ("healthCheckIntervalMinutes" in body) {
      const v = body.healthCheckIntervalMinutes;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1440) {
        return void res.status(400).json({ error: "healthCheckIntervalMinutes must be an integer between 1 and 1440" });
      }
    }
    if ("alertOnFailureCount" in body) {
      const v = body.alertOnFailureCount;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) {
        return void res.status(400).json({ error: "alertOnFailureCount must be an integer between 1 and 100" });
      }
    }
    if ("retryMaxAttempts" in body) {
      const v = body.retryMaxAttempts;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 20) {
        return void res.status(400).json({ error: "retryMaxAttempts must be an integer between 1 and 20" });
      }
    }
    if ("retryBackoffSeconds" in body) {
      const v = body.retryBackoffSeconds;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 3600) {
        return void res.status(400).json({ error: "retryBackoffSeconds must be an integer between 1 and 3600" });
      }
    }

    const [before] = await db.select().from(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });

    // Build the update from only allowed keys to prevent prototype-pollution
    // or extra keys slipping through if the allowlist check above is bypassed.
    const patch: Record<string, unknown> = {};
    for (const key of CONNECTION_PROFILE_PATCH_ALLOWLIST) {
      if (key in body) patch[key] = body[key];
    }
    patch.updatedAt = new Date();

    const [row] = await db.update(integrationConnectionProfilesTable).set(patch as any).where(eq(integrationConnectionProfilesTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "connection_profile", entityId: id, entityLabel: row.profileName, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    const warnings: string[] = [];
    if (row.credentialVaultRefId) {
      const [vaultRef] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, row.credentialVaultRefId));
      if (vaultRef) warnings.push(...vaultRefWarnings(vaultRef.vaultKeyRef, vaultRef.vaultSecretRef));
    }
    res.json({ ...row, warnings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/integration-governance/connection-profiles/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
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
    const { integrationType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    conditions.push(eq(integrationGovernanceRulesTable.orgId, await resolveOrgId(req)));
    if (integrationType) conditions.push(eq(integrationGovernanceRulesTable.integrationType, integrationType));
    const rows = conditions.length
      ? await db.select().from(integrationGovernanceRulesTable).where(and(...conditions))
      : await db.select().from(integrationGovernanceRulesTable);
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/integration-governance/governance-rules", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
    const [row] = await db.insert(integrationGovernanceRulesTable).values({ ...req.body, orgId: await resolveOrgId(req) }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "governance_rule", entityId: row.id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/integration-governance/governance-rules/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId = getActorUserId(req);
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
    const actorUserId = getActorUserId(req);
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
    const { profileId, eventType, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeStr ?? "50") || 50));
    const offset = (page - 1) * pageSize;
    const conditions: any[] = [];
    if (profileId) conditions.push(eq(integrationAuditLogTable.profileId, parseInt(profileId)));
    if (eventType) conditions.push(eq(integrationAuditLogTable.eventType, eventType));
    const baseQuery = db.select().from(integrationAuditLogTable);
    const rows = conditions.length
      ? await baseQuery.where(and(...conditions)).orderBy(desc(integrationAuditLogTable.occurredAt)).limit(pageSize).offset(offset)
      : await baseQuery.orderBy(desc(integrationAuditLogTable.occurredAt)).limit(pageSize).offset(offset);
    // Total count using SQL aggregate — same filters, no data transfer
    const countQuery = db.select({ total: count() }).from(integrationAuditLogTable);
    const [{ total }] = conditions.length
      ? await countQuery.where(and(...conditions))
      : await countQuery;
    res.json({ data: rows, page, pageSize, total });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
