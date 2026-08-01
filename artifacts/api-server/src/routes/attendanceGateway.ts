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
  deviceCommandsTable,
  attendanceDevicesTable,
} from "@workspace/db";
import { and, eq, desc, gte, inArray, lt } from "drizzle-orm";
import { DEVICE_COMMAND_TTL_MS } from "./devices.js";
import { materializePunch } from "../lib/attendanceMaterializer.js";
import {
  processGatewayWarningTransitions,
  processReconcileDiscrepancyTransitions,
  GATEWAY_SILENCE_THRESHOLD_MS,
  effectiveSilenceThresholdMs,
} from "../lib/gatewayDeviceAlerts.js";
import { notifyCommandOutcomesDeferred } from "../lib/deviceCommandNotifications.js";
import {
  protectSigningKey,
  recoverSigningKey,
  rotateLegacyValue,
  rewrapEnvelope,
  isLegacyStoredKey,
  isProtectedEnvelope,
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
// An identical reconcile outcome inside this window is not re-audited, so
// gateways reconciling on an aggressive timer cannot flood the audit trail.
const RECONCILE_AUDIT_MIN_INTERVAL_MS = 60 * 60 * 1000;
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
  let needsRewrap = false;
  try {
    ({ signingKey, legacy, needsRewrap } = recoverSigningKey(reg.secretHash));
  } catch {
    // Persist the verdict so the admin gateway page can show a
    // "credential unusable — re-register" status instead of the gateway
    // just silently 401ing forever.
    if (!reg.credentialUnusable) {
      await db
        .update(gatewayRegistrationsTable)
        .set({ credentialUnusable: true, updatedAt: new Date() })
        .where(and(eq(gatewayRegistrationsTable.id, reg.id), eq(gatewayRegistrationsTable.secretHash, reg.secretHash)));
    }
    res.status(401).json({ error: "Gateway credential unusable — re-register the gateway", errorAr: "بيانات اعتماد البوابة غير صالحة" });
    return;
  }
  // Self-heal: the stored credential decrypts again (e.g. the pepper was
  // restored or the row was re-wrapped), so clear a stale unusable flag.
  if (reg.credentialUnusable) {
    await db
      .update(gatewayRegistrationsTable)
      .set({ credentialUnusable: false, updatedAt: new Date() })
      .where(eq(gatewayRegistrationsTable.id, reg.id));
  }
  const bodyHash = sha256(req.rawBody ?? Buffer.from(""));
  const expected = createHmac("sha256", signingKey).update(`${timestamp}.${bodyHash}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sigHeader, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid gateway signature", errorAr: "توقيع البوابة غير صالح" });
    return;
  }
  if (legacy || needsRewrap) {
    // Lazy rotation: replace the plaintext signing key with its envelope the
    // first time the registration is seen after the hardening deploy, and
    // re-wrap envelopes still encrypted under the PREVIOUS pepper during a
    // pepper-rotation window. The secretHash guard makes this a no-op if a
    // concurrent request already rotated the row.
    const upgraded = legacy ? rotateLegacyValue(reg.secretHash) : rewrapEnvelope(reg.secretHash);
    await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: upgraded, updatedAt: new Date() })
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

/**
 * Pepper-rotation path: when GATEWAY_KEY_PEPPER_PREVIOUS is set, re-wrap
 * every envelope still encrypted under the previous pepper so registered
 * gateways keep authenticating across the rotation without re-registration.
 * Idempotent; envelopes already under the current pepper are skipped
 * (recoverSigningKey reports needsRewrap=false for them). Unrecoverable or
 * tampered envelopes are left untouched (they fail closed at verification)
 * and reported so operators can act.
 */
export async function rewrapGatewayKeysForPepperRotation(): Promise<{
  rewrapped: number;
  unrecoverable: number[];
}> {
  const result = { rewrapped: 0, unrecoverable: [] as number[] };
  if (!process.env.GATEWAY_KEY_PEPPER_PREVIOUS) return result;
  const rows = await db
    .select({ id: gatewayRegistrationsTable.id, secretHash: gatewayRegistrationsTable.secretHash })
    .from(gatewayRegistrationsTable);
  for (const row of rows) {
    if (!isProtectedEnvelope(row.secretHash)) continue;
    let needsRewrap: boolean;
    try {
      ({ needsRewrap } = recoverSigningKey(row.secretHash));
    } catch {
      result.unrecoverable.push(row.id);
      continue;
    }
    if (!needsRewrap) continue;
    const updated = await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: rewrapEnvelope(row.secretHash), updatedAt: new Date() })
      .where(and(eq(gatewayRegistrationsTable.id, row.id), eq(gatewayRegistrationsTable.secretHash, row.secretHash)))
      .returning({ id: gatewayRegistrationsTable.id });
    result.rewrapped += updated.length;
  }
  return result;
}

/**
 * Startup sweep: persist a per-registration "credential unusable" verdict so
 * the admin gateway page can mark registrations whose stored envelope cannot
 * be decrypted (tampering or a lost pepper) and clear the mark once the
 * envelope decrypts again (e.g. after re-registration or pepper recovery).
 * Legacy plaintext rows are always usable. Idempotent; safe at every start.
 */
export async function sweepUnusableGatewayCredentials(): Promise<{
  marked: number[];
  cleared: number[];
}> {
  const rows = await db
    .select({
      id: gatewayRegistrationsTable.id,
      secretHash: gatewayRegistrationsTable.secretHash,
      credentialUnusable: gatewayRegistrationsTable.credentialUnusable,
    })
    .from(gatewayRegistrationsTable);
  const marked: number[] = [];
  const cleared: number[] = [];
  for (const row of rows) {
    let unusable = false;
    if (isProtectedEnvelope(row.secretHash)) {
      try {
        recoverSigningKey(row.secretHash);
      } catch {
        unusable = true;
      }
    }
    if (unusable === row.credentialUnusable) continue;
    // secretHash guard: skip if a concurrent request already replaced the
    // credential (its own path will set the flag correctly).
    const updated = await db
      .update(gatewayRegistrationsTable)
      .set({ credentialUnusable: unusable, updatedAt: new Date() })
      .where(and(eq(gatewayRegistrationsTable.id, row.id), eq(gatewayRegistrationsTable.secretHash, row.secretHash)))
      .returning({ id: gatewayRegistrationsTable.id });
    if (updated.length) (unusable ? marked : cleared).push(row.id);
  }
  return { marked, cleared };
}

/**
 * Live pepper-rotation window status, shared by the startup warning and the
 * admin governance page. "Complete" means the PREVIOUS pepper is still set
 * even though no envelope needs it any more — the operator should remove
 * GATEWAY_KEY_PEPPER_PREVIOUS to close the window. Unrecoverable envelopes
 * keep the window "open" only in the sense that operator action (gateway
 * re-registration) is still required; they are reported separately.
 */
export async function getPepperRotationStatus(): Promise<{
  windowOpen: boolean;
  rotationComplete: boolean;
  pendingRewrap: number;
  unrecoverable: number;
}> {
  if (!process.env.GATEWAY_KEY_PEPPER_PREVIOUS) {
    return { windowOpen: false, rotationComplete: false, pendingRewrap: 0, unrecoverable: 0 };
  }
  const rows = await db
    .select({ secretHash: gatewayRegistrationsTable.secretHash })
    .from(gatewayRegistrationsTable);
  let pendingRewrap = 0;
  let unrecoverable = 0;
  for (const row of rows) {
    if (!isProtectedEnvelope(row.secretHash)) continue;
    try {
      if (recoverSigningKey(row.secretHash).needsRewrap) pendingRewrap++;
    } catch {
      unrecoverable++;
    }
  }
  return {
    windowOpen: true,
    rotationComplete: pendingRewrap === 0 && unrecoverable === 0,
    pendingRewrap,
    unrecoverable,
  };
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
  // Notify HR admins exactly once when this heartbeat transitions the
  // registration into a warning state (SDK missing / skew over limit), and
  // auto-resolve open alerts on recovery. `reg` is the pre-heartbeat row.
  await processGatewayWarningTransitions(reg, {
    sdkPresent: typeof sdkPresent === "boolean" ? sdkPresent : undefined,
    deviceClockSkewAlert:
      deviceSkewAlert !== undefined ? deviceSkewAlert : deviceClockSkewMs === null ? false : undefined,
    deviceClockSkewMs: deviceSkewMs ?? null,
    adapterConnStatus: connStatus,
    adapterConnMessage: typeof connMessage === "string" ? connMessage : undefined,
  });
  // Deliver queued device commands (e.g. RESTART) with this heartbeat.
  // Stale commands are expired FIRST so a reboot queued long ago can never
  // fire unexpectedly when a gateway comes back online; then marking
  // PENDING → DELIVERED and returning the rows in one atomic UPDATE means a
  // fresh command is handed to exactly one heartbeat response.
  const commandCutoff = new Date(Date.now() - DEVICE_COMMAND_TTL_MS);
  const expiredCommands = await db
    .update(deviceCommandsTable)
    .set({ status: "EXPIRED", resultMessage: "Not delivered within the delivery window", updatedAt: new Date() })
    .where(and(
      eq(deviceCommandsTable.registrationId, reg.id),
      eq(deviceCommandsTable.status, "PENDING"),
      lt(deviceCommandsTable.createdAt, commandCutoff),
    ))
    .returning({
      id: deviceCommandsTable.id,
      deviceId: deviceCommandsTable.deviceId,
      command: deviceCommandsTable.command,
      status: deviceCommandsTable.status,
      requestedByUserId: deviceCommandsTable.requestedByUserId,
      resultMessage: deviceCommandsTable.resultMessage,
    });
  // Tell the requester their restart expired even if they left the page.
  // Deferred: a slow notifications insert must never slow the heartbeat.
  notifyCommandOutcomesDeferred(expiredCommands);
  const deliveredCommands = await db
    .update(deviceCommandsTable)
    .set({ status: "DELIVERED", deliveredAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(deviceCommandsTable.registrationId, reg.id),
      eq(deviceCommandsTable.status, "PENDING"),
      gte(deviceCommandsTable.createdAt, commandCutoff),
    ))
    .returning({ id: deviceCommandsTable.id, deviceId: deviceCommandsTable.deviceId, command: deviceCommandsTable.command });
  // Attach the target device's serial number so multi-terminal middleware
  // adapters (ZKBioTime / BioStar 2) can reboot the exact terminal the
  // operator picked instead of the first registered one.
  const commandDeviceIds = [...new Set(deliveredCommands.map((c) => c.deviceId).filter((id): id is number => id !== null))];
  const serialByDeviceId = new Map<number, string>();
  if (commandDeviceIds.length > 0) {
    const rows = await db
      .select({ id: attendanceDevicesTable.id, serialNumber: attendanceDevicesTable.serialNumber })
      .from(attendanceDevicesTable)
      .where(inArray(attendanceDevicesTable.id, commandDeviceIds));
    for (const row of rows) serialByDeviceId.set(row.id, row.serialNumber);
  }
  res.json({
    ok: true,
    commands: deliveredCommands.map((c) => ({ ...c, deviceSerial: c.deviceId !== null ? serialByDeviceId.get(c.deviceId) ?? null : null })),
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

// POST /gateway/commands/ack — gateway reports command outcomes
gatewayMachineRouter.post("/gateway/commands/ack", verifyGatewaySignature, async (req: GatewayRequest, res): Promise<void> => {
  const reg = req.gatewayRegistration!;
  const { acks } = req.body as { acks?: Array<{ commandId: number; ok: boolean; message?: string }> };
  if (!Array.isArray(acks) || acks.length === 0) {
    res.status(400).json({ error: "acks[] required" });
    return;
  }
  const results: Array<{ commandId: number; status: string }> = [];
  for (const ack of acks) {
    if (!Number.isFinite(ack.commandId) || typeof ack.ok !== "boolean") {
      results.push({ commandId: ack.commandId, status: "INVALID" });
      continue;
    }
    // A gateway may only ack commands that were delivered to it.
    const [updated] = await db
      .update(deviceCommandsTable)
      .set({
        status: ack.ok ? "ACKNOWLEDGED" : "FAILED",
        acknowledgedAt: new Date(),
        resultMessage: typeof ack.message === "string" ? ack.message.slice(0, 2000) : null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(deviceCommandsTable.id, ack.commandId),
        eq(deviceCommandsTable.registrationId, reg.id),
        eq(deviceCommandsTable.status, "DELIVERED"),
      ))
      .returning();
    if (!updated) {
      results.push({ commandId: ack.commandId, status: "NOT_FOUND" });
      continue;
    }
    results.push({ commandId: ack.commandId, status: updated.status });
    // In-app notification to the requesting operator: they should learn the
    // reboot outcome even if they navigated away from the device panel.
    // Deferred: a slow notifications insert must never slow the ack response.
    notifyCommandOutcomesDeferred([updated]);
    await db.insert(auditLogsTable).values({
      action: "device_command_ack",
      entityType: "device_command",
      entityId: updated.id,
      entityLabel: updated.command,
      actorUserId: null,
      changesJson: JSON.stringify({ registrationId: reg.id, deviceId: updated.deviceId, ok: ack.ok, message: updated.resultMessage }),
    });
  }
  res.json({ ok: true, results });
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
  // Gateways now reconcile automatically on a timer, so identical outcomes
  // are deduped: a new audit row is written only when the outcome changed or
  // the previous row is older than RECONCILE_AUDIT_MIN_INTERVAL_MS. This
  // rate-limits audit growth without hiding new discrepancies.
  const missing = results.filter((r) => r.status === "MISSING_ON_SERVER").map((r) => r.batchUuid);
  const mismatched = results.filter((r) => r.status === "COUNT_MISMATCH").map((r) => r.batchUuid);
  const changesJson = JSON.stringify({ checked: results.length, missing, mismatched });
  const [lastAudit] = await db
    .select({ createdAt: auditLogsTable.createdAt, changesJson: auditLogsTable.changesJson })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.action, "gateway_reconcile"),
      eq(auditLogsTable.entityType, "gateway_registration"),
      eq(auditLogsTable.entityId, reg.id),
    ))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(1);
  const isFreshDuplicate =
    lastAudit !== undefined &&
    lastAudit.changesJson === changesJson &&
    Date.now() - new Date(lastAudit.createdAt).getTime() < RECONCILE_AUDIT_MIN_INTERVAL_MS;
  if (!isFreshDuplicate) {
    await db.insert(auditLogsTable).values({
      action: "gateway_reconcile",
      entityType: "gateway_registration",
      entityId: reg.id,
      entityLabel: reg.name,
      actorUserId: null,
      changesJson,
    });
  }
  // Notify HR admins exactly once when this reconcile transitions the
  // registration into a discrepancy state (missing/mismatched batches), and
  // auto-resolve the open alert when a later reconcile comes back clean.
  // The previous state is derived from the latest reconcile audit row loaded
  // above, so a re-reported identical (or shifted) discrepancy never
  // re-notifies within the same episode.
  let prevHadDiscrepancy = false;
  if (lastAudit?.changesJson) {
    try {
      const prev = JSON.parse(lastAudit.changesJson) as { missing?: string[]; mismatched?: string[] };
      prevHadDiscrepancy = (prev.missing?.length ?? 0) > 0 || (prev.mismatched?.length ?? 0) > 0;
    } catch {
      // Unparseable previous outcome — treat as clean so a real discrepancy still alerts.
    }
  }
  await processReconcileDiscrepancyTransitions(reg, prevHadDiscrepancy, { missing, mismatched });
  res.json({ ok: true, results, audited: !isFreshDuplicate });
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
  const { name, nameAr, deviceId, adapterType, notes, silenceThresholdMinutes } = req.body as {
    name?: string; nameAr?: string; deviceId?: number; adapterType?: string; notes?: string;
    silenceThresholdMinutes?: unknown;
  };
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  // Optional per-registration silence alarm window — validated exactly like
  // the PATCH endpoint (integer minutes 1–1440; null/undefined = global default).
  let thresholdValue: number | null = null;
  if (silenceThresholdMinutes !== undefined && silenceThresholdMinutes !== null) {
    if (
      typeof silenceThresholdMinutes === "number" &&
      Number.isInteger(silenceThresholdMinutes) &&
      silenceThresholdMinutes >= 1 &&
      silenceThresholdMinutes <= 1440
    ) {
      thresholdValue = silenceThresholdMinutes;
    } else {
      res.status(400).json({ error: "silenceThresholdMinutes must be an integer between 1 and 1440 minutes, or null" });
      return;
    }
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
      silenceThresholdMinutes: thresholdValue,
    })
    .returning();
  await db.insert(auditLogsTable).values({
    action: "create",
    entityType: "gateway_registration",
    entityId: reg.id,
    entityLabel: name,
    actorUserId,
    changesJson: JSON.stringify({ adapterType: reg.adapterType, deviceId: reg.deviceId, silenceThresholdMinutes: reg.silenceThresholdMinutes }),
  });
  // The plaintext secret is returned exactly once and never stored.
  res.status(201).json({ ...reg, secret, secretHash: undefined });
});

// GET /gateway/registrations
// Each row carries a server-computed `silent` flag (ACTIVE + no heartbeat
// within the silence threshold) plus the threshold itself, so the admin UI
// shows the same online/offline verdict the notification sweep uses.
gatewayAdminRouter.get("/gateway/registrations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(gatewayRegistrationsTable).orderBy(desc(gatewayRegistrationsTable.createdAt));
  // Latest RECONCILE command per registration so the admin UI can show
  // queued/delivered/acknowledged feedback for the "reconcile now" action.
  const commandRows = await db
    .select()
    .from(deviceCommandsTable)
    .where(eq(deviceCommandsTable.command, "RECONCILE"))
    .orderBy(desc(deviceCommandsTable.createdAt))
    .limit(500);
  const latestReconcileCommand = new Map<number, (typeof commandRows)[number]>();
  for (const c of commandRows) {
    if (!latestReconcileCommand.has(c.registrationId)) latestReconcileCommand.set(c.registrationId, c);
  }
  const now = Date.now();
  res.json(
    rows.map((r) => {
      const cmd = latestReconcileCommand.get(r.id);
      const reconcileCommand = cmd
        ? {
            id: cmd.id,
            status: cmd.status,
            resultMessage: cmd.resultMessage,
            createdAt: cmd.createdAt.toISOString(),
            acknowledgedAt: cmd.acknowledgedAt ? cmd.acknowledgedAt.toISOString() : null,
          }
        : null;
      const lastContact = r.lastHeartbeatAt ?? r.lastSeenAt ?? r.createdAt;
      // Per-registration override (minutes) beats the global default —
      // mirrors exactly what the notification sweep uses.
      const thresholdMs = effectiveSilenceThresholdMs(r.silenceThresholdMinutes);
      const silent =
        r.status === "ACTIVE" && (!lastContact || now - new Date(lastContact).getTime() > thresholdMs);
      return { ...r, secretHash: undefined, silent, silenceThresholdMs: thresholdMs, reconcileCommand };
    }),
  );
});

// PATCH /gateway/registrations/:id — admin-editable settings. Currently only
// the per-registration silence threshold (minutes; null = global default).
gatewayAdminRouter.patch("/gateway/registrations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid registration id" });
    return;
  }
  const body = req.body as { silenceThresholdMinutes?: unknown };
  if (!("silenceThresholdMinutes" in body)) {
    res.status(400).json({ error: "silenceThresholdMinutes required (number of minutes, or null for the global default)" });
    return;
  }
  const raw = body.silenceThresholdMinutes;
  let value: number | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 1440) {
    value = raw;
  } else {
    res.status(400).json({ error: "silenceThresholdMinutes must be an integer between 1 and 1440 minutes, or null" });
    return;
  }
  const session = req.session as { userId?: number };
  const [existing] = await db
    .select({ id: gatewayRegistrationsTable.id, name: gatewayRegistrationsTable.name, silenceThresholdMinutes: gatewayRegistrationsTable.silenceThresholdMinutes })
    .from(gatewayRegistrationsTable)
    .where(eq(gatewayRegistrationsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [reg] = await db
    .update(gatewayRegistrationsTable)
    .set({ silenceThresholdMinutes: value, updatedAt: new Date() })
    .where(eq(gatewayRegistrationsTable.id, id))
    .returning();
  await db.insert(auditLogsTable).values({
    action: "update",
    entityType: "gateway_registration",
    entityId: id,
    entityLabel: existing.name,
    actorUserId: session.userId ?? null,
    changesJson: JSON.stringify({
      silenceThresholdMinutes: { from: existing.silenceThresholdMinutes, to: value },
    }),
  });
  res.json({ ...reg, secretHash: undefined, silenceThresholdMs: effectiveSilenceThresholdMs(reg.silenceThresholdMinutes) });
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

// POST /gateway/registrations/:id/reconcile — queue an immediate RECONCILE
// command for the gateway. Delivered via the next heartbeat (same channel as
// RESTART); the gateway executes GatewayService.reconcileNow() and acks the
// outcome. Duplicate in-flight requests are rejected so an impatient admin
// clicking repeatedly cannot pile up commands.
gatewayAdminRouter.post("/gateway/registrations/:id/reconcile", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid registration id" });
    return;
  }
  const [reg] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, id));
  if (!reg) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (reg.status !== "ACTIVE") {
    res.status(409).json({
      error: "Gateway registration is not active — a reconcile command cannot be delivered",
      errorAr: "تسجيل البوابة غير نشط — لا يمكن تسليم أمر المطابقة",
    });
    return;
  }
  // Expire stale queued commands first so an old wedged RECONCILE can never
  // block a fresh request forever (same TTL as heartbeat delivery).
  const cutoff = new Date(Date.now() - DEVICE_COMMAND_TTL_MS);
  const expired = await db
    .update(deviceCommandsTable)
    .set({ status: "EXPIRED", resultMessage: "Not delivered within the delivery window", updatedAt: new Date() })
    .where(and(
      eq(deviceCommandsTable.registrationId, id),
      eq(deviceCommandsTable.command, "RECONCILE"),
      inArray(deviceCommandsTable.status, ["PENDING", "DELIVERED"]),
      lt(deviceCommandsTable.createdAt, cutoff),
    ))
    .returning({
      id: deviceCommandsTable.id,
      deviceId: deviceCommandsTable.deviceId,
      command: deviceCommandsTable.command,
      status: deviceCommandsTable.status,
      requestedByUserId: deviceCommandsTable.requestedByUserId,
      resultMessage: deviceCommandsTable.resultMessage,
    });
  notifyCommandOutcomesDeferred(expired);
  const [inFlight] = await db
    .select({ id: deviceCommandsTable.id })
    .from(deviceCommandsTable)
    .where(and(
      eq(deviceCommandsTable.registrationId, id),
      eq(deviceCommandsTable.command, "RECONCILE"),
      inArray(deviceCommandsTable.status, ["PENDING", "DELIVERED"]),
    ))
    .limit(1);
  if (inFlight) {
    res.status(409).json({
      error: "A reconcile is already pending for this gateway",
      errorAr: "توجد مطابقة معلقة بالفعل لهذه البوابة",
    });
    return;
  }
  const session = req.session as { userId?: number };
  const [command] = await db
    .insert(deviceCommandsTable)
    .values({ deviceId: reg.deviceId ?? null, registrationId: id, command: "RECONCILE", requestedByUserId: session.userId ?? null })
    .returning();
  await db.insert(auditLogsTable).values({
    action: "gateway_reconcile_requested",
    entityType: "gateway_registration",
    entityId: id,
    entityLabel: reg.name,
    actorUserId: session.userId ?? null,
    changesJson: JSON.stringify({ commandId: command.id }),
  });
  res.status(201).json({
    ...command,
    deliveredAt: command.deliveredAt ? command.deliveredAt.toISOString() : null,
    acknowledgedAt: command.acknowledgedAt ? command.acknowledgedAt.toISOString() : null,
    createdAt: command.createdAt.toISOString(),
    updatedAt: command.updatedAt.toISOString(),
  });
});

// GET /gateway/registrations/:id/commands — recent commands for this gateway
// (reconcile/restart feedback for the admin UI).
gatewayAdminRouter.get("/gateway/registrations/:id/commands", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid registration id" });
    return;
  }
  const rows = await db
    .select()
    .from(deviceCommandsTable)
    .where(eq(deviceCommandsTable.registrationId, id))
    .orderBy(desc(deviceCommandsTable.createdAt))
    .limit(10);
  res.json(rows.map((c) => ({
    ...c,
    deliveredAt: c.deliveredAt ? c.deliveredAt.toISOString() : null,
    acknowledgedAt: c.acknowledgedAt ? c.acknowledgedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  })));
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
