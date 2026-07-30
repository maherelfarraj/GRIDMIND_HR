import { Router } from "express";
import { db, auditLogsTable, policyChangeRequestsTable, policyVersionsTable, approvalChainConfigsTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { createHash } from "crypto";

const router = Router();

/**
 * Builds the WHERE clause identifying "the same policy" for versioning.
 * Version numbering and isCurrent demotion must be scoped to the full target
 * tuple (policyArea + orgId + targetEntityType + targetEntityId) — scoping by
 * policyArea alone would let one org's apply/rollback demote or renumber
 * another org's versions for the same area.
 */
function versionScope(v: { policyArea: string; orgId: number | null; targetEntityType: string | null; targetEntityId: number | null }) {
  return and(
    eq(policyVersionsTable.policyArea, v.policyArea),
    v.orgId == null ? isNull(policyVersionsTable.orgId) : eq(policyVersionsTable.orgId, v.orgId),
    v.targetEntityType == null ? isNull(policyVersionsTable.targetEntityType) : eq(policyVersionsTable.targetEntityType, v.targetEntityType),
    v.targetEntityId == null ? isNull(policyVersionsTable.targetEntityId) : eq(policyVersionsTable.targetEntityId, v.targetEntityId),
  );
}

// ─── Policy Change Requests ───────────────────────────────────────────────────

router.get("/policy-change-requests", async (req, res): Promise<void> => {
  try {
    const { status, policyArea, orgId } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (status) conditions.push(eq(policyChangeRequestsTable.status, status));
    if (policyArea) conditions.push(eq(policyChangeRequestsTable.policyArea, policyArea));
    if (orgId) conditions.push(eq(policyChangeRequestsTable.orgId, parseInt(orgId)));
    const rows = conditions.length
      ? await db.select().from(policyChangeRequestsTable).where(and(...conditions)).orderBy(desc(policyChangeRequestsTable.createdAt))
      : await db.select().from(policyChangeRequestsTable).orderBy(desc(policyChangeRequestsTable.createdAt));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/policy-change-requests", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.insert(policyChangeRequestsTable).values({
      ...req.body,
      makerUserId: req.body.makerUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "policy_change_request", entityId: row.id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /policy-change-requests/:id/preview-impact — static before /:id
router.post("/policy-change-requests/:id/preview-impact", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(policyChangeRequestsTable).where(eq(policyChangeRequestsTable.id, id));
    if (!row) return void res.status(404).json({ error: "Not found" });
    const impact = {
      affectedEmployees: Math.floor(Math.random() * 500),
      affectedPayrollRuns: Math.floor(Math.random() * 12),
      effectiveDate: new Date().toISOString().split("T")[0],
      warnings: row.policyArea === "payroll_policy"
        ? ["Payroll recalculation required for current period"]
        : [],
    };
    await db.update(policyChangeRequestsTable).set({ impactPreviewJson: JSON.stringify(impact), updatedAt: new Date() }).where(eq(policyChangeRequestsTable.id, id));
    res.json(impact);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/policy-change-requests/:id/submit", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(policyChangeRequestsTable).set({ status: "pending_review", updatedAt: new Date() }).where(eq(policyChangeRequestsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "submit", entityType: "policy_change_request", entityId: id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ status: "pending_review" }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/policy-change-requests/:id/approve", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const { checkerComment } = req.body;
    const [row] = await db.update(policyChangeRequestsTable).set({
      status: "approved", checkerUserId: actorUserId,
      checkerComment: checkerComment ?? null, decidedAt: new Date(), updatedAt: new Date(),
    }).where(eq(policyChangeRequestsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "approve", entityType: "policy_change_request", entityId: id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ status: "approved", checkerComment }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/policy-change-requests/:id/reject", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const { checkerComment } = req.body;
    const [row] = await db.update(policyChangeRequestsTable).set({
      status: "rejected", checkerUserId: actorUserId,
      checkerComment: checkerComment ?? null, decidedAt: new Date(), updatedAt: new Date(),
    }).where(eq(policyChangeRequestsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "reject", entityType: "policy_change_request", entityId: id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ status: "rejected", checkerComment }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/policy-change-requests/:id/apply", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [cr] = await db.select().from(policyChangeRequestsTable).where(eq(policyChangeRequestsTable.id, id));
    if (!cr) return void res.status(404).json({ error: "Not found" });
    if (cr.status !== "approved") return void res.status(400).json({ error: "Change request must be approved before applying" });

    // Get current max version for this exact policy target (area + org + entity)
    const scope = versionScope(cr);
    const existing = await db.select().from(policyVersionsTable)
      .where(scope).orderBy(desc(policyVersionsTable.version));

    const nextVersion = (existing[0]?.version ?? 0) + 1;

    // Mark old versions of this exact target as not current
    if (existing.length > 0) {
      await db.update(policyVersionsTable).set({ isCurrent: false }).where(scope);
    }

    const snapshot = cr.changeAfterJson;
    const checksum = createHash("sha256").update(snapshot).digest("hex");

    const [version] = await db.insert(policyVersionsTable).values({
      orgId: cr.orgId,
      policyArea: cr.policyArea,
      targetEntityType: cr.targetEntityType,
      targetEntityId: cr.targetEntityId,
      targetEntityLabel: cr.targetEntityLabel,
      version: nextVersion,
      snapshotJson: snapshot,
      checksum,
      changeRequestId: id,
      appliedByUserId: actorUserId,
      isCurrent: true,
    }).returning();

    const [row] = await db.update(policyChangeRequestsTable).set({
      status: "applied", appliedVersion: nextVersion, appliedAt: new Date(), updatedAt: new Date(),
    }).where(eq(policyChangeRequestsTable.id, id)).returning();

    await db.insert(auditLogsTable).values({ action: "apply", entityType: "policy_change_request", entityId: id, entityLabel: cr.titleEn, actorUserId, changesJson: JSON.stringify({ status: "applied", version: nextVersion }) });
    res.json({ changeRequest: row, version });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/policy-change-requests/:id/withdraw", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(policyChangeRequestsTable).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(policyChangeRequestsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "withdraw", entityType: "policy_change_request", entityId: id, entityLabel: row.titleEn, actorUserId, changesJson: JSON.stringify({ status: "withdrawn" }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/policy-change-requests/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(policyChangeRequestsTable).where(eq(policyChangeRequestsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    const diff = {
      before: row.changeBeforeJson ? JSON.parse(row.changeBeforeJson) : null,
      after: row.changeAfterJson ? JSON.parse(row.changeAfterJson) : null,
    };
    res.json({ ...row, diff });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Policy Versions ──────────────────────────────────────────────────────────

router.get("/policy-versions", async (req, res): Promise<void> => {
  try {
    const { policyArea, entityType, entityId } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (policyArea) conditions.push(eq(policyVersionsTable.policyArea, policyArea));
    if (entityType) conditions.push(eq(policyVersionsTable.targetEntityType, entityType));
    if (entityId) conditions.push(eq(policyVersionsTable.targetEntityId, parseInt(entityId)));
    const rows = conditions.length
      ? await db.select().from(policyVersionsTable).where(and(...conditions)).orderBy(desc(policyVersionsTable.version))
      : await db.select().from(policyVersionsTable).orderBy(desc(policyVersionsTable.version));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/policy-versions", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const snapshot = typeof req.body.snapshotJson === "string" ? req.body.snapshotJson : JSON.stringify(req.body.snapshotJson ?? {});
    const checksum = createHash("sha256").update(snapshot).digest("hex");
    const [row] = await db.insert(policyVersionsTable).values({
      ...req.body,
      snapshotJson: snapshot,
      checksum,
      appliedByUserId: actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "policy_version", entityId: row.id, entityLabel: `${row.policyArea} v${row.version}`, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /policy-versions/:id/rollback — static before /:id
router.post("/policy-versions/:id/rollback", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [target] = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, id));
    if (!target) return void res.status(404).json({ error: "Version not found" });

    // Get current version number for this exact policy target (area + org + entity)
    const scope = versionScope(target);
    const existing = await db.select().from(policyVersionsTable)
      .where(scope).orderBy(desc(policyVersionsTable.version));
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    // Mark old versions of this exact target as not current
    await db.update(policyVersionsTable).set({ isCurrent: false }).where(scope);

    const checksum = createHash("sha256").update(target.snapshotJson).digest("hex");

    const [newVersion] = await db.insert(policyVersionsTable).values({
      orgId: target.orgId,
      policyArea: target.policyArea,
      targetEntityType: target.targetEntityType,
      targetEntityId: target.targetEntityId,
      targetEntityLabel: target.targetEntityLabel,
      version: nextVersion,
      snapshotJson: target.snapshotJson,
      checksum,
      appliedByUserId: actorUserId,
      isCurrent: true,
      rollbackReason: req.body.reason ?? `Rolled back to version ${target.version}`,
      rolledBackFromVersion: target.version,
    }).returning();

    await db.insert(auditLogsTable).values({ action: "rollback", entityType: "policy_version", entityId: newVersion.id, entityLabel: `${target.policyArea} rollback to v${target.version}`, actorUserId, changesJson: JSON.stringify({ rolledBackFrom: target.version, newVersion: nextVersion }) });
    res.json(newVersion);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/policy-versions/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Approval Chain Configs ───────────────────────────────────────────────────

router.get("/approval-chain-configs", async (req, res): Promise<void> => {
  try {
    const { orgId, chainType } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (orgId) conditions.push(eq(approvalChainConfigsTable.orgId, parseInt(orgId)));
    if (chainType) conditions.push(eq(approvalChainConfigsTable.chainType, chainType));
    const rows = conditions.length
      ? await db.select().from(approvalChainConfigsTable).where(and(...conditions))
      : await db.select().from(approvalChainConfigsTable);
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/approval-chain-configs", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.insert(approvalChainConfigsTable).values({
      ...req.body,
      createdByUserId: req.body.createdByUserId ?? actorUserId,
    }).returning();
    await db.insert(auditLogsTable).values({ action: "create", entityType: "approval_chain_config", entityId: row.id, entityLabel: row.name, actorUserId, changesJson: JSON.stringify({ after: row }) });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /approval-chain-configs/:id/preview — static before /:id
router.get("/approval-chain-configs/:id/preview", async (req, res): Promise<void> => {
  try {
    const [chain] = await db.select().from(approvalChainConfigsTable).where(eq(approvalChainConfigsTable.id, parseInt(req.params.id)));
    if (!chain) return void res.status(404).json({ error: "Not found" });
    const steps = JSON.parse(chain.stepsJson || "[]");
    const description = steps.map((s: any, i: number) => ({
      stepNumber: s.stepNumber ?? i + 1,
      label: s.labelEn ?? `Step ${i + 1}`,
      approverType: s.approverType ?? "role",
      autoApproveIfNone: s.autoApproveIfNone ?? false,
      timeoutHours: s.timeoutHours ?? chain.totalTimeoutHours,
    }));
    res.json({
      chainId: chain.id,
      name: chain.name,
      chainType: chain.chainType,
      requireAllSteps: chain.requireAllSteps,
      timeoutAction: chain.timeoutAction,
      totalTimeoutHours: chain.totalTimeoutHours,
      steps: description,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/approval-chain-configs/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(approvalChainConfigsTable).where(eq(approvalChainConfigsTable.id, parseInt(req.params.id)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/approval-chain-configs/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(approvalChainConfigsTable).where(eq(approvalChainConfigsTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [row] = await db.update(approvalChainConfigsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(approvalChainConfigsTable.id, id)).returning();
    await db.insert(auditLogsTable).values({ action: "update", entityType: "approval_chain_config", entityId: id, entityLabel: row.name, actorUserId, changesJson: JSON.stringify({ before, after: row }) });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/approval-chain-configs/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.delete(approvalChainConfigsTable).where(eq(approvalChainConfigsTable.id, id)).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    await db.insert(auditLogsTable).values({ action: "delete", entityType: "approval_chain_config", entityId: id, entityLabel: row.name, actorUserId, changesJson: JSON.stringify({ deleted: row }) });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
