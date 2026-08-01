/**
 * Holiday sector & recurrence visibility outside payroll (Task: show the
 * right holidays to each employee everywhere).
 *
 * - GET /public-holidays?scope=mine filters by the caller's employee
 *   organizationType ("all" always included).
 * - GET /public-holidays?year=YYYY remaps recurring holidays into the
 *   requested year, whatever year they were stored under.
 * - The shared helper mirrors payroll's buildHolidaySet semantics.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, publicHolidaysTable, employeesTable, systemUsersTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import {
  buildHolidaySet,
  resolveHolidaysForDisplay,
  holidayAppliesToSector,
} from "../lib/holidays";

const createdHolidayIds: number[] = [];

async function insertHoliday(v: {
  nameEn: string; date: string; year: number;
  isRecurring?: boolean; applicableTo?: string;
}) {
  const [h] = await db.insert(publicHolidaysTable).values({
    nameEn: v.nameEn,
    nameAr: v.nameEn,
    date: v.date,
    year: v.year,
    isRecurring: v.isRecurring ?? false,
    applicableTo: v.applicableTo ?? "all",
  }).returning();
  createdHolidayIds.push(h.id);
  return h;
}

beforeAll(async () => {
  await insertHoliday({ nameEn: "TESTVIS All Fixed", date: "2026-03-05", year: 2026 });
  await insertHoliday({ nameEn: "TESTVIS Military Only", date: "2026-04-10", year: 2026, applicableTo: "military" });
  await insertHoliday({ nameEn: "TESTVIS Recurring Natl", date: "2020-09-23", year: 2020, isRecurring: true });
  await insertHoliday({ nameEn: "TESTVIS Gov Recurring", date: "2021-02-22", year: 2021, isRecurring: true, applicableTo: "government" });
});

afterAll(async () => {
  if (createdHolidayIds.length) {
    await db.delete(publicHolidaysTable).where(inArray(publicHolidaysTable.id, createdHolidayIds));
  }
});

type ApiHoliday = { nameEn: string; date: string; year: number };

async function listHolidays(qs: string): Promise<ApiHoliday[]> {
  const res = await request(app).get(`/api/public-holidays${qs}`);
  expect(res.status).toBe(200);
  return res.body as ApiHoliday[];
}

const mine = (hs: ApiHoliday[]) => hs.filter(h => h.nameEn.startsWith("TESTVIS"));

describe("shared holiday helper", () => {
  it("sector applicability treats 'all' and null as universal", () => {
    expect(holidayAppliesToSector(null, "commercial")).toBe(true);
    expect(holidayAppliesToSector("all", "military")).toBe(true);
    expect(holidayAppliesToSector("military", "military")).toBe(true);
    expect(holidayAppliesToSector("military", "commercial")).toBe(false);
  });

  it("buildHolidaySet expands recurring rows and filters sector like payroll", () => {
    const rows = [
      { date: "2020-09-23", isRecurring: true, applicableTo: "all" },
      { date: "2026-04-10", isRecurring: false, applicableTo: "military" },
      { date: "2025-01-01", isRecurring: false, applicableTo: "all" }, // out of window
    ];
    const set = buildHolidaySet(rows, 2026, 2027, "commercial");
    expect(set).toEqual(new Set(["2026-09-23", "2027-09-23"]));
    const mil = buildHolidaySet(rows, 2026, 2026, "military");
    expect(mil).toEqual(new Set(["2026-09-23", "2026-04-10"]));
  });

  it("resolveHolidaysForDisplay remaps recurring rows into the display year", () => {
    const rows = [
      { date: "2020-09-23", year: 2020, isRecurring: true, applicableTo: "all" },
      { date: "2026-03-05", year: 2026, isRecurring: false, applicableTo: "all" },
    ];
    const out = resolveHolidaysForDisplay(rows, { year: 2027 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: "2027-09-23", year: 2027 });
  });
});

describe("GET /public-holidays", () => {
  it("year filter shows recurring holidays in any displayed year", async () => {
    const hs = mine(await listHolidays("?year=2027"));
    const names = hs.map(h => h.nameEn).sort();
    expect(names).toEqual(["TESTVIS Gov Recurring", "TESTVIS Recurring Natl"]);
    for (const h of hs) {
      expect(h.year).toBe(2027);
      expect(h.date.startsWith("2027-")).toBe(true);
    }
  });

  it("year filter keeps one-off holidays only in their stored year", async () => {
    const hs = mine(await listHolidays("?year=2026"));
    const names = hs.map(h => h.nameEn).sort();
    expect(names).toEqual([
      "TESTVIS All Fixed",
      "TESTVIS Gov Recurring",
      "TESTVIS Military Only",
      "TESTVIS Recurring Natl",
    ]);
  });

  it("scope=mine filters by the caller's employee sector", async () => {
    // Demo actor is user id 1; look up their employee sector to assert exactly.
    const [user] = await db.select({ employeeId: systemUsersTable.employeeId })
      .from(systemUsersTable).where(eq(systemUsersTable.id, 1));
    let sector: string | undefined;
    if (user?.employeeId) {
      const [emp] = await db.select({ organizationType: employeesTable.organizationType })
        .from(employeesTable).where(eq(employeesTable.id, user.employeeId));
      sector = emp?.organizationType ?? "commercial";
    }

    const hs = mine(await listHolidays("?year=2026&scope=mine"));
    const names = hs.map(h => h.nameEn);
    // "all" holidays always visible
    expect(names).toContain("TESTVIS All Fixed");
    expect(names).toContain("TESTVIS Recurring Natl");
    if (sector) {
      expect(names.includes("TESTVIS Military Only")).toBe(sector === "military");
      expect(names.includes("TESTVIS Gov Recurring")).toBe(sector === "government");
    } else {
      // No linked employee record → unfiltered
      expect(names).toContain("TESTVIS Military Only");
    }
  });

  it("without year, stored rows are returned as-is", async () => {
    const hs = mine(await listHolidays(""));
    const recurring = hs.find(h => h.nameEn === "TESTVIS Recurring Natl");
    expect(recurring).toMatchObject({ date: "2020-09-23", year: 2020 });
  });
});
