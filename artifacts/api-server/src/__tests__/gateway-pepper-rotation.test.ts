/**
 * Pepper-rotation tests for the gateway key vault.
 *
 * Scenario: GATEWAY_KEY_PEPPER is rotated to a new value. Envelopes wrapped
 * under the old pepper must remain decryptable while
 * GATEWAY_KEY_PEPPER_PREVIOUS carries the old value, must be re-wrapped
 * under the new pepper at startup (rewrapGatewayKeysForPepperRotation), and
 * gateways must keep authenticating throughout. Tampered/unrecoverable
 * envelopes must still fail closed.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { createHmac, createHash } from "crypto";
import { db, gatewayRegistrationsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  protectSigningKey,
  recoverSigningKey,
  rewrapEnvelope,
  isProtectedEnvelope,
} from "../lib/gatewayKeyVault.js";
import { rewrapGatewayKeysForPepperRotation } from "../routes/attendanceGateway.js";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const OLD_PEPPER = "test-old-pepper-value";
const NEW_PEPPER = "test-new-pepper-value";

const savedPepper = process.env.GATEWAY_KEY_PEPPER;
const savedPrevious = process.env.GATEWAY_KEY_PEPPER_PREVIOUS;

function setPeppers(current: string | undefined, previous: string | undefined) {
  if (current === undefined) delete process.env.GATEWAY_KEY_PEPPER;
  else process.env.GATEWAY_KEY_PEPPER = current;
  if (previous === undefined) delete process.env.GATEWAY_KEY_PEPPER_PREVIOUS;
  else process.env.GATEWAY_KEY_PEPPER_PREVIOUS = previous;
}

function restorePeppers() {
  setPeppers(savedPepper, savedPrevious);
}

afterEach(restorePeppers);

describe("gatewayKeyVault pepper rotation", () => {
  it("decrypts an old-pepper envelope via the previous pepper and flags it for re-wrap", () => {
    setPeppers(OLD_PEPPER, undefined);
    const signingKey = sha256("some-secret");
    const envelope = protectSigningKey(signingKey);

    // Rotate: new pepper current, old pepper previous.
    setPeppers(NEW_PEPPER, OLD_PEPPER);
    const recovered = recoverSigningKey(envelope);
    expect(recovered.signingKey).toBe(signingKey);
    expect(recovered.needsRewrap).toBe(true);

    // Re-wrapped envelope decrypts under the current pepper alone.
    const rewrapped = rewrapEnvelope(envelope);
    expect(isProtectedEnvelope(rewrapped)).toBe(true);
    setPeppers(NEW_PEPPER, undefined);
    const after = recoverSigningKey(rewrapped);
    expect(after.signingKey).toBe(signingKey);
    expect(after.needsRewrap).toBe(false);
  });

  it("fails closed when neither current nor previous pepper can decrypt", () => {
    setPeppers(OLD_PEPPER, undefined);
    const envelope = protectSigningKey(sha256("another-secret"));
    setPeppers(NEW_PEPPER, "totally-wrong-pepper");
    expect(() => recoverSigningKey(envelope)).toThrow(/undecryptable/i);
    // Without a previous pepper configured, same failure.
    setPeppers(NEW_PEPPER, undefined);
    expect(() => recoverSigningKey(envelope)).toThrow(/undecryptable/i);
  });

  it("fails closed on a tampered envelope even during a rotation window", () => {
    setPeppers(OLD_PEPPER, undefined);
    const envelope = protectSigningKey(sha256("tamper-secret"));
    const parts = envelope.split(":");
    // Flip a byte in the ciphertext.
    const ct = parts[3];
    parts[3] = (ct[0] === "0" ? "1" : "0") + ct.slice(1);
    const tampered = parts.join(":");
    setPeppers(NEW_PEPPER, OLD_PEPPER);
    expect(() => recoverSigningKey(tampered)).toThrow(/undecryptable/i);
  });
});

describe("startup re-wrap + end-to-end gateway auth across a pepper rotation", () => {
  let regId: number;
  let signingKey: string;

  const signedHeaders = (body: object) => {
    const ts = Date.now();
    const bodyHash = sha256(Buffer.from(JSON.stringify(body)));
    const sig = createHmac("sha256", signingKey).update(`${ts}.${bodyHash}`).digest("hex");
    return { "x-gateway-id": String(regId), "x-gateway-timestamp": String(ts), "x-gateway-signature": sig };
  };

  const heartbeat = async () => {
    const body = { deviceTimeMs: Date.now() };
    return request(app).post("/api/gateway/heartbeat").set(signedHeaders(body)).send(body);
  };

  beforeAll(async () => {
    // Register a gateway row directly, wrapped under the OLD pepper.
    setPeppers(OLD_PEPPER, undefined);
    signingKey = sha256(`pepper-rotation-test-secret-${Date.now()}`);
    const [reg] = await db
      .insert(gatewayRegistrationsTable)
      .values({
        name: "Pepper Rotation Test Gateway",
        nameAr: "بوابة اختبار تدوير المفتاح",
        adapterType: "SIMULATOR",
        status: "ACTIVE",
        registeredByUserId: 1,
        secretHash: protectSigningKey(signingKey),
      })
      .returning({ id: gatewayRegistrationsTable.id });
    regId = reg.id;
    restorePeppers();
  });

  afterAll(async () => {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, regId));
    await db.delete(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, regId));
    restorePeppers();
  });

  it("authenticates before rotation, survives startup re-wrap, and keeps authenticating after", async () => {
    // Before rotation: old pepper current.
    setPeppers(OLD_PEPPER, undefined);
    expect((await heartbeat()).status).toBe(200);

    // Rotation window: new pepper current, old previous. Startup re-wrap.
    setPeppers(NEW_PEPPER, OLD_PEPPER);
    const { rewrapped, unrecoverable } = await rewrapGatewayKeysForPepperRotation();
    expect(rewrapped).toBeGreaterThanOrEqual(1);
    expect(unrecoverable).not.toContain(regId);

    // Row is now decryptable under the NEW pepper alone.
    const [row] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, regId));
    setPeppers(NEW_PEPPER, undefined);
    expect(recoverSigningKey(row.secretHash).needsRewrap).toBe(false);

    // Gateway keeps authenticating after the window closes — no re-registration.
    expect((await heartbeat()).status).toBe(200);

    // Idempotent: a second startup run re-wraps nothing for this row.
    setPeppers(NEW_PEPPER, OLD_PEPPER);
    const second = await rewrapGatewayKeysForPepperRotation();
    expect(second.unrecoverable).not.toContain(regId);
  });

  it("lazily re-wraps on verification when startup was missed", async () => {
    // Reset the row back to an OLD-pepper envelope.
    setPeppers(OLD_PEPPER, undefined);
    await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: protectSigningKey(signingKey) })
      .where(eq(gatewayRegistrationsTable.id, regId));

    // Rotation window, but no startup re-wrap — a signed request both
    // authenticates AND upgrades the row.
    setPeppers(NEW_PEPPER, OLD_PEPPER);
    expect((await heartbeat()).status).toBe(200);

    const [row] = await db.select().from(gatewayRegistrationsTable).where(eq(gatewayRegistrationsTable.id, regId));
    setPeppers(NEW_PEPPER, undefined);
    expect(recoverSigningKey(row.secretHash).needsRewrap).toBe(false);
    expect((await heartbeat()).status).toBe(200);
  });

  it("returns 401 credential-unusable when the envelope is unrecoverable", async () => {
    setPeppers("some-forgotten-pepper", undefined);
    await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: protectSigningKey(signingKey) })
      .where(eq(gatewayRegistrationsTable.id, regId));

    setPeppers(NEW_PEPPER, OLD_PEPPER);
    // Startup sweep reports it as unrecoverable and leaves it untouched.
    const { unrecoverable } = await rewrapGatewayKeysForPepperRotation();
    expect(unrecoverable).toContain(regId);

    const res = await heartbeat();
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/credential unusable/i);

    // Restore a good envelope for any later cleanup consistency.
    setPeppers(NEW_PEPPER, undefined);
    await db
      .update(gatewayRegistrationsTable)
      .set({ secretHash: protectSigningKey(signingKey) })
      .where(eq(gatewayRegistrationsTable.id, regId));
  });
});
