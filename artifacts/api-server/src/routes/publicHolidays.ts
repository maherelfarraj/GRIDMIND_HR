import { Router, type Request } from "express";
import { db, publicHolidaysTable, systemUsersTable, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveHolidaysForDisplay } from "../lib/holidays";
import { getActorUserId } from "../middleware/requireAuth.js";

const router = Router();

/**
 * Resolve the calling user's holiday sector (employee organizationType).
 * Returns undefined when the user has no linked employee record (e.g. a pure
 * admin account) — such callers see all holidays unfiltered.
 */
async function resolveCallerSector(req: Request): Promise<string | undefined> {
  const userId = getActorUserId(req);
  const [user] = await db.select({ employeeId: systemUsersTable.employeeId })
    .from(systemUsersTable).where(eq(systemUsersTable.id, userId));
  if (!user?.employeeId) return undefined;
  const [emp] = await db.select({ organizationType: employeesTable.organizationType })
    .from(employeesTable).where(eq(employeesTable.id, user.employeeId));
  if (!emp) return undefined;
  return emp.organizationType ?? "commercial";
}

// GET /public-holidays?year=&applicableTo=&scope=
//
// - `year`: resolves holidays for that display year — recurring holidays
//   (stored under any year) appear remapped to the requested year; one-off
//   holidays appear only in their stored year.
// - `applicableTo`: exact sector filter for admin/config views (matches the
//   stored value only, e.g. "all" or "military").
// - `scope=mine`: filters to holidays applicable to the calling user's
//   employee sector ("all" always included). Users without an employee
//   record see everything.
router.get("/public-holidays", async (req, res): Promise<void> => {
  const { year, applicableTo, scope } = req.query as Record<string, string>;

  let rows = await db.select().from(publicHolidaysTable).orderBy(publicHolidaysTable.date);
  if (applicableTo) rows = rows.filter(h => (h.applicableTo ?? "all") === applicableTo);

  const sector = scope === "mine" ? await resolveCallerSector(req) : undefined;

  const holidays = resolveHolidaysForDisplay(rows, {
    year: year ? parseInt(year, 10) : undefined,
    sector,
  });
  res.json(holidays);
});

router.post("/public-holidays", async (req, res): Promise<void> => {
  const { nameEn, nameAr, date, year, isRecurring, applicableTo, notes } = req.body;
  if (!nameEn || !nameAr || !date || !year) {
    res.status(400).json({ error: "nameEn, nameAr, date, year are required" });
    return;
  }
  const [h] = await db.insert(publicHolidaysTable).values({
    nameEn, nameAr, date, year,
    isRecurring: isRecurring ?? false,
    applicableTo: applicableTo ?? "all",
    notes: notes ?? null,
  }).returning();
  res.status(201).json(h);
});

router.patch("/public-holidays/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { nameEn, nameAr, date, year, isRecurring, applicableTo, notes } = req.body;
  const [h] = await db.update(publicHolidaysTable)
    .set({ nameEn, nameAr, date, year, isRecurring, applicableTo, notes })
    .where(eq(publicHolidaysTable.id, id))
    .returning();
  if (!h) { res.status(404).json({ error: "Not found" }); return; }
  res.json(h);
});

router.delete("/public-holidays/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, id));
  res.status(204).end();
});

export default router;
