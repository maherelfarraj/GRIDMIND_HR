/**
 * Punch-batch reconcile discrepancy notifications — a reconcile that finds
 * missing/mismatched batches must notify HR admins exactly once per
 * transition into the discrepancy state, re-reported (or shifted)
 * discrepancies in the same episode must NOT re-notify, and a clean
 * reconcile must auto-resolve (dismiss) the open alert. A NEW discrepancy
 * after recovery alerts again.
 *
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID, createHash, createHmac } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  gatewayRegistrationsTable,
  punchImportBatchesTable,
  notificationsTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";
import { GATEWAY_BATCH_DISCREPANCY_ALERT_TYPE } from "../lib/gatewayDeviceAlerts";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

let registrationId: number;
let signingKey: string;
const createdBatchIds: number[] = [];

const admin = request.agent(app);

async function postReconcile(batches: Array<{ batchUuid: string; eventCount: number }>) {
  const body = JSON.stringify({ batches });
  const ts = Date.now();
  const sig = createHmac("sha256", signingKey).update(`${ts}.${sha256(body)}`).digest("hex");
  return request(app)
    .post("/api/gateway/reconcile")
    .set({
      "content-type": "application/json",
      "x-gateway-id": String(registrationId),
      "x-gateway-timestamp": String(ts),
      "x-gateway-signature": sig,
    })
    .send(body);
}

async function postPunches(batchUuid: string, eventCount: number) {
  const events = Array.from({ length: eventCount }, (_, i) => ({
    deviceUserId: `recon-alert-unmapped-${i}`,
    eventTime: "2031-01-05T06:00:00.000Z",
    eventType: "CLOCK_IN",
    deviceEventUid: `recon-alert-${batchUuid}-${i}`,
  }));
  const body = JSON.stringify({ batchUuid, deviceTimeMs: Date.now(), events });
  const ts = Date.now();
  const sig = createHmac("sha256", signingKey).update(`${ts}.${sha256(body)}`).digest("hex");
  return request(app)
    .post("/api/gateway/punches")
    .set({
      "content-type": "application/json",
      "x-gateway-id": String(registrationId),
      "x-gateway-timestamp": String(ts),
      "x-gateway-signature": sig,
    })
    .send(body);
}

async function alertRows() {
  return db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_BATCH_DISCREPANCY_ALERT_TYPE),
        eq(notificationsTable.entityType, "gateway_registration"),
        eq(notificationsTable.entityId, registrationId),
      ),
    );
}

beforeAll(async () => {
  const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
  expect(login.status).toBe(200);
  const create = await admin
    .post("/api/gateway/registrations")
    .send({ name: "Reconcile Alert Test Gateway", nameAr: "بوابة اختبار المطابقة", adapterType: "ZKTECO" });
  expect(create.status).toBe(201);
  registrationId = create.body.id;
  signingKey = sha256(create.body.secret);
});

afterAll(async () => {
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_BATCH_DISCREPANCY_ALERT_TYPE),
        eq(notificationsTable.entityType, "gateway_registration"),
        eq(notificationsTable.entityId, registrationId),
      ),
    );
  const audits = await db
    .select({ id: auditLogsTable.id, entityId: auditLogsTable.entityId })
    .from(auditLogsTable)
    .where(inArray(auditLogsTable.action, ["gateway_reconcile", "gateway_punch_import"]));
  const auditIds = audits.filter((a) => a.entityId === registrationId || createdBatchIds.includes(a.entityId ?? -1)).map((a) => a.id);
  if (auditIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, auditIds));
  if (createdBatchIds.length) {
    await db.delete(punchImportBatchesTable).where(inArray(punchImportBatchesTable.id, createdBatchIds));
  }
  await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
});

describe("reconcile discrepancy notifications", () => {
  const missingUuid = `${randomUUID()}-recon-alert-missing`;

  it("a reconcile with a missing batch notifies HR admins once", async () => {
    // Baseline: a clean reconcile first so the discrepancy is a transition.
    const clean = await postReconcile([]);
    expect(clean.status).toBe(200);
    expect(await alertRows()).toHaveLength(0);

    const res = await postReconcile([{ batchUuid: missingUuid, eventCount: 3 }]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("MISSING_ON_SERVER");

    const rows = await alertRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => !r.isDismissed)).toBe(true);
    expect(rows[0].severity).toBe("urgent");
    expect(rows[0].bodyEn).toContain("never received");
  });

  it("re-reporting the same discrepancy does not re-notify", async () => {
    const before = (await alertRows()).length;
    const res = await postReconcile([{ batchUuid: missingUuid, eventCount: 3 }]);
    expect(res.status).toBe(200);
    expect((await alertRows()).length).toBe(before);
  });

  it("a shifted discrepancy in the same episode does not re-notify either", async () => {
    const before = (await alertRows()).length;
    const res = await postReconcile([
      { batchUuid: missingUuid, eventCount: 3 },
      { batchUuid: `${missingUuid}-2`, eventCount: 1 },
    ]);
    expect(res.status).toBe(200);
    expect((await alertRows()).length).toBe(before);
  });

  it("a clean reconcile auto-resolves the open alert", async () => {
    // Actually deliver the batch so a full reconcile is clean.
    const uuid = `${randomUUID()}-recon-alert-ok`;
    const up = await postPunches(uuid, 2);
    expect(up.status).toBe(201);
    createdBatchIds.push(up.body.batchId);

    const res = await postReconcile([{ batchUuid: uuid, eventCount: 2 }]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("OK");

    const rows = await alertRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.isDismissed)).toBe(true);
  });

  it("a NEW discrepancy after recovery notifies again (count mismatch path)", async () => {
    const uuid = `${randomUUID()}-recon-alert-mismatch`;
    const up = await postPunches(uuid, 2);
    expect(up.status).toBe(201);
    createdBatchIds.push(up.body.batchId);

    const before = (await alertRows()).length;
    const res = await postReconcile([{ batchUuid: uuid, eventCount: 7 }]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("COUNT_MISMATCH");

    const rows = await alertRows();
    expect(rows.length).toBeGreaterThan(before);
    const open = rows.filter((r) => !r.isDismissed);
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open[0].bodyEn).toContain("mismatched event counts");
  });
});
