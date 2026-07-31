import { Router, type Request, type Response, type NextFunction } from "express";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  db,
  gatewayRegistrationsTable,
  punchImportBatchesTable,
  punchEventsTable,
  deviceEmployeeMappingsTable,
  employeesTable,
  auditLogsTable,
} from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { materializePunch } from "../lib/attendanceMaterializer.js";
import {
  protectSigningKey,
  recoverSigningKey,
  rotateLegacyValue,
  isLegacyStoredKey,
} from "../lib/gatewayKeyVault.js";

/**
 * Attendance Gateway — HR-core side.
 *
 * Two routers are exported:
 *  - gatewayMachineRouter: HMAC-authenticated machine endpoints used by the
 *    local Attendance Gateway service (punch upload, heartbeat, reconcile).
 *    Mounted BEFORE the session-auth gate; each request must carry:
 *      x-gateway-id:        registration id
 *      x-gateway-timestamp: unix ms, must be within ±5 min of server time
 *      x-gateway-signature: hex HMAC-SHA256(secret, `${timestamp}.${sha256(rawBody)}`)
 *  - gatewayAdminRouter: session-authenticated admin endpoints (create/list/
 *    revoke registrations, list batches). Mounted with the business routes.
 *
 * Raw biometric templates are never accepted — only punch metadata.
 */

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const DRIFT_ALERT_MS = 2 * 60 * 1000;

const DEVICE_CLOCK_SKEW_ALERT_MS = 60 * 1000;
const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

interface GatewayRequest extends Request {
  rawBody?: Buffer;
  gatewayRegistration?: typeof gatewayRegistrationsTable.$inferSelect;
}

