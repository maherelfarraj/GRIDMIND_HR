/**
 * Silent-gateway sweep — an ACTIVE registration whose lastHeartbeatAt is
 * older than the threshold must raise exactly one alert per outage (no
 * repeats on subsequent sweeps), and resumed heartbeats must auto-resolve it.
 *
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash, createHmac } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  gatewayRegistrationsTable,
  notificationsTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";
import {
  GATEWAY_SILENT_ALERT_TYPE,
  runGatewaySilenceSweepOnce,
} from "../lib/gatewayDeviceAlerts";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const THRESHOLD_MS = 10 * 60_000;

let registrationId: number;
let signingKey: string;

const admin = request.agent(app);

async function postHeartbeat(payload: Record<string, unknown> = {}) {
  const body = JSON.stringify({ deviceTimeMs: Date.now(), ...payload });
  const ts = Date.now();
  const sig = createHmac("sha256", signingKey).update(`${ts}.${sha256(body)}`).digest("hex");
  return request(app)
    .post("/api/gateway/heartbeat")
    .set({
      "content-type": "application/json",
      "x-gateway-id": String(registrationId),
      "x-gateway-timestamp": String(ts),
      "x-gateway-signature": sig,
    })
    .send(body);
}

async function silenceAlerts() {
  return db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_SILENT_ALERT_TYPE),
        eq(notificationsTable.entityType, "gateway_registration"),
        eq(notificationsTable.entityId, registrationId),
      ),
    );
}

async function setLastHeartbeat(at: Date | null) {
  await db
    .update(gatewayRegistrationsTable)
    .set({ lastHeartbeatAt: at })
    .where(eq(gatewayRegistrationsTable.id, registrationId));
}

function sweep(now = new Date()) {
  return runGatewaySilenceSweepOnce({ thresholdMs: THRESHOLD_MS, now });
}

beforeAll(async () => {
  const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
  expect(login.status).toBe(200);
  const create = await admin
    .post("/api/gateway/registrations")
    .send({ name: "Silence Test Gateway", nameAr: "بوابة الصمت", adapterType: "ZKTECO" });
  expect(create.status).toBe(201);
  registrationId = create.body.id;
  signingKey = sha256(create.body.secret);
  // Fresh baseline heartbeat so the sweep starts from a healthy state.
  const hb = await postHeartbeat();
  expect(hb.status).toBe(200);
});

afterAll(async () => {
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, GATEWAY_SILENT_ALERT_TYPE),
        eq(notificationsTable.entityId, registrationId),
      ),
    );
  await db.delete(auditLogsTable).where(and(eq(auditLogsTable.entityType, "gateway_registration"), eq(auditLogsTable.entityId, registrationId)));
  await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
});

describe("silent-gateway sweep", () => {
  it("does not alert while heartbeats are fresh", async () => {
    const r = await sweep();
    expect(r.checked).toBeGreaterThan(0);
    expect(await silenceAlerts()).toHaveLength(0);
  });

  it("alerts every HR admin once when the gateway goes silent past the threshold", async () => {
    await setLastHeartbeat(new Date(Date.now() - THRESHOLD_MS - 60_000));
    const r = await sweep();
    expect(r.alertsRaised).toBeGreaterThanOrEqual(1);

    const rows = await silenceAlerts();
    expect(rows.length).toBeGreaterThan(0); // one per active admin
    expect(rows.every((n) => n.severity === "urgent" && !n.isDismissed)).toBe(true);
    expect(rows[0].titleEn).toContain("Silence Test Gateway");
    expect(rows[0].actionUrl).toBe("/attendance-gateway");
    const recipients = new Set(rows.map((n) => n.recipientUserId));
    expect(recipients.size).toBe(rows.length);
  });

  it("does not re-notify on subsequent sweeps during the same outage", async () => {
    const before = (await silenceAlerts()).length;
    for (let i = 0; i < 3; i++) {
      const r = await sweep();
      expect(r.alertsRaised).toBe(0);
    }
    expect((await silenceAlerts()).length).toBe(before);
  });

  it("does not re-alert after admins dismiss the notifications while the outage continues", async () => {
    // Dismissal is an acknowledgement, not a recovery — the same outage must
    // never generate a second wave of notifications.
    const rows = await silenceAlerts();
    expect(rows.some((n) => !n.isDismissed)).toBe(true);
    await db
      .update(notificationsTable)
      .set({ isDismissed: true, dismissedAt: new Date() })
      .where(
        and(
          eq(notificationsTable.notificationType, GATEWAY_SILENT_ALERT_TYPE),
          eq(notificationsTable.entityId, registrationId),
        ),
      );
    const before = (await silenceAlerts()).length;
    for (let i = 0; i < 3; i++) {
      const r = await sweep();
      expect(r.alertsRaised).toBe(0);
    }
    expect((await silenceAlerts()).length).toBe(before);
  });

  it("auto-resolves the open alert when a heartbeat resumes", async () => {
    const hb = await postHeartbeat();
    expect(hb.status).toBe(200);
    const rows = await silenceAlerts();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((n) => n.isDismissed && n.dismissedAt !== null)).toBe(true);
    // A follow-up sweep on the now-fresh registration raises nothing new.
    const r = await sweep();
    expect(r.alertsRaised).toBe(0);
    expect((await silenceAlerts()).length).toBe(rows.length);
  });

  it("re-notifies on the NEXT outage after recovery (new incident)", async () => {
    const dismissed = (await silenceAlerts()).length;
    // Simulate a new outage: the recovery heartbeat already advanced
    // lastHeartbeatAt past the previous outage's notifications; now let the
    // threshold elapse by sweeping with a future clock.
    await setLastHeartbeat(new Date());
    const r = await sweep(new Date(Date.now() + THRESHOLD_MS + 60_000));
    expect(r.alertsRaised).toBeGreaterThanOrEqual(1);
    const rows = await silenceAlerts();
    expect(rows.length).toBeGreaterThan(dismissed);
    expect(rows.some((n) => !n.isDismissed)).toBe(true);
  });

  it("sweep itself resolves the alert as a backstop when heartbeats are fresh again", async () => {
    // Simulate resumed heartbeats without going through the heartbeat route.
    await setLastHeartbeat(new Date());
    const r = await sweep();
    expect(r.resolved).toBeGreaterThanOrEqual(1);
    expect((await silenceAlerts()).every((n) => n.isDismissed)).toBe(true);
  });

  it("catches a registration that never sent any heartbeat (falls back to creation time)", async () => {
    await db
      .update(gatewayRegistrationsTable)
      .set({ lastHeartbeatAt: null, lastSeenAt: null, createdAt: new Date() })
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    const openBefore = (await silenceAlerts()).filter((n) => !n.isDismissed).length;
    expect(openBefore).toBe(0);
    const r = await sweep(new Date(Date.now() + THRESHOLD_MS + 60_000));
    expect(r.alertsRaised).toBeGreaterThanOrEqual(1);
    const rows = (await silenceAlerts()).filter((n) => !n.isDismissed);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].bodyEn).toContain("never sent a heartbeat");
  });

  it("ignores REVOKED registrations", async () => {
    await db
      .update(gatewayRegistrationsTable)
      .set({ status: "REVOKED", lastHeartbeatAt: new Date(Date.now() - THRESHOLD_MS - 60_000) })
      .where(eq(gatewayRegistrationsTable.id, registrationId));
    // Dismiss existing open alerts so any new one would be detectable.
    await db
      .update(notificationsTable)
      .set({ isDismissed: true, dismissedAt: new Date() })
      .where(
        and(
          eq(notificationsTable.notificationType, GATEWAY_SILENT_ALERT_TYPE),
          eq(notificationsTable.entityId, registrationId),
        ),
      );
    const before = (await silenceAlerts()).length;
    await sweep();
    expect((await silenceAlerts()).length).toBe(before);
  });
});
