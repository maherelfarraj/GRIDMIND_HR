/**
 * Report-schedule creation payload test.
 *
 * Guards the exact failure class of the Input-schema drift work: the
 * create handler inserts the request body wholesale, so every field the
 * web "New Schedule" dialog sends must be a real column — otherwise what
 * the user typed is silently dropped. This test POSTs the full dialog
 * payload and asserts each field round-trips through the database.
 *
 * Fixtures are self-cleaning (see api-testing conventions).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, reportDefinitionsTable, reportSchedulesTable } from "@workspace/db";
import type { Express } from "express";

const SUFFIX = Date.now();
let app: Express;
let defId: number;
const scheduleIds: number[] = [];

beforeAll(async () => {
  vi.stubEnv("PILOT_AUTH", "false"); // dev-only bypass; payload shape is what's under test
  vi.resetModules();
  app = (await import("../app")).default;
  const [def] = await db
    .insert(reportDefinitionsTable)
    .values({
      code: `sched-payload-${SUFFIX}`,
      nameEn: `Schedule Payload Test ${SUFFIX}`,
      nameAr: `اختبار جدولة ${SUFFIX}`,
      reportType: "attendance",
      querySpecJson: JSON.stringify({ source: "attendance", columns: ["employeeId"] }),
    } as typeof reportDefinitionsTable.$inferInsert)
    .returning();
  defId = def.id;
});

afterAll(async () => {
  if (scheduleIds.length) {
    await db.delete(reportSchedulesTable).where(inArray(reportSchedulesTable.id, scheduleIds));
  }
  await db.delete(reportDefinitionsTable).where(eq(reportDefinitionsTable.id, defId));
  vi.unstubAllEnvs();
});

describe("report schedule creation payload", () => {
  it("persists every field the New Schedule dialog sends — nothing silently dropped", async () => {
    // Mirror of the web dialog's payload (artifacts/hrms NewScheduleDialog).
    const payload = {
      reportDefinitionId: defId,
      nameEn: `Monthly attendance ${SUFFIX}`,
      frequency: "weekly",
      dayOfMonth: null,
      // Non-null numeric weekday (0=Sunday … 6=Saturday) — matches the web
      // dialog's numeric option values; must persist as a number, not null.
      dayOfWeek: 3,
      timeOfDay: "08:00",
      exportFormat: "excel",
      language: "ar",
      isActive: true,
    };
    const res = await request(app).post("/api/report-schedules").send(payload);
    expect(res.status).toBe(201);
    scheduleIds.push(res.body.id);

    const [row] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.id, res.body.id));
    expect(row).toBeTruthy();
    for (const [k, v] of Object.entries(payload)) {
      expect(row[k as keyof typeof row], `field "${k}" must round-trip`).toEqual(v);
    }
  });

  it("PATCH toggling isActive persists", async () => {
    const created = await request(app).post("/api/report-schedules").send({
      reportDefinitionId: defId,
      nameEn: `Toggle test ${SUFFIX}`,
      exportFormat: "pdf",
    });
    expect(created.status).toBe(201);
    scheduleIds.push(created.body.id);
    const patched = await request(app)
      .patch(`/api/report-schedules/${created.body.id}`)
      .send({ isActive: false });
    expect(patched.status).toBe(200);
    const [row] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.id, created.body.id));
    expect(row.isActive).toBe(false);
  });
});
