/**
 * Authorization tests — notifications are self-scoped. A user must only see
 * and modify notifications addressed to them.
 *
 * Without a session, the API's demo actor is userId=1, so any other
 * recipient id acts as "another user".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import app from "../app";

const SELF_ID = 1; // demo/session fallback actor
const OTHER_ID = 999_432;

let selfNotifId = 0;
let otherNotifId = 0;

beforeAll(async () => {
  const [selfRow] = await db.insert(notificationsTable).values({
    recipientUserId: SELF_ID,
    notificationType: "authz_test",
    titleEn: "AUTHZ TEST self",
    titleAr: "اختبار",
    bodyEn: "authz test body",
    bodyAr: "اختبار",
    isRead: false,
  } as any).returning();
  const [otherRow] = await db.insert(notificationsTable).values({
    recipientUserId: OTHER_ID,
    notificationType: "authz_test",
    titleEn: "AUTHZ TEST other",
    titleAr: "اختبار",
    bodyEn: "authz test body",
    bodyAr: "اختبار",
    isRead: false,
  } as any).returning();
  selfNotifId = selfRow.id;
  otherNotifId = otherRow.id;
});

afterAll(async () => {
  await db.delete(notificationsTable)
    .where(inArray(notificationsTable.id, [selfNotifId, otherNotifId]));
});

describe("notifications authorization", () => {
  it("list defaults to the session user's notifications only", async () => {
    const res = await request(app).get("/api/notifications?limit=200&notificationType=authz_test");
    expect(res.status).toBe(200);
    const ids = res.body.data.map((n: any) => n.id);
    expect(ids).toContain(selfNotifId);
    expect(ids).not.toContain(otherNotifId);
    for (const n of res.body.data) expect(n.recipientUserId).toBe(SELF_ID);
  });

  it("rejects listing another user's notifications with 403", async () => {
    const res = await request(app).get(`/api/notifications?recipientUserId=${OTHER_ID}`);
    expect(res.status).toBe(403);
  });

  it("allows explicitly listing your own notifications", async () => {
    const res = await request(app).get(`/api/notifications?recipientUserId=${SELF_ID}&notificationType=authz_test`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((n: any) => n.id)).toContain(selfNotifId);
  });

  it("rejects reading another user's notification by id with 403", async () => {
    const res = await request(app).get(`/api/notifications/${otherNotifId}`);
    expect(res.status).toBe(403);
  });

  it("rejects marking another user's notification read and persists nothing", async () => {
    const res = await request(app)
      .patch(`/api/notifications/${otherNotifId}`)
      .send({ isRead: true });
    expect(res.status).toBe(403);

    const [row] = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.id, otherNotifId));
    expect(row.isRead).toBe(false);
  });

  it("rejects a non-admin caller creating a notification for another user", async () => {
    // Log in as a seeded non-admin user (demo mode accepts any password).
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username: "hassan.qahtani", password: "x" });
    expect(login.status).toBe(200);

    const res = await agent.post("/api/notifications").send({
      recipientUserId: OTHER_ID,
      notificationType: "security_alert",
      titleEn: "SPOOFED alert",
      bodyEn: "click here",
      severity: "critical",
    });
    expect(res.status).toBe(403);

    const rows = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.titleEn, "SPOOFED alert"));
    expect(rows.length).toBe(0);
  });

  it("rejects unauthenticated notification creation with 403", async () => {
    const res = await request(app).post("/api/notifications").send({
      recipientUserId: OTHER_ID,
      notificationType: "security_alert",
      titleEn: "SPOOFED unauth alert",
      bodyEn: "click here",
    });
    expect(res.status).toBe(403);
  });

  it("allows an admin to create a notification for another user", async () => {
    const admin = request.agent(app);
    const login = await admin.post("/api/auth/login").send({ username: "admin", password: "x" });
    expect(login.status).toBe(200);

    const res = await admin.post("/api/notifications").send({
      recipientUserId: OTHER_ID,
      notificationType: "authz_test",
      titleEn: "AUTHZ TEST admin-created",
      titleAr: "اختبار",
      bodyEn: "authz test body",
      bodyAr: "اختبار",
    });
    expect(res.status).toBe(201);
    await db.delete(notificationsTable).where(eq(notificationsTable.id, res.body.id));
  });

  it("allows marking own notification read and ignores non-writable fields", async () => {
    const res = await request(app)
      .patch(`/api/notifications/${selfNotifId}`)
      .send({ isRead: true, recipientUserId: OTHER_ID, titleEn: "hacked" });
    expect(res.status).toBe(200);
    expect(res.body.isRead).toBe(true);
    expect(res.body.recipientUserId).toBe(SELF_ID);
    expect(res.body.titleEn).toBe("AUTHZ TEST self");
    expect(res.body.readAt).toBeTruthy();
  });
});
