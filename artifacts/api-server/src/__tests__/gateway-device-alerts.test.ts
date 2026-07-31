/**
 * Gateway device warning notifications — heartbeat transitions into a warning
 * state (SDK missing / device clock skew > 60s) must notify HR admins exactly
 * once, repeat heartbeats in the same state must NOT re-notify, and recovery
 * must auto-resolve (dismiss) the open alerts.
 *
 * All fixtures are self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash, createHmac } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  gatewayRegistrationsTable,
  notificationsTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";
import {
  GATEWAY_SDK_ALERT_TYPE,
  GATEWAY_SKEW_ALERT_TYPE,
  GATEWAY_AUTH_FAILED_ALERT_TYPE,
  GATEWAY_UNREACHABLE_ALERT_TYPE,
} from "../lib/gatewayDeviceAlerts";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const ALERT_TYPES = [
  GATEWAY_SDK_ALERT_TYPE,
  GATEWAY_SKEW_ALERT_TYPE,
  GATEWAY_AUTH_FAILED_ALERT_TYPE,
  GATEWAY_UNREACHABLE_ALERT_TYPE,
];

let registrationId: number;
let signingKey: string;

const admin = request.agent(app);

async function postHeartbeat(payload: Record<string, unknown>) {
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

async function alertRows(type: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.notificationType, type),
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
    .send({ name: "Alert Test Gateway", nameAr: "بوابة تنبيهات", adapterType: "ZKTECO" });
  expect(create.status).toBe(201);
  registrationId = create.body.id;
  signingKey = sha256(create.body.secret);
});

afterAll(async () => {
  await db
    .delete(notificationsTable)
    .where(
      and(
        inArray(notificationsTable.notificationType, ALERT_TYPES),
        eq(notificationsTable.entityId, registrationId),
      ),
    );
  await db.delete(auditLogsTable).where(and(eq(auditLogsTable.entityType, "gateway_registration"), eq(auditLogsTable.entityId, registrationId)));
  await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, registrationId));
});

describe("SDK-missing transitions", () => {
  it("notifies every HR admin once when sdkPresent flips to false", async () => {
    // Healthy baseline first (sdkPresent true) — must not notify.
    let res = await postHeartbeat({ sdkPresent: true, sdkVersion: "zk-1.2.3" });
    expect(res.status).toBe(200);
    expect(await alertRows(GATEWAY_SDK_ALERT_TYPE)).toHaveLength(0);

    res = await postHeartbeat({ sdkPresent: false, sdkVersion: null });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_SDK_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(0); // one per active admin
    expect(rows.every((r) => r.severity === "urgent" && !r.isDismissed)).toBe(true);
    expect(rows[0].titleEn).toContain("Alert Test Gateway");
    expect(rows[0].actionUrl).toBe("/attendance-gateway");

    // Recipients must all be distinct admins (one notification per admin).
    const recipients = new Set(rows.map((r) => r.recipientUserId));
    expect(recipients.size).toBe(rows.length);
  });

  it("does not re-notify on repeated failing heartbeats", async () => {
    const before = (await alertRows(GATEWAY_SDK_ALERT_TYPE)).length;
    for (let i = 0; i < 3; i++) {
      const res = await postHeartbeat({ sdkPresent: false });
      expect(res.status).toBe(200);
    }
    expect((await alertRows(GATEWAY_SDK_ALERT_TYPE)).length).toBe(before);
  });

  it("auto-resolves open SDK alerts when the SDK comes back", async () => {
    const res = await postHeartbeat({ sdkPresent: true, sdkVersion: "zk-1.2.3" });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_SDK_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.isDismissed && r.dismissedAt !== null)).toBe(true);
  });

  it("re-notifies on the NEXT failure after a recovery (new incident)", async () => {
    const dismissed = (await alertRows(GATEWAY_SDK_ALERT_TYPE)).length;
    const res = await postHeartbeat({ sdkPresent: false });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_SDK_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(dismissed);
    expect(rows.some((r) => !r.isDismissed)).toBe(true);
    // clean up state for skew tests: recover
    await postHeartbeat({ sdkPresent: true });
  });
});

describe("device clock skew transitions", () => {
  it("notifies once when skew crosses 60s, without spamming on repeats", async () => {
    // Healthy skew first — no alert.
    let res = await postHeartbeat({ deviceClockSkewMs: 10_000 });
    expect(res.status).toBe(200);
    expect(await alertRows(GATEWAY_SKEW_ALERT_TYPE)).toHaveLength(0);

    res = await postHeartbeat({ deviceClockSkewMs: -125_000 });
    expect(res.status).toBe(200);
    expect(res.body.deviceClockSkewAlert).toBe(true);
    const first = await alertRows(GATEWAY_SKEW_ALERT_TYPE);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0].bodyEn).toContain("125s");
    expect(first.every((r) => !r.isDismissed)).toBe(true);

    // Repeat heartbeats while still skewed must not create new alerts.
    for (let i = 0; i < 3; i++) {
      await postHeartbeat({ deviceClockSkewMs: -130_000 });
    }
    expect((await alertRows(GATEWAY_SKEW_ALERT_TYPE)).length).toBe(first.length);
  });

  it("unmeasured heartbeats (no skew field) neither notify nor resolve", async () => {
    const before = await alertRows(GATEWAY_SKEW_ALERT_TYPE);
    const res = await postHeartbeat({});
    expect(res.status).toBe(200);
    const after = await alertRows(GATEWAY_SKEW_ALERT_TYPE);
    expect(after.length).toBe(before.length);
    expect(after.every((r) => !r.isDismissed)).toBe(true);
  });

  it("auto-resolves skew alerts when skew drops back under the limit", async () => {
    const res = await postHeartbeat({ deviceClockSkewMs: 4_000 });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_SKEW_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.isDismissed)).toBe(true);
  });

  it("explicit null skew (measured nothing) also resolves an open alert", async () => {
    // Re-enter warning state, then clear via explicit null.
    await postHeartbeat({ deviceClockSkewMs: 90_000 });
    let rows = await alertRows(GATEWAY_SKEW_ALERT_TYPE);
    expect(rows.some((r) => !r.isDismissed)).toBe(true);
    const res = await postHeartbeat({ deviceClockSkewMs: null });
    expect(res.status).toBe(200);
    rows = await alertRows(GATEWAY_SKEW_ALERT_TYPE);
    expect(rows.every((r) => r.isDismissed)).toBe(true);
  });
});

describe("adapter connection-status transitions", () => {
  it("notifies once when the device rejects the gateway's login", async () => {
    // Healthy baseline — no alert.
    let res = await postHeartbeat({ connectionTest: { status: "REACHABLE", ok: true } });
    expect(res.status).toBe(200);
    expect(await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE)).toHaveLength(0);

    res = await postHeartbeat({ connectionTest: { status: "AUTH_FAILED", message: "bad credentials" } });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.severity === "urgent" && !r.isDismissed)).toBe(true);
    expect(rows[0].titleEn).toContain("rejected login");
    expect(rows[0].bodyEn).toContain("bad credentials");

    // Repeats in the same state must not re-notify.
    for (let i = 0; i < 3; i++) {
      await postHeartbeat({ connectionTest: { status: "AUTH_FAILED" } });
    }
    expect((await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE)).length).toBe(rows.length);
  });

  it("auto-resolves the auth alert when the device becomes reachable again", async () => {
    const res = await postHeartbeat({ connectionTest: { status: "REACHABLE", ok: true } });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.isDismissed && r.dismissedAt !== null)).toBe(true);
  });

  it("notifies once when the device is unreachable, incl. ok:false fallback", async () => {
    // Legacy gateway shape: ok:false without a status string → UNREACHABLE.
    const res = await postHeartbeat({ connectionTest: { ok: false, message: "timeout after 5s" } });
    expect(res.status).toBe(200);
    const rows = await alertRows(GATEWAY_UNREACHABLE_ALERT_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.isDismissed)).toBe(true);
    expect(rows[0].titleEn).toContain("unreachable");
    expect(rows[0].bodyEn).toContain("timeout after 5s");

    // Repeat unreachable heartbeats do not re-notify.
    await postHeartbeat({ connectionTest: { status: "UNREACHABLE" } });
    expect((await alertRows(GATEWAY_UNREACHABLE_ALERT_TYPE)).length).toBe(rows.length);
  });

  it("switching from UNREACHABLE to AUTH_FAILED resolves the old alert and raises the new one", async () => {
    const res = await postHeartbeat({ connectionTest: { status: "AUTH_FAILED" } });
    expect(res.status).toBe(200);
    const unreachable = await alertRows(GATEWAY_UNREACHABLE_ALERT_TYPE);
    expect(unreachable.every((r) => r.isDismissed)).toBe(true);
    const auth = await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE);
    expect(auth.some((r) => !r.isDismissed)).toBe(true);
  });

  it("heartbeats without a connection test neither notify nor resolve", async () => {
    const before = await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE);
    const res = await postHeartbeat({});
    expect(res.status).toBe(200);
    const after = await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE);
    expect(after.length).toBe(before.length);
    expect(after.some((r) => !r.isDismissed)).toBe(true);
    // Recover to clean state.
    await postHeartbeat({ connectionTest: { status: "REACHABLE" } });
    expect((await alertRows(GATEWAY_AUTH_FAILED_ALERT_TYPE)).every((r) => r.isDismissed)).toBe(true);
  });
});
