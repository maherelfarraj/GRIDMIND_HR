/**
 * Authorization tests — notification preferences are strictly self-scoped.
 * One user must never be able to read or overwrite another user's alert
 * delivery settings (e.g. disabling an admin's lockout alerts).
 *
 * Without a session, the API's demo actor is userId=1, so any other target
 * id acts as "another user".
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, notificationPreferencesTable } from "@workspace/db";
import app from "../app";

const SELF_ID = 1; // demo/session fallback actor
const OTHER_ID = 999_431; // no such user needed; authorization must reject before any write
const cleanupUserIds: number[] = [SELF_ID, OTHER_ID];

let selfRowExistedBefore = false;
let selfRowBefore: any = null;

afterAll(async () => {
  // Restore SELF row to its pre-test state; remove anything test-created.
  if (selfRowExistedBefore && selfRowBefore) {
    await db.update(notificationPreferencesTable)
      .set({ securityAlertChannel: selfRowBefore.securityAlertChannel })
      .where(eq(notificationPreferencesTable.userId, SELF_ID));
    await db.delete(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, OTHER_ID));
  } else {
    await db.delete(notificationPreferencesTable)
      .where(inArray(notificationPreferencesTable.userId, cleanupUserIds));
  }
});

describe("notification preferences authorization", () => {
  it("captures pre-test state", async () => {
    const [row] = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, SELF_ID));
    selfRowExistedBefore = !!row;
    selfRowBefore = row ?? null;
    expect(true).toBe(true);
  });

  it("rejects reading another user's preferences with 403", async () => {
    const res = await request(app).get(`/api/notification-preferences?userId=${OTHER_ID}`);
    expect(res.status).toBe(403);
  });

  it("rejects writing another user's preferences with 403 and persists nothing", async () => {
    const res = await request(app)
      .put(`/api/notification-preferences/${OTHER_ID}`)
      .send({ securityAlertChannel: "in_app" });
    expect(res.status).toBe(403);

    const [row] = await db.select().from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, OTHER_ID));
    expect(row).toBeUndefined();
  });

  it("allows the user to update their own securityAlertChannel", async () => {
    const res = await request(app)
      .put(`/api/notification-preferences/${SELF_ID}`)
      .send({ securityAlertChannel: "email" });
    expect([200, 201]).toContain(res.status);
    expect(res.body.userId).toBe(SELF_ID);
    expect(res.body.securityAlertChannel).toBe("email");

    const get = await request(app).get(`/api/notification-preferences?userId=${SELF_ID}`);
    expect(get.status).toBe(200);
    expect(get.body.securityAlertChannel).toBe("email");
  });

  it("rejects an invalid securityAlertChannel value with 400", async () => {
    const res = await request(app)
      .put(`/api/notification-preferences/${SELF_ID}`)
      .send({ securityAlertChannel: "carrier_pigeon" });
    expect(res.status).toBe(400);
  });

  it("ignores attempts to write server-controlled fields", async () => {
    const res = await request(app)
      .put(`/api/notification-preferences/${SELF_ID}`)
      .send({ securityAlertChannel: "both", userId: OTHER_ID, id: 12345 });
    expect([200, 201]).toContain(res.status);
    expect(res.body.userId).toBe(SELF_ID);
    expect(res.body.securityAlertChannel).toBe("both");
  });
});
