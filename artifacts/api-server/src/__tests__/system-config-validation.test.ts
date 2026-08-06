/**
 * PATCH /api/system-config value validation.
 *
 * The route must validate incoming values against each row's valueType
 * (number → finite, positive where the key requires it; boolean → true/false;
 * json → parseable) and reject the whole request with 400 + per-key errors
 * instead of persisting bad values. Covers the overtime cap
 * ("payroll.maxOtSessionHours") documented in src/lib/otCap.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, systemConfigTable } from "@workspace/db";
import app from "../app";

const OT_KEY = "payroll.maxOtSessionHours";
const WEEKEND_KEY = "payroll.weekendDays";
const BOOL_KEY = "security.dual_auth_enabled";
const ORG_TYPE_KEY = "org.type";
const SEC_LEVEL_KEY = "security.level";

let originalValues: Record<string, string> = {};
const createdKeys: string[] = [];

async function getValue(key: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, key));
  return row?.value;
}

beforeAll(async () => {
  // The OT cap row may not exist in every environment; create it as a
  // fixture if missing (matching the seed definition) and delete it after.
  if ((await getValue(OT_KEY)) === undefined) {
    await db.insert(systemConfigTable).values({
      key: OT_KEY,
      value: "12",
      valueType: "number",
      category: "payroll",
      labelEn: "Max Overtime Session (hours)",
      labelAr: "الحد الأقصى لجلسة العمل الإضافي (ساعات)",
      isPublic: true,
      isReadonly: false,
    });
    createdKeys.push(OT_KEY);
  }
  for (const key of [OT_KEY, WEEKEND_KEY, BOOL_KEY, ORG_TYPE_KEY, SEC_LEVEL_KEY]) {
    const value = await getValue(key);
    expect(value, `config row ${key} must exist`).toBeDefined();
    originalValues[key] = value!;
  }
});

afterAll(async () => {
  // Delete fixture rows we created; restore original values for the rest.
  for (const [key, value] of Object.entries(originalValues)) {
    if (createdKeys.includes(key)) {
      await db.delete(systemConfigTable).where(eq(systemConfigTable.key, key));
    } else {
      await db
        .update(systemConfigTable)
        .set({ value })
        .where(eq(systemConfigTable.key, key));
    }
  }
});

describe("PATCH /api/system-config validation", () => {
  it("rejects a non-numeric overtime cap and saves nothing", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [OT_KEY]: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.details[OT_KEY]).toMatch(/finite number/);
    expect(await getValue(OT_KEY)).toBe(originalValues[OT_KEY]);
  });

  it("rejects a negative overtime cap", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [OT_KEY]: "-5" });
    expect(res.status).toBe(400);
    expect(res.body.details[OT_KEY]).toMatch(/positive/);
    expect(await getValue(OT_KEY)).toBe(originalValues[OT_KEY]);
  });

  it("rejects a zero overtime cap", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [OT_KEY]: "0" });
    expect(res.status).toBe(400);
    expect(await getValue(OT_KEY)).toBe(originalValues[OT_KEY]);
  });

  it("accepts a valid overtime cap", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [OT_KEY]: "10" });
    expect(res.status).toBe(200);
    expect(await getValue(OT_KEY)).toBe("10");
  });

  it("rejects unparseable JSON for weekend days", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [WEEKEND_KEY]: "not-json" });
    expect(res.status).toBe(400);
    expect(res.body.details[WEEKEND_KEY]).toMatch(/JSON/);
    expect(await getValue(WEEKEND_KEY)).toBe(originalValues[WEEKEND_KEY]);
  });

  it("rejects non-boolean values for boolean settings", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [BOOL_KEY]: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.details[BOOL_KEY]).toMatch(/true.*false/);
    expect(await getValue(BOOL_KEY)).toBe(originalValues[BOOL_KEY]);
  });

  it("saves nothing when one key of a batch is invalid", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [OT_KEY]: "8", [BOOL_KEY]: "maybe" });
    expect(res.status).toBe(400);
    expect(res.body.details[BOOL_KEY]).toBeDefined();
    // Valid key in the same request must not have been persisted.
    expect(await getValue(OT_KEY)).not.toBe("8");
  });

  // ── Enum-style string settings ────────────────────────────────────────────

  it("rejects an unknown org.type value", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [ORG_TYPE_KEY]: "banana" });
    expect(res.status).toBe(400);
    expect(res.body.details[ORG_TYPE_KEY]).toMatch(/must be one of/);
    expect(await getValue(ORG_TYPE_KEY)).toBe(originalValues[ORG_TYPE_KEY]);
  });

  it("accepts a valid org.type value", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [ORG_TYPE_KEY]: "government" });
    expect(res.status).toBe(200);
    expect(await getValue(ORG_TYPE_KEY)).toBe("government");
  });

  it("rejects an unknown security.level value", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [SEC_LEVEL_KEY]: "ultra_classified" });
    expect(res.status).toBe(400);
    expect(res.body.details[SEC_LEVEL_KEY]).toMatch(/must be one of/);
    expect(await getValue(SEC_LEVEL_KEY)).toBe(originalValues[SEC_LEVEL_KEY]);
  });

  it("accepts a valid security.level value", async () => {
    const res = await request(app)
      .patch("/api/system-config")
      .send({ [SEC_LEVEL_KEY]: "top_secret" });
    expect(res.status).toBe(200);
    expect(await getValue(SEC_LEVEL_KEY)).toBe("top_secret");
  });
});