async function verifyGatewaySignature(req: GatewayRequest, res: Response, next: NextFunction): Promise<void> {
  const idHeader = req.header("x-gateway-id");
  const tsHeader = req.header("x-gateway-timestamp");
  const sigHeader = req.header("x-gateway-signature");
  if (!idHeader || !tsHeader || !sigHeader) {
    res.status(401).json({ error: "Missing gateway authentication headers", errorAr: "ترويسات مصادقة البوابة مفقودة" });
    return;
  }
  const registrationId = parseInt(idHeader, 10);
  const timestamp = parseInt(tsHeader, 10);
  if (!Number.isFinite(registrationId) || !Number.isFinite(timestamp)) {
    res.status(401).json({ error: "Invalid gateway authentication headers" });
    return;
  }
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    res.status(401).json({ error: "Request timestamp outside allowed window (possible replay or severe clock drift)" });
    return;
  }
  const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
  if (!reg || reg.status !== "ACTIVE") {
    res.status(401).json({ error: "Unknown or revoked gateway registration" });
    return;
  }
  // Both sides derive signingKey = sha256(secret); the gateway hashes its
  // secret locally. The server stores that key only inside an encrypted
  // envelope (see gatewayKeyVault) so a database leak alone cannot forge
  // signatures. Legacy plaintext rows are accepted once, then rotated.
  let signingKey: string;
  let legacy = false;
  try {
    ({ signingKey, legacy } = recoverSigningKey(reg.secretHash));
  } catch {
    res.status(401).json({ error: "Gateway credential unusable — re-register the gateway", errorAr: "بيانات اعتماد البوابة غير صالحة" });
    return;
  }
  const bodyHash = sha256(req.rawBody ?? Buffer.from(""));
  const expected = createHmac("sha256", signingKey).update(`${timestamp}.${bodyHash}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sigHeader, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid gateway signature", errorAr: "توقيع البوابة غير صالح" });
    return;
  }
  if (legacy) {
    // Lazy rotation: replace the plaintext signing key with its envelope the
    // first time the registration is seen after the hardening deploy.
    await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: rotateLegacyValue(reg.secretHash), updatedAt: new Date() })
      .where(and(eq(gatewayRegistrationsTable.id, reg.id), eq(gatewayRegistrationsTable.secretHash, reg.secretHash)));
  }
  req.gatewayRegistration = reg;
  next();
}

/**
 * Eager rotation path for existing registrations: wraps every legacy
 * plaintext signing key in the vault envelope. Idempotent; safe to run at
 * every server start.
 */
export async function rotateLegacyGatewayKeys(): Promise<number> {
  const rows = await db
    .select({ id: gatewayRegistrationsTable.id, secretHash: gatewayRegistrationsTable.secretHash })
    .from(gatewayRegistrationsTable);
  let rotated = 0;
  for (const row of rows) {
    if (!isLegacyStoredKey(row.secretHash)) continue;
    const result = await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: rotateLegacyValue(row.secretHash), updatedAt: new Date() })
      .where(and(eq(gatewayRegistrationsTable.id, row.id), eq(gatewayRegistrationsTable.secretHash, row.secretHash)))
      .returning({ id: gatewayRegistrationsTable.id });
    rotated += result.length;
  }
  return rotated;
}

/** Compute + persist gateway↔server clock drift from the reported device time. */
async function recordDrift(reg: { id: number }, reportedTimeMs: number | undefined): Promise<number | null> {
  if (!reportedTimeMs || !Number.isFinite(reportedTimeMs)) return null;
  const drift = reportedTimeMs - Date.now();
  await db
    .update(gatewayRegistrationsTable)
    .set({
      clockDriftMs: drift,
      driftAlert: Math.abs(drift) > DRIFT_ALERT_MS,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(gatewayRegistrationsTable.id, reg.id));
  return drift;
}

// ─────────────────────────── machine router ───────────────────────────

export const gatewayMachineRouter: ReturnType<typeof Router> = Router();

// POST /gateway/heartbeat — device health ping
gatewayMachineRouter.post("/gateway/heartbeat", verifyGatewaySignature, async (req: GatewayRequest, res): Promise<void> => {
  const reg = req.gatewayRegistration!;
  const { deviceTimeMs, adapterStatus, connectionTest, sdkPresent, sdkVersion, deviceClockSkewMs } = req.body as {
    deviceTimeMs?: number;
    adapterStatus?: string;
    connectionTest?: { ok?: boolean; status?: string; message?: string; clockSkewMs?: number };
    sdkPresent?: boolean;
    sdkVersion?: string | null;
    deviceClockSkewMs?: number | null;
  };
  const drift = await recordDrift(reg, deviceTimeMs);
  const VALID_CONN_STATUSES = new Set(["REACHABLE", "AUTH_FAILED", "UNREACHABLE", "NOT_CONFIGURED"]);
  // Structured connection-test result (newer gateways). Falls back to the
  // legacy free-text adapterStatus so older gateways still surface something.
  const connStatus = connectionTest?.status && VALID_CONN_STATUSES.has(connectionTest.status)
    ? connectionTest.status
    : connectionTest && typeof connectionTest.ok === "boolean"
      ? (connectionTest.ok ? "REACHABLE" : "UNREACHABLE")
      : undefined;
  const connMessage = connectionTest?.message ?? adapterStatus;
  // Device↔gateway clock skew measured by the gateway adapter (distinct from
  // clockDriftMs = gateway↔server drift). Only accept finite non-negative
  // values; absence means "not measured", so the stored value is untouched.
  // Prefer the explicit top-level field (newer gateways; may be negative =
  // device behind the gateway); fall back to connectionTest.clockSkewMs
  // (non-negative by contract).
  const topSkew = typeof deviceClockSkewMs === "number" && Number.isFinite(deviceClockSkewMs)
    ? deviceClockSkewMs
    : undefined;
  const rawSkew = connectionTest?.clockSkewMs;
  const ctSkew = typeof rawSkew === "number" && Number.isFinite(rawSkew) && rawSkew >= 0
    ? rawSkew
    : undefined;
  const deviceSkewMs = topSkew !== undefined ? Math.round(topSkew) : ctSkew !== undefined ? Math.round(ctSkew) : undefined;
  const deviceSkewAlert = deviceSkewMs !== undefined ? Math.abs(deviceSkewMs) > DEVICE_CLOCK_SKEW_ALERT_MS : undefined;
  await db
    .update(gatewayRegistrationsTable)
    .set({
      lastHeartbeatAt: new Date(),
      notes: adapterStatus ? `adapter: ${adapterStatus}` : reg.notes,
      ...(connStatus || connMessage
        ? {
            adapterConnStatus: connStatus ?? (connMessage ? reg.adapterConnStatus : undefined),
            adapterConnMessage: typeof connMessage === "string" ? connMessage.slice(0, 2000) : reg.adapterConnMessage,
            adapterConnTestedAt: new Date(),
          }
        : {}),
      ...(deviceSkewMs !== undefined
        ? { deviceClockSkewMs: deviceSkewMs, deviceClockSkewAlert: deviceSkewAlert }
        : deviceClockSkewMs === null
          // Explicit null = "measured nothing" from a newer gateway — clear
          // the stored skew instead of showing a stale warning forever.
          ? { deviceClockSkewMs: null, deviceClockSkewAlert: false }
          : {}),
      // Vendor SDK availability reported by newer gateways.
      ...(typeof sdkPresent === "boolean"
        ? { sdkPresent, sdkVersion: typeof sdkVersion === "string" ? sdkVersion.slice(0, 60) : null }
        : {}),
    })
    .where(eq(gatewayRegistrationsTable.id, reg.id));
  res.json({
    ok: true,
    serverTimeMs: Date.now(),
    clockDriftMs: drift,
    driftAlert: drift !== null && Math.abs(drift) > DRIFT_ALERT_MS,
    deviceClockSkewMs: deviceSkewMs ?? null,
    deviceClockSkewAlert: deviceSkewAlert ?? false,
  });
});

// POST /gateway/punches — signed batch ingestion with dedupe + materialization
gatewayMachineRouter.post("/gateway/punches", verifyGatewaySignature, async (req: GatewayRequest, res): Promise<void> => {
  const reg = req.gatewayRegistration!;
  const { batchUuid, deviceTimeMs, events } = req.body as {
    batchUuid?: string;
    deviceTimeMs?: number;
    events?: Array<{
      deviceUserId?: string;
      employeeId?: number;
      eventTime: string;
      eventType: string;
      deviceEventUid?: string;
      raw?: unknown;
    }>;
  };
  if (!batchUuid || !Array.isArray(events)) {
    res.status(400).json({ error: "batchUuid and events[] required" });
    return;
  }
  // Reject anything resembling a biometric template payload.
  const bodyStr = (req.rawBody ?? Buffer.from("")).toString("utf8");
  if (/"(template|biometric_template|fingerprint_data|face_data)"\s*:/.test(bodyStr)) {
    res.status(422).json({ error: "Raw biometric templates must never be sent to the HR core" });
    return;
  }

  // Idempotent batch replay: if this batchUuid was already processed, return
  // the stored result instead of re-ingesting.
  const [existingBatch] = await db.select().from(punchImportBatchesTable).where(eq(punchImportBatchesTable.batchUuid, batchUuid));
  if (existingBatch) {
    res.json({
      ok: true,
      replayed: true,
      batchId: existingBatch.id,
      inserted: existingBatch.insertedCount,
      duplicates: existingBatch.duplicateCount,
      unmapped: existingBatch.unmappedCount,
      errors: existingBatch.errorCount,
    });
    return;
  }

  const drift = await recordDrift(reg, deviceTimeMs);
  const rawPayloadSha256 = sha256(req.rawBody ?? Buffer.from(""));

  // Resolve device-user mappings in one query.
  const deviceUserIds = [...new Set(events.map((e) => e.deviceUserId).filter((v): v is string => !!v))];
  const mappings = deviceUserIds.length
    ? await db
        .select()
        .from(deviceEmployeeMappingsTable)
        .where(and(
          eq(deviceEmployeeMappingsTable.isActive, true),
          inArray(deviceEmployeeMappingsTable.deviceUserId, deviceUserIds),
          ...(reg.deviceId ? [eq(deviceEmployeeMappingsTable.deviceId, reg.deviceId)] : []),
        ))
    : [];
  const mapByDeviceUser = new Map(mappings.map((m) => [m.deviceUserId, m.employeeId]));

  const validEmployeeIds = new Set(
    (await db.select({ id: employeesTable.id }).from(employeesTable)).map((r) => r.id),
  );

  let inserted = 0, duplicates = 0, unmapped = 0, errors = 0;
  const errorDetails: string[] = [];
  const VALID_TYPES = new Set(["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END", "OVERTIME_START", "OVERTIME_END"]);

  // Create the batch row first so punch rows can reference it.
  const [batch] = await db
    .insert(punchImportBatchesTable)
    .values({
      batchUuid,
      registrationId: reg.id,
      source: reg.adapterType === "CSV" ? "CSV" : reg.adapterType === "SIMULATOR" ? "SIMULATOR" : "GATEWAY",
      eventCount: events.length,
      rawPayloadSha256,
      clockDriftMs: drift,
      status: "COMPLETED",
    })
    .returning();

  for (const ev of events) {
    try {
      const eventTime = new Date(ev.eventTime);
      if (isNaN(eventTime.getTime()) || !VALID_TYPES.has(ev.eventType)) {
        errors++;
        errorDetails.push(`invalid event (${ev.deviceEventUid ?? ev.eventTime})`);
        continue;
      }
      const employeeId = ev.employeeId ?? (ev.deviceUserId ? mapByDeviceUser.get(ev.deviceUserId) : undefined);
      if (!employeeId || !validEmployeeIds.has(employeeId)) {
        unmapped++;
        continue;
      }
      const dedupeKey = sha256(`${reg.id}|${ev.deviceEventUid ?? ""}|${employeeId}|${eventTime.toISOString()}|${ev.eventType}`);
      const insertedRows = await db
        .insert(punchEventsTable)
        .values({
          employeeId,
          deviceId: reg.deviceId ?? null,
          eventTime,
          eventType: ev.eventType,
          source: "GATEWAY",
          isVerified: true,
          rawPayload: ev.raw !== undefined ? JSON.stringify(ev.raw) : null,
          rawPayloadSha256: ev.raw !== undefined ? sha256(JSON.stringify(ev.raw)) : null,
          dedupeKey,
          deviceEventUid: ev.deviceEventUid ?? null,
          importBatchId: batch.id,
        })
        .onConflictDoNothing({ target: punchEventsTable.dedupeKey })
        .returning({ id: punchEventsTable.id });
      if (insertedRows.length === 0) {
        duplicates++;
        continue;
      }
      inserted++;
      const attendanceRecordId = await materializePunch({
        employeeId,
        eventTime,
        eventType: ev.eventType,
        deviceId: reg.deviceId ?? null,
      });
      if (attendanceRecordId) {
        await db.update(punchEventsTable).set({ attendanceRecordId }).where(eq(punchEventsTable.id, insertedRows[0].id));
      }
    } catch (e) {
      errors++;
      errorDetails.push(e instanceof Error ? e.message : String(e));
    }
  }

  await db
    .update(punchImportBatchesTable)
    .set({
      insertedCount: inserted,
      duplicateCount: duplicates,
      unmappedCount: unmapped,
      errorCount: errors,
      status: errors > 0 ? (inserted > 0 ? "PARTIAL" : "FAILED") : "COMPLETED",
      errorSummary: errorDetails.length ? errorDetails.slice(0, 20).join("; ") : null,
    })
    .where(eq(punchImportBatchesTable.id, batch.id));

  await db.insert(auditLogsTable).values({
    action: "gateway_punch_import",
    entityType: "punch_import_batch",
    entityId: batch.id,
    entityLabel: batchUuid,
    actorUserId: null,
    changesJson: JSON.stringify({ registrationId: reg.id, eventCount: events.length, inserted, duplicates, unmapped, errors, rawPayloadSha256 }),
  });

  res.status(201).json({ ok: true, batchId: batch.id, inserted, duplicates, unmapped, errors, clockDriftMs: drift });
});

// POST /gateway/reconcile — gateway reports what it believes it sent
gatewayMachineRouter.post("/gateway/reconcile", verifyGatewaySignature, async (req: GatewayRequest, res): Promise<void> => {
  const reg = req.gatewayRegistration!;
  const { batches } = req.body as { batches?: Array<{ batchUuid: string; eventCount: number }> };
  if (!Array.isArray(batches)) {
    res.status(400).json({ error: "batches[] required" });
    return;
  }
  const uuids = batches.map((b) => b.batchUuid);
  const serverBatches = uuids.length
    ? await db.select().from(punchImportBatchesTable).where(inArray(punchImportBatchesTable.batchUuid, uuids))
    : [];
  const byUuid = new Map(serverBatches.map((b) => [b.batchUuid, b]));
  const results = batches.map((b) => {
    const server = byUuid.get(b.batchUuid);
    if (!server) return { batchUuid: b.batchUuid, status: "MISSING_ON_SERVER" as const };
    if (server.eventCount !== b.eventCount) {
      return { batchUuid: b.batchUuid, status: "COUNT_MISMATCH" as const, serverEventCount: server.eventCount };
    }
    return { batchUuid: b.batchUuid, status: "OK" as const, inserted: server.insertedCount, duplicates: server.duplicateCount };
  });
  await db.update(gatewayRegistrationsTable).set({ lastSeenAt: new Date() }).where(eq(gatewayRegistrationsTable.id, reg.id));
  // Persist the reconcile outcome so the HRMS admin page can warn when a
  // gateway believes it delivered batches the server never received.
  const missing = results.filter((r) => r.status === "MISSING_ON_SERVER").map((r) => r.batchUuid);
  const mismatched = results.filter((r) => r.status === "COUNT_MISMATCH").map((r) => r.batchUuid);
  await db.insert(auditLogsTable).values({
    action: "gateway_reconcile",
    entityType: "gateway_registration",
    entityId: reg.id,
    entityLabel: reg.name,
    actorUserId: null,
    changesJson: JSON.stringify({ checked: results.length, missing, mismatched }),
  });
  res.json({ ok: true, results });
});

// ─────────────────────────── admin router ───────────────────────────

export const gatewayAdminRouter: ReturnType<typeof Router> = Router();

// Gateway registrations issue machine credentials, so administration requires
// an authenticated session UNCONDITIONALLY — even in demo mode (PILOT_AUTH
// off) where ordinary business routes stay open. GETs are gated too.
function requireGatewayAdminSession(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as { userId?: number } | undefined;
  if (!session?.userId) {
    res.status(401).json({
      error: "Authentication required for gateway administration",
      errorAr: "المصادقة مطلوبة لإدارة البوابة",
    });
    return;
  }
  next();
}
gatewayAdminRouter.use("/gateway", requireGatewayAdminSession);

// POST /gateway/registrations — create; returns plaintext secret ONCE
gatewayAdminRouter.post("/gateway/registrations", async (req, res): Promise<void> => {
  const { name, nameAr, deviceId, adapterType, notes } = req.body as {
    name?: string; nameAr?: string; deviceId?: number; adapterType?: string; notes?: string;
  };
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const VALID_ADAPTERS = ["ZKTECO", "SUPREMA", "ZKTECO_NATIVE", "SUPREMA_NATIVE", "GENERIC_REST", "CSV", "SIMULATOR"];
  if (adapterType && !VALID_ADAPTERS.includes(adapterType)) {
    res.status(400).json({ error: `adapterType must be one of ${VALID_ADAPTERS.join(", ")}` });
    return;
  }
  const session = req.session as { userId?: number };
  const actorUserId = session.userId!; // guaranteed by requireGatewayAdminSession
  const secret = randomBytes(32).toString("hex");
  const [reg] = await db
    .insert(gatewayRegistrationsTable)
    .values({
      name,
      nameAr: nameAr ?? null,
      deviceId: deviceId ?? null,
      adapterType: adapterType ?? "SIMULATOR",
      secretHash: protectSigningKey(sha256(secret)),
      registeredByUserId: actorUserId,
      notes: notes ?? null,
    })
    .returning();
  await db.insert(auditLogsTable).values({
    action: "create",
    entityType: "gateway_registration",
    entityId: reg.id,
    entityLabel: name,
    actorUserId,
    changesJson: JSON.stringify({ adapterType: reg.adapterType, deviceId: reg.deviceId }),
  });
  // The plaintext secret is returned exactly once and never stored.
  res.status(201).json({ ...reg, secret, secretHash: undefined });
});

// GET /gateway/registrations
gatewayAdminRouter.get("/gateway/registrations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(gatewayRegistrationsTable).orderBy(desc(gatewayRegistrationsTable.createdAt));
  res.json(rows.map((r) => ({ ...r, secretHash: undefined })));
});

// POST /gateway/registrations/:id/revoke
gatewayAdminRouter.post("/gateway/registrations/:id/revoke", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const session = req.session as { userId?: number };
  const [reg] = await db
    .update(gatewayRegistrationsTable)
    .set({ status: "REVOKED", updatedAt: new Date() })
    .where(eq(gatewayRegistrationsTable.id, id))
    .returning();
  if (!reg) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.insert(auditLogsTable).values({
    action: "revoke",
    entityType: "gateway_registration",
    entityId: id,
    entityLabel: reg.name,
    actorUserId: session.userId ?? null,
  });
  res.json({ ...reg, secretHash: undefined });
});

// GET /gateway/reconcile-status — latest reconcile outcome per registration,
// used by the admin UI to warn about batches missing on the server.
gatewayAdminRouter.get("/gateway/reconcile-status", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.action, "gateway_reconcile"))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(200);
  const latest = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.entityId != null && !latest.has(row.entityId)) latest.set(row.entityId, row);
  }
  res.json(
    [...latest.values()].map((row) => {
      let parsed: { checked?: number; missing?: string[]; mismatched?: string[] } = {};
      try {
        parsed = JSON.parse(row.changesJson ?? "{}");
      } catch {
        /* tolerate malformed history */
      }
      return {
        registrationId: row.entityId,
        registrationName: row.entityLabel,
        reconciledAt: row.createdAt,
        checked: parsed.checked ?? 0,
        missing: parsed.missing ?? [],
        mismatched: parsed.mismatched ?? [],
      };
    }),
  );
});

// GET /gateway/batches
gatewayAdminRouter.get("/gateway/batches", async (req, res): Promise<void> => {
  const { registrationId, limit = "50" } = req.query as { registrationId?: string; limit?: string };
  const rows = await db
    .select()
    .from(punchImportBatchesTable)
    .where(registrationId ? eq(punchImportBatchesTable.registrationId, parseInt(registrationId, 10)) : undefined)
    .orderBy(desc(punchImportBatchesTable.receivedAt))
    .limit(Math.min(parseInt(limit, 10) || 50, 200));
  res.json(rows);
});
