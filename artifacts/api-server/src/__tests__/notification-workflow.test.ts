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

afterAll(async () => {
  if (createdNotificationIds.length) {
    await db.delete(notificationsTable)
      .where(inArray(notificationsTable.id, createdNotificationIds));
  }
});

describe("notification workflow", () => {
  let notificationId: number;

  it("POST /api/notifications creates a notification and returns 201", async () => {
    const res = await request(app)
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
    const created = await request(app)
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
