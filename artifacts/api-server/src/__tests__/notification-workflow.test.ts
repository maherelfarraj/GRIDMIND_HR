/**
 * Integration tests — notification creation, listing, mark-read, mark-all-read.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import app from "../app";

const TEST_RECIPIENT_USER_ID = 1;
const createdNotificationIds: number[] = [];

// Notification creation is admin-only; log in as the seeded admin user.
// Demo mode (PILOT_AUTH=false) accepts any password.
async function adminAgent() {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username: "admin", password: "x" });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  return agent;
}

afterAll(async () => {
  if (createdNotificationIds.length) {
    await db.delete(notificationsTable)
      .where(inArray(notificationsTable.id, createdNotificationIds));
  }
});

describe("notification workflow", () => {
  let notificationId: number;

  it("POST /api/notifications creates a notification and returns 201", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "announcement",
        titleEn: "TEST Notification",
        titleAr: "إشعار اختبار",
        bodyEn: "This is a test notification body.",
        bodyAr: "هذا نص إشعار اختبار.",
        severity: "info",
        isRead: false,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.recipientUserId).toBe(TEST_RECIPIENT_USER_ID);
    expect(res.body.notificationType).toBe("announcement");
    expect(res.body.titleEn).toBe("TEST Notification");
    expect(res.body.isRead).toBe(false);
    notificationId = res.body.id;
    createdNotificationIds.push(notificationId);
  });

  it("GET /api/notifications?recipientUserId=1 includes the created notification", async () => {
    const res = await request(app)
      .get(`/api/notifications?recipientUserId=${TEST_RECIPIENT_USER_ID}&limit=100`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((n: any) => n.id);
    expect(ids).toContain(notificationId);
  });

  it("GET /api/notifications/:id returns the individual notification", async () => {
    const res = await request(app).get(`/api/notifications/${notificationId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(notificationId);
    expect(res.body.titleEn).toBe("TEST Notification");
  });

  it("PATCH /api/notifications/:id marks isRead:true and returns 200", async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notificationId}`)
      .send({ isRead: true });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(notificationId);
    expect(res.body.isRead).toBe(true);
    // readAt should be set automatically by the route handler.
    expect(res.body.readAt).not.toBeNull();
  });

  it("POST /api/notifications/mark-all-read returns 200 with count", async () => {
    // Create an unread notification so mark-all-read has something to process.
    const admin = await adminAgent();
    const created = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "announcement",
        titleEn: "TEST Unread Notification",
        bodyEn: "unread",
        severity: "info",
        isRead: false,
      });
    expect(created.status).toBe(201);
    createdNotificationIds.push(created.body.id);

    const res = await request(app)
      .post("/api/notifications/mark-all-read")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("count");
    expect(typeof res.body.count).toBe("number");
  });

  it("GET /api/notifications/:id returns 404 for a non-existent notification", async () => {
    const res = await request(app).get("/api/notifications/999999");
    expect(res.status).toBe(404);
  });
});

describe("notification creation validation", () => {
  it("POST /api/notifications rejects a payload with missing required fields", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        // recipientUserId omitted
        notificationType: "announcement",
        // titleEn omitted
        bodyEn: "Some body text",
        severity: "info",
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("errors");
    expect(Array.isArray(res.body.errors)).toBe(true);
    // Both missing fields should be called out
    const msgs: string[] = res.body.errors;
    expect(msgs.some((m) => /recipientUserId/i.test(m))).toBe(true);
    expect(msgs.some((m) => /titleEn/i.test(m))).toBe(true);
  });

  it("POST /api/notifications rejects an invalid notificationType", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "made_up_type",
        titleEn: "Title",
        bodyEn: "Body",
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("errors");
    const msgs: string[] = res.body.errors;
    expect(msgs.some((m) => /notificationType/i.test(m))).toBe(true);
  });

  it("POST /api/notifications rejects an invalid severity", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "announcement",
        titleEn: "Title",
        bodyEn: "Body",
        severity: "critical", // not in the allowed enum
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("errors");
    const msgs: string[] = res.body.errors;
    expect(msgs.some((m) => /severity/i.test(m))).toBe(true);
  });

  it("POST /api/notifications rejects an oversized titleEn", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "announcement",
        titleEn: "x".repeat(301), // exceeds 300-char limit
        bodyEn: "Body",
        severity: "info",
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("errors");
    const msgs: string[] = res.body.errors;
    expect(msgs.some((m) => /titleEn/i.test(m))).toBe(true);
  });

  it("POST /api/notifications accepts a valid minimal payload and returns 201", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "system",
        titleEn: "Valid minimal notification",
        bodyEn: "Body text.",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.notificationType).toBe("system");
    expect(res.body.severity).toBe("info"); // DB default
    createdNotificationIds.push(res.body.id);
  });

  it("POST /api/notifications strips unrecognised extra fields", async () => {
    const admin = await adminAgent();
    const res = await admin
      .post("/api/notifications")
      .send({
        recipientUserId: TEST_RECIPIENT_USER_ID,
        notificationType: "announcement",
        titleEn: "Whitelist test",
        bodyEn: "Body.",
        severity: "info",
        isEscalated: true,        // server-controlled, should be ignored
        escalatedToUserId: 999,   // server-controlled, should be ignored
        hackField: "DROP TABLE notifications;",  // unknown field
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    // The unknown / server-controlled fields must not be persisted
    expect(res.body.isEscalated).toBe(false);
    expect(res.body.escalatedToUserId).toBeNull();
    createdNotificationIds.push(res.body.id);
  });
});
