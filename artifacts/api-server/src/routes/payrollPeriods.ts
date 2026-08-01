import { Router } from "express";
import {
  db, payrollPeriodsTable, payrollRunsTable, payrollRunLinesTable,
  employeesTable, salaryGradesTable, payComponentsTable, auditLogsTable,
  overtimeRulesTable, punchEventsTable, leaveRequestsTable, leaveTypesTable,
  attendanceRecordsTable, publicHolidaysTable, employmentContractsTable,
  payrollExcusedAbsencesTable, notificationsTable, systemUsersTable, rolesTable,
} from "@workspace/db";
import type { PayrollPeriod, Employee } from "@workspace/db";
import { eq, and, gte, lte, sql, ilike } from "drizzle-orm";
import { getWeekendDays, WEEKEND_CONFIG_KEY } from "../lib/weekend";
import { getMaxOtSessionHours } from "../lib/otCap";
import { getActorUserId } from "../middleware/requireAuth.js";
import { reconcileTerminationStatuses } from "../lib/terminationReconciler.js";

export { WEEKEND_CONFIG_KEY };

/** Count working days (excluding weekends and public holidays) in [start, end] inclusive. */
function countWorkingDays(start: string, end: string, weekendDays: number[], holidays: Set<string> = new Set()): number {
  if (start > end) return 0;
  let count = 0;
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (d <= last) {
    const iso = d.toISOString().slice(0, 10);
    if (!weekendDays.includes(d.getUTCDay()) && !holidays.has(iso)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/** Count working days of a leave request that fall inside [periodStart, periodEnd] inclusive. */
function overlapDays(leaveStart: string, leaveEnd: string, periodStart: string, periodEnd: string, halfDay: boolean, weekendDays: number[], holidays: Set<string> = new Set()): number {
  const start = leaveStart > periodStart ? leaveStart : periodStart;
  const end = leaveEnd < periodEnd ? leaveEnd : periodEnd;
  if (start > end) return 0;
  const days = countWorkingDays(start, end, weekendDays, holidays);
  if (halfDay && days === 1) return 0.5;
  return days;
}

/** True when the date is not one of the configured weekend days. */
function isWorkday(dateStr: string, weekendDays: number[]): boolean {
  return !weekendDays.includes(new Date(dateStr + "T00:00:00Z").getUTCDay());
}

/** All ISO date strings from start to end inclusive. */
function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(end + "T00:00:00Z"); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Build a Set of holiday ISO dates for [startYear, endYear] from publicHolidaysTable rows,
 * filtered to the given sector ("commercial", "military", "government", etc.).
 *
 * Inclusion rules:
 *   applicableTo === "all"          → always included
 *   applicableTo === sectorFilter   → included for this sector
 *   anything else                  → excluded
 *
 * Recurring holidays: `isRecurring = true` means the *month-day* repeats every year.
 * The date may be stored as a full "YYYY-MM-DD" or as "--MM-DD" / "-MM-DD".
 * In all cases `.slice(-6)` reliably yields "-MM-DD" which is then expanded for
 * every year in [startYear, endYear].
 *
 * Non-recurring holidays are included as-is (only if the date falls in range).
 */
function buildHolidaySet(
  rows: { date: string; isRecurring: boolean | null; applicableTo: string | null }[],
  startYear: number,
  endYear: number,
  sectorFilter: string,
): Set<string> {
  const set = new Set<string>();
  const periodStart = `${startYear}-01-01`;
  const periodEnd   = `${endYear}-12-31`;
  for (const h of rows) {
    const applicable = h.applicableTo ?? "all";
    if (applicable !== "all" && applicable !== sectorFilter) continue;

    if (h.isRecurring) {
      // Extract "-MM-DD" regardless of how the date was stored
      const monthDay = h.date.slice(-6); // e.g. "2050-02-18" → "-02-18"
      for (let y = startYear; y <= endYear; y++) {
        set.add(`${y}${monthDay}`);
      }
    } else {
      // Non-recurring: only include if within the year window
      if (h.date >= periodStart && h.date <= periodEnd) {
        set.add(h.date);
      }
    }
  }
  return set;
}
type ApprovedLeave = { employeeId: number; startDate: string; endDate: string; halfDay: boolean | null; category: string };
type PunchEventLite = { employeeId: number; eventTime: Date };
type AttendanceLite = { employeeId: number; date: string; status: string };
type HolidayRow = { date: string; isRecurring: boolean | null; applicableTo: string | null };

/** Load the punch/attendance/leave data needed for no-show detection in a period. */
async function loadNoShowInputs(period: PayrollPeriod) {
  const punchEvents = await db.select().from(punchEventsTable)
    .where(and(
      gte(punchEventsTable.eventTime, new Date(period.startDate)),
      lte(punchEventsTable.eventTime, new Date(period.endDate + "T23:59:59Z")),
    ));
  const attendanceRecords = await db.select().from(attendanceRecordsTable)
    .where(and(
      gte(attendanceRecordsTable.date, period.startDate),
      lte(attendanceRecordsTable.date, period.endDate),
    ));
  const approvedLeaves: ApprovedLeave[] = await db.select({
    employeeId: leaveRequestsTable.employeeId,
    startDate: leaveRequestsTable.startDate,
    endDate: leaveRequestsTable.endDate,
    halfDay: leaveRequestsTable.halfDay,
    category: leaveTypesTable.category,
  })
    .from(leaveRequestsTable)
    .innerJoin(leaveTypesTable, eq(leaveRequestsTable.leaveTypeId, leaveTypesTable.id))
    .where(and(
      eq(leaveRequestsTable.status, "approved"),
      lte(leaveRequestsTable.startDate, period.endDate),
      gte(leaveRequestsTable.endDate, period.startDate),
    ));
  return { punchEvents, attendanceRecords, approvedLeaves };
}

/**
 * Workdays in [period.startDate, min(period.endDate, today)] eligible for
 * no-show checks — weekends and holidays excluded, never future days.
 */
function eligibleNoShowWorkdays(period: PayrollPeriod, weekendDays: number[], holidays: Set<string>): string[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const noShowEnd = period.endDate < todayStr ? period.endDate : todayStr;
  return period.startDate <= noShowEnd
    ? datesInRange(period.startDate, noShowEnd).filter(d => isWorkday(d, weekendDays) && !holidays.has(d))
    : [];
}

/**
 * Detected no-show dates for one employee: eligible workdays on/after hire date
 * with no punch activity, no attendance record showing presence, and no
 * approved leave (any category) covering the day.
 */
function computeNoShowDates(
  emp: Pick<Employee, "id" | "hireDate">,
  eligibleWorkdays: string[],
  punchEvents: PunchEventLite[],
  attendanceRecords: AttendanceLite[],
  approvedLeaves: ApprovedLeave[],
  period: PayrollPeriod,
): string[] {
  const attendedDates = new Set<string>();
  for (const e of punchEvents) {
    if (e.employeeId === emp.id) attendedDates.add(e.eventTime.toISOString().slice(0, 10));
  }
  for (const a of attendanceRecords) {
    if (a.employeeId === emp.id && a.status !== "absent") attendedDates.add(a.date);
  }
  const leaveCoveredDates = new Set<string>();
  for (const l of approvedLeaves) {
    if (l.employeeId !== emp.id) continue;
    const s = l.startDate > period.startDate ? l.startDate : period.startDate;
    const e = l.endDate < period.endDate ? l.endDate : period.endDate;
    if (s <= e) for (const d of datesInRange(s, e)) leaveCoveredDates.add(d);
  }
  return eligibleWorkdays.filter(d =>
    d >= emp.hireDate && !attendedDates.has(d) && !leaveCoveredDates.has(d)
  );
}

/** Fetch all holiday rows once for use with buildHolidaySet. */
async function loadHolidayRows(): Promise<HolidayRow[]> {
  return db.select({
    date: publicHolidaysTable.date,
    isRecurring: publicHolidaysTable.isRecurring,
    applicableTo: publicHolidaysTable.applicableTo,
  }).from(publicHolidaysTable);
}

// Notification type used to warn employees/managers about detected unexcused
// no-show days before pay is docked.
const NO_SHOW_NOTIFICATION_TYPE = "payroll_no_show";

/**
 * Notify an employee (and their manager, when one is mapped to a system user)
 * about unexcused no-show days detected during payroll calculation, so they
 * can dispute them before the period is approved and closed.
 *
 * Duplicate-safe across recalculations: existing payroll_no_show notifications
 * for the same period + recipient are scanned for the dates already announced
 * for this employee (bodies embed a stable `[employeeNumber]` marker plus the
 * ISO dates), and a new notification is only created for dates not yet
 * notified to that recipient.
 */
async function notifyUnexcusedNoShows(
  period: PayrollPeriod,
  emp: Pick<Employee, "id" | "employeeNumber" | "firstNameEn" | "lastNameEn" | "firstNameAr" | "lastNameAr" | "managerId">,
  unexcusedDates: string[],
  userIdByEmployeeId: Map<number, number>,
): Promise<void> {
  if (unexcusedDates.length === 0) return;

  const empUserId = userIdByEmployeeId.get(emp.id) ?? null;
  const managerUserId = emp.managerId != null ? (userIdByEmployeeId.get(emp.managerId) ?? null) : null;

  const marker = `[${emp.employeeNumber}]`;
  const nameEn = `${emp.firstNameEn} ${emp.lastNameEn}`;
  const nameAr = `${emp.firstNameAr} ${emp.lastNameAr}`;

  const recipients: { userId: number; isManager: boolean }[] = [];
  if (empUserId != null) recipients.push({ userId: empUserId, isManager: false });
  if (managerUserId != null && managerUserId !== empUserId) recipients.push({ userId: managerUserId, isManager: true });

  for (const r of recipients) {
    const existing = await db.select({ bodyEn: notificationsTable.bodyEn }).from(notificationsTable)
      .where(and(
        eq(notificationsTable.recipientUserId, r.userId),
        eq(notificationsTable.notificationType, NO_SHOW_NOTIFICATION_TYPE),
        eq(notificationsTable.entityType, "payroll_period"),
        eq(notificationsTable.entityId, period.id),
      ));
    const alreadyNotified = new Set<string>();
    for (const row of existing) {
      if (!row.bodyEn.includes(marker)) continue;
      for (const m of row.bodyEn.match(/\d{4}-\d{2}-\d{2}/g) ?? []) alreadyNotified.add(m);
    }
    const newDates = unexcusedDates.filter(d => !alreadyNotified.has(d));
    if (newDates.length === 0) continue;

    const dateList = newDates.join(", ");
    const bodyEn = r.isManager
      ? `Unexcused no-show day(s) detected for ${nameEn} ${marker} in payroll period ${period.nameEn}: ${dateList}. Pay will be deducted unless HR excuses these days before the period is approved and closed.`
      : `Unexcused no-show day(s) ${marker} were detected for you in payroll period ${period.nameEn}: ${dateList}. Pay will be deducted for these days unless HR excuses them before the period is approved and closed. Contact HR if you believe this is incorrect.`;
    const bodyAr = r.isManager
      ? `تم رصد أيام غياب بدون عذر للموظف ${nameAr} ${marker} في فترة الرواتب ${period.nameAr}: ${dateList}. سيتم خصم الأجر ما لم تعذرها الموارد البشرية قبل اعتماد الفترة وإغلاقها.`
      : `تم رصد أيام غياب بدون عذر ${marker} لك في فترة الرواتب ${period.nameAr}: ${dateList}. سيتم خصم الأجر عن هذه الأيام ما لم تعذرها الموارد البشرية قبل اعتماد الفترة وإغلاقها. يرجى التواصل مع الموارد البشرية إذا كان ذلك غير صحيح.`;

    await db.insert(notificationsTable).values({
      recipientUserId: r.userId,
      recipientEmployeeId: r.isManager ? emp.managerId : emp.id,
      notificationType: NO_SHOW_NOTIFICATION_TYPE,
      titleEn: r.isManager
        ? `No-show days detected for ${nameEn} — pay deduction pending`
        : "No-show days detected — pay deduction pending",
      titleAr: r.isManager
        ? `تم رصد أيام غياب للموظف ${nameAr} — خصم أجر معلق`
        : "تم رصد أيام غياب — خصم أجر معلق",
      bodyEn,
      bodyAr,
      severity: "warning",
      actionUrl: "/payroll",
      actionLabelEn: "Review payroll period",
      entityType: "payroll_period",
      entityId: period.id,
      requiresAction: true,
    });
  }
}

// Notification type for the HR/admin digest raised when calculation detects
// new unexcused no-show days. HR is the only role that can excuse a day, so
// they get one digest per calculation (per period) listing affected employees.
const NO_SHOW_HR_DIGEST_TYPE = "payroll_no_show_hr_digest";

/**
 * Notify HR/admin users with a single digest per period listing employees with
 * newly detected unexcused no-show days, so HR can excuse them before the
 * period is approved and closed.
 *
 * Recipients are active system users whose role name contains "admin"
 * (HR Administrator, System Administrator, ...) — the same fanout convention
 * as gateway device alerts.
 *
 * Duplicate-safe across recalculations, using the same convention as the
 * employee/manager warnings: existing digest notifications for the same
 * period + recipient embed stable `[employeeNumber] ... dates` segments, and a
 * new digest only includes (employee, date) pairs not yet announced to that
 * recipient. A recalculation that finds nothing new inserts nothing.
 *
 * Concurrency-safe: the read-check-insert for each recipient runs inside a
 * transaction holding a pg advisory xact lock keyed on (recipient, period),
 * so two overlapping recalculations cannot both observe "no digest yet" and
 * double-insert.
 */

/**
 * Extract already-announced `employeeNumber|date` pairs from a digest body.
 * Each `[EMP-NO]` marker owns exactly the text up to the next `[` (or end of
 * string), so dates listed for one employee are never attributed to another.
 * Exported for tests.
 */
export function parseAnnouncedNoShowPairs(bodyEn: string, into: Set<string>): void {
  for (const m of bodyEn.matchAll(/\[([^\]]+)\]([^\[]*)/g)) {
    const empNo = m[1];
    for (const d of m[2].match(/\d{4}-\d{2}-\d{2}/g) ?? []) into.add(`${empNo}|${d}`);
  }
}

async function notifyHrNoShowDigest(
  period: PayrollPeriod,
  alerts: { emp: Pick<Employee, "id" | "employeeNumber" | "firstNameEn" | "lastNameEn" | "firstNameAr" | "lastNameAr">; dates: string[] }[],
): Promise<void> {
  if (alerts.length === 0) return;

  const hrUsers = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .innerJoin(rolesTable, eq(systemUsersTable.roleId, rolesTable.id))
    .where(and(eq(systemUsersTable.isActive, true), ilike(rolesTable.nameEn, "%admin%")));
  if (hrUsers.length === 0) return;

  for (const u of hrUsers) {
    await db.transaction(async (tx) => {
      // Serialize concurrent recalculations for this (recipient, period):
      // without this, two overlapping calculate calls could both read "no
      // digest yet" and insert duplicates.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payroll_no_show_hr_digest:${u.id}:${period.id}`}))`);

      const existing = await tx.select({ bodyEn: notificationsTable.bodyEn }).from(notificationsTable)
        .where(and(
          eq(notificationsTable.recipientUserId, u.id),
          eq(notificationsTable.notificationType, NO_SHOW_HR_DIGEST_TYPE),
          eq(notificationsTable.entityType, "payroll_period"),
          eq(notificationsTable.entityId, period.id),
        ));

      // Already-announced (employee, date) pairs for this recipient.
      const announced = new Set<string>();
      for (const row of existing) parseAnnouncedNoShowPairs(row.bodyEn, announced);

      const newEntries: { emp: (typeof alerts)[number]["emp"]; dates: string[] }[] = [];
      for (const a of alerts) {
        const newDates = a.dates.filter(d => !announced.has(`${a.emp.employeeNumber}|${d}`));
        if (newDates.length > 0) newEntries.push({ emp: a.emp, dates: newDates });
      }
      if (newEntries.length === 0) return;

      const listEn = newEntries
        .map(e => `[${e.emp.employeeNumber}] ${e.emp.firstNameEn} ${e.emp.lastNameEn}: ${e.dates.join(", ")}`)
        .join("; ");
      const listAr = newEntries
        .map(e => `[${e.emp.employeeNumber}] ${e.emp.firstNameAr} ${e.emp.lastNameAr}: ${e.dates.join(", ")}`)
        .join("؛ ");
      const empCount = newEntries.length;

      await tx.insert(notificationsTable).values({
        recipientUserId: u.id,
        notificationType: NO_SHOW_HR_DIGEST_TYPE,
        titleEn: `Unexcused no-show days detected in ${period.nameEn} — ${empCount} employee(s) need review`,
        titleAr: `تم رصد أيام غياب بدون عذر في ${period.nameAr} — ${empCount} موظف بحاجة للمراجعة`,
        bodyEn: `Payroll calculation for ${period.nameEn} detected unexcused no-show day(s) for: ${listEn}. Pay will be deducted for these days unless they are excused before the period is approved and closed.`,
        bodyAr: `رصدت عملية احتساب الرواتب لفترة ${period.nameAr} أيام غياب بدون عذر للموظفين: ${listAr}. سيتم خصم الأجر عن هذه الأيام ما لم يتم عذرها قبل اعتماد الفترة وإغلاقها.`,
        severity: "warning",
        actionUrl: "/payroll",
        actionLabelEn: "Review no-show days",
        entityType: "payroll_period",
        entityId: period.id,
        requiresAction: true,
      });
    });
  }
}

// Fallback duration (hours) for an overtime session whose OVERTIME_START punch
// has no matching OVERTIME_END punch — the historical per-session approximation.
const DEFAULT_OT_SESSION_HOURS = 2;

// The sanity cap (hours) for a single paired overtime session is an
// admin-editable setting ("payroll.maxOtSessionHours" in system_config,
// falling back to the MAX_OT_SESSION_HOURS env var, then 12h) read at
// calculation time via getMaxOtSessionHours() — see ../lib/otCap.ts.

const router = Router();

// GET /payroll-periods?status=&year=
router.get("/payroll-periods", async (req, res): Promise<void> => {
  const { status, year } = req.query as Record<string, string>;
  let rows = await db.select().from(payrollPeriodsTable).orderBy(payrollPeriodsTable.startDate);
  if (status) rows = rows.filter(r => r.status === status);
  if (year) rows = rows.filter(r => r.startDate.startsWith(year));
  res.json(rows);
});

// POST /payroll-periods — create a new payroll period
router.post("/payroll-periods", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const { periodCode, nameEn, nameAr, periodType, startDate, endDate, payDate, currency, notes } = req.body;
  if (!periodCode || !nameEn || !nameAr || !startDate || !endDate || !payDate) {
    res.status(400).json({ error: "periodCode, nameEn, nameAr, startDate, endDate, payDate required" });
    return;
  }
  const [p] = await db.insert(payrollPeriodsTable).values({
    periodCode, nameEn, nameAr,
    periodType: periodType ?? "monthly",
    startDate, endDate, payDate,
    currency: currency ?? "SAR",
    notes: notes ?? null,
    status: "draft",
  }).returning();
  await db.insert(auditLogsTable).values({
    action: "payroll_period.created",
    entityType: "payroll_period",
    entityId: p.id,
    entityLabel: p.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ periodCode, startDate, endDate }),
  });
  res.status(201).json(p);
});

// GET /payroll-periods/:id
router.get("/payroll-periods/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [p] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  res.json(p);
});

// GET /payroll-periods/:id/ot-summary — overtime pay aggregated by weekday/weekend/holiday buckets
router.get("/payroll-periods/:id/ot-summary", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [p] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db
    .select({
      codeEn: payrollRunLinesTable.codeEn,
      total: sql<string>`coalesce(sum(${payrollRunLinesTable.amount}), 0)`,
    })
    .from(payrollRunLinesTable)
    .innerJoin(payrollRunsTable, eq(payrollRunLinesTable.payrollRunId, payrollRunsTable.id))
    .where(and(
      eq(payrollRunsTable.payrollPeriodId, id),
      sql`${payrollRunLinesTable.codeEn} in ('OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY')`,
    ))
    .groupBy(payrollRunLinesTable.codeEn);

  const byCode = Object.fromEntries(rows.map(r => [r.codeEn, parseFloat(r.total)]));
  const weekday = byCode["OT_WEEKDAY"] ?? 0;
  const weekend = byCode["OT_WEEKEND"] ?? 0;
  const holiday = byCode["OT_HOLIDAY"] ?? 0;
  res.json({
    weekday: weekday.toFixed(2),
    weekend: weekend.toFixed(2),
    holiday: holiday.toFixed(2),
    total: (weekday + weekend + holiday).toFixed(2),
  });
});

// PATCH /payroll-periods/:id — edit draft period metadata
router.patch("/payroll-periods/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, id));
  if (!period) { res.status(404).json({ error: "Not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Cannot edit a closed payroll period" }); return; }
  const { nameEn, nameAr, payDate, notes } = req.body;
  const [updated] = await db.update(payrollPeriodsTable)
    .set({ nameEn, nameAr, payDate, notes, updatedAt: new Date() })
    .where(eq(payrollPeriodsTable.id, id))
    .returning();
  res.json(updated);
});

// POST /payroll-periods/:id/calculate — generate/recalculate all payroll runs for the period
router.post("/payroll-periods/:id/calculate", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const periodId = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period is closed and cannot be recalculated" }); return; }

  const summary = await recalculatePeriodRuns(period, actorUserId);
  res.json(summary);
});

// Shared payroll run (re)calculation. Used by the calculate endpoint above and
// invoked automatically when an excusal changes on a period that already has
// runs, so totals never go stale. Callers must ensure the period is not closed.
async function recalculatePeriodRuns(
  period: typeof payrollPeriodsTable.$inferSelect,
  actorUserId: number,
) {
  const periodId = period.id;

  // Flip any active employee whose last working day has passed to terminated
  // before selecting, so future-dated offboardings converge without a scheduler.
  await reconcileTerminationStatuses();

  // Active employees, plus leavers whose explicit last working day falls on or
  // after the period start — a terminated employee must still be paid for the
  // days they worked in this period instead of silently dropping out.
  const allEmployees = await db.select().from(employeesTable);
  const employees = allEmployees.filter(emp =>
    emp.status === "active" ||
    (emp.terminationDate && emp.terminationDate >= period.startDate && emp.hireDate <= period.endDate)
  );
  const grades = await db.select().from(salaryGradesTable);
  const components = await db.select().from(payComponentsTable).where(eq(payComponentsTable.isActive, true));
  const overtimeRules = await db.select().from(overtimeRulesTable).where(eq(overtimeRulesTable.isActive, true));

  // Clear existing runs for this period
  const existingRuns = await db.select().from(payrollRunsTable)
    .where(eq(payrollRunsTable.payrollPeriodId, periodId));
  for (const run of existingRuns) {
    await db.delete(payrollRunLinesTable).where(eq(payrollRunLinesTable.payrollRunId, run.id));
  }
  await db.delete(payrollRunsTable).where(eq(payrollRunsTable.payrollPeriodId, periodId));

  // Punch events for this period (for overtime calculation)
  const punchEvents = await db.select().from(punchEventsTable)
    .where(and(
      gte(punchEventsTable.eventTime, new Date(period.startDate)),
      lte(punchEventsTable.eventTime, new Date(period.endDate + "T23:59:59Z")),
    ));

  // Attendance records for this period (for no-show detection)
  const attendanceRecords = await db.select().from(attendanceRecordsTable)
    .where(and(
      gte(attendanceRecordsTable.date, period.startDate),
      lte(attendanceRecordsTable.date, period.endDate),
    ));

  // Admin-configurable weekend days and overtime session sanity cap
  const weekendDays = await getWeekendDays();
  const maxOtSessionHours = await getMaxOtSessionHours();

  // Public holidays — fetched once, filtered per-employee inside the loop
  const startYear = parseInt(period.startDate.slice(0, 4), 10);
  const endYear = parseInt(period.endDate.slice(0, 4), 10);
  const holidayRows = await db.select({
    date: publicHolidaysTable.date,
    isRecurring: publicHolidaysTable.isRecurring,
    applicableTo: publicHolidaysTable.applicableTo,
  }).from(publicHolidaysTable);

  // Approved leave requests overlapping this period
  const approvedLeaves = await db.select({
    employeeId: leaveRequestsTable.employeeId,
    startDate: leaveRequestsTable.startDate,
    endDate: leaveRequestsTable.endDate,
    halfDay: leaveRequestsTable.halfDay,
    category: leaveTypesTable.category,
  })
    .from(leaveRequestsTable)
    .innerJoin(leaveTypesTable, eq(leaveRequestsTable.leaveTypeId, leaveTypesTable.id))
    .where(and(
      eq(leaveRequestsTable.status, "approved"),
      lte(leaveRequestsTable.startDate, period.endDate),
      gte(leaveRequestsTable.endDate, period.startDate),
    ));

  const todayStr = new Date().toISOString().slice(0, 10);
  const noShowEnd = period.endDate < todayStr ? period.endDate : todayStr;

  const allContracts = await db.select({
    employeeId: employmentContractsTable.employeeId,
    terminationDate: employmentContractsTable.terminationDate,
    status: employmentContractsTable.status,
  })
    .from(employmentContractsTable)
    .where(sql`${employmentContractsTable.employeeId} IS NOT NULL`);
  // HR-excused absence days for this period — skipped by the ABSENCE deduction.
  const excusedRows = await db.select().from(payrollExcusedAbsencesTable)
    .where(eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId));
  const excusedByEmp = new Map<number, Set<string>>();
  for (const ex of excusedRows) {
    if (!excusedByEmp.has(ex.employeeId)) excusedByEmp.set(ex.employeeId, new Set());
    excusedByEmp.get(ex.employeeId)!.add(ex.date);
  }

  // Employment windows (task: prorate mid-period hires/leavers).
  // An employee counts as terminated only if their latest contract state says so:
  // any open active contract (no terminationDate) means they are currently employed,
  // so older terminated contracts (rehires) are ignored.
  const latestTerminationByEmp: Record<number, string> = {};
  const openContractEmps = new Set<number>();
  for (const c of allContracts) {
    if (c.employeeId == null) continue;
    if (!c.terminationDate) {
      if (c.status === "active") openContractEmps.add(c.employeeId);
      continue;
    }
    const existing = latestTerminationByEmp[c.employeeId];
    if (!existing || c.terminationDate > existing) latestTerminationByEmp[c.employeeId] = c.terminationDate;
  }
  const terminationByEmp: Record<number, string> = {};
  for (const [empIdStr, term] of Object.entries(latestTerminationByEmp)) {
    const empIdNum = Number(empIdStr);
    if (!openContractEmps.has(empIdNum)) terminationByEmp[empIdNum] = term;
  }

  const gradeMap = Object.fromEntries(grades.map(g => [g.gradeCode, g]));
  let totalGross = 0, totalDeductions = 0, totalNet = 0, exceptionCount = 0;
  const runs = [];
  // Employees with unexcused no-show days — notified after the run loop so
  // repeated recalculations stay duplicate-free (see notifyUnexcusedNoShows).
  const noShowAlerts: { emp: Employee; dates: string[] }[] = [];

  for (const emp of employees) {
    // Per-employee holiday set filtered to their sector
    const empSector = emp.organizationType ?? "commercial";
    const empHolidaySet = buildHolidaySet(holidayRows, startYear, endYear, empSector);

    // Real working days in the period for this employee's sector
    const periodWorkingDays = countWorkingDays(period.startDate, period.endDate, weekendDays, empHolidaySet);

    // Workdays eligible for no-show checks (non-weekend, non-holiday, not future)
    const eligibleWorkdays = period.startDate <= noShowEnd
      ? datesInRange(period.startDate, noShowEnd).filter(d => isWorkday(d, weekendDays) && !empHolidaySet.has(d))
      : [];

    // Employment window inside the period: from hire date to the relevant
    // termination (if any). Days outside this window are neither paid nor
    // counted as absences.
    const employStart = emp.hireDate > period.startDate ? emp.hireDate : period.startDate;
    // Prefer the explicit last working day set on the employee record;
    // fall back to the contract-derived termination date.
    const empTermination = emp.terminationDate ?? terminationByEmp[emp.id] ?? null;
    const employEnd = empTermination && empTermination < period.endDate ? empTermination : period.endDate;
    const grade = emp.grade ? gradeMap[emp.grade] : null;
    const baseSalary = grade ? parseFloat(grade.baseSalary) : 5000; // fallback base

    // Overtime: pair each OVERTIME_START punch with the next OVERTIME_END punch
    // for the same employee and pay the actual duration, bucketed by day type
    // so each bucket is paid at its own multiplier (weekday / weekend / holiday).
    // Sessions with no matching end punch fall back to DEFAULT_OT_SESSION_HOURS.
    const empOtStarts = punchEvents
      .filter(e => e.employeeId === emp.id && e.eventType === "OVERTIME_START")
      .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
    const empOtEnds = punchEvents
      .filter(e => e.employeeId === emp.id && e.eventType === "OVERTIME_END")
      .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
    let weekdayOtHours = 0, weekendOtHours = 0, holidayOtHours = 0;
    // Sessions whose raw paired duration exceeded the sanity cap; their pay is
    // clamped to the admin-configured cap and the run is flagged for review.
    const cappedOtSessions: { date: string; rawHours: number }[] = [];
    let endIdx = 0;
    for (let s = 0; s < empOtStarts.length; s++) {
      const start = empOtStarts[s];
      // Advance to the first end punch after this start.
      while (endIdx < empOtEnds.length && empOtEnds[endIdx].eventTime.getTime() <= start.eventTime.getTime()) {
        endIdx++;
      }
      // An end punch only closes this session if it comes before the next start
      // (otherwise it belongs to a later session and this one is unterminated).
      const nextStartTime = s + 1 < empOtStarts.length ? empOtStarts[s + 1].eventTime.getTime() : Infinity;
      let hours = DEFAULT_OT_SESSION_HOURS;
      if (endIdx < empOtEnds.length && empOtEnds[endIdx].eventTime.getTime() < nextStartTime) {
        hours = (empOtEnds[endIdx].eventTime.getTime() - start.eventTime.getTime()) / 3_600_000;
        endIdx++;
      }
      if (hours > maxOtSessionHours) {
        cappedOtSessions.push({ date: start.eventTime.toISOString().slice(0, 10), rawHours: hours });
        hours = maxOtSessionHours;
      }
      const iso = start.eventTime.toISOString().slice(0, 10);
      if (empHolidaySet.has(iso)) holidayOtHours += hours;
      else if (weekendDays.includes(new Date(iso + "T00:00:00Z").getUTCDay())) weekendOtHours += hours;
      else weekdayOtHours += hours;
    }
    const overtimeHours = weekdayOtHours + weekendOtHours + holidayOtHours;

    // Apply OT rule (use standard by default) — separate multipliers per day type.
    const otRule = overtimeRules.find(r => r.nameEn.includes("Standard")) ?? overtimeRules[0];

    const weekdayRate = otRule ? parseFloat(otRule.multiplierWeekday) : 1.5;
    const weekendRate = otRule ? parseFloat(otRule.multiplierWeekend) : 2.0;
    const holidayRate = otRule ? parseFloat(otRule.multiplierHoliday) : 2.5;
    const hourlyRate = baseSalary / 176; // standard monthly hours convention
    // Round each bucket independently so payslip lines sum exactly to the stored overtimePay.
    const weekdayOtPay = Math.round(hourlyRate * weekdayOtHours * weekdayRate * 100) / 100;
    const weekendOtPay = Math.round(hourlyRate * weekendOtHours * weekendRate * 100) / 100;
    const holidayOtPay = Math.round(hourlyRate * holidayOtHours * holidayRate * 100) / 100;
    const overtimePay = Math.round((weekdayOtPay + weekendOtPay + holidayOtPay) * 100) / 100;

    // Build payslip lines
    const lines: { codeEn: string; nameEn: string; nameAr: string; type: string; amount: number; sortOrder: number; payComponentId?: number }[] = [];

    // Full-month amounts drive the per-day rate; payable line amounts are prorated
    // to the employed portion of the period.
    const housingPct = grade ? parseFloat(grade.housingAllowancePct) : 25;
    const housingAmount = baseSalary * (housingPct / 100);
    const transportPct = grade ? parseFloat(grade.transportAllowancePct) : 10;
    const transportAmount = baseSalary * (transportPct / 100);

    const employedWorkingDays = employStart <= employEnd ? countWorkingDays(employStart, employEnd, weekendDays, empHolidaySet) : 0;
    const prorationFactor = periodWorkingDays > 0 ? employedWorkingDays / periodWorkingDays : 0;
    const isProrated = prorationFactor < 1;
    const prorationLabelEn = isProrated ? ` (Prorated ${employedWorkingDays}/${periodWorkingDays} days)` : "";
    const prorationLabelAr = isProrated ? ` (نسبي ${employedWorkingDays}/${periodWorkingDays} يوم)` : "";

    const proratedBase = Math.round(baseSalary * prorationFactor * 100) / 100;
    const proratedHousing = Math.round(housingAmount * prorationFactor * 100) / 100;
    const proratedTransport = Math.round(transportAmount * prorationFactor * 100) / 100;

    lines.push({ codeEn: "BASE", nameEn: `Basic Salary${prorationLabelEn}`, nameAr: `الراتب الأساسي${prorationLabelAr}`, type: "earning", amount: proratedBase, sortOrder: 0 });
    lines.push({ codeEn: "HOUSING", nameEn: `Housing Allowance${prorationLabelEn}`, nameAr: `بدل السكن${prorationLabelAr}`, type: "earning", amount: proratedHousing, sortOrder: 1 });
    lines.push({ codeEn: "TRANSPORT", nameEn: `Transport Allowance${prorationLabelEn}`, nameAr: `بدل المواصلات${prorationLabelAr}`, type: "earning", amount: proratedTransport, sortOrder: 2 });
    // One payslip line per non-zero OT bucket so the different multipliers are auditable.
    const fmtHrs = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(2));
    if (weekdayOtPay > 0) {
      lines.push({ codeEn: "OT_WEEKDAY", nameEn: `Overtime — Weekday (${fmtHrs(weekdayOtHours)}h × ${weekdayRate})`, nameAr: `وقت إضافي — أيام الأسبوع (${fmtHrs(weekdayOtHours)} س × ${weekdayRate})`, type: "earning", amount: weekdayOtPay, sortOrder: 3 });
    }
    if (weekendOtPay > 0) {
      lines.push({ codeEn: "OT_WEEKEND", nameEn: `Overtime — Weekend (${fmtHrs(weekendOtHours)}h × ${weekendRate})`, nameAr: `وقت إضافي — عطلة نهاية الأسبوع (${fmtHrs(weekendOtHours)} س × ${weekendRate})`, type: "earning", amount: weekendOtPay, sortOrder: 3 });
    }
    if (holidayOtPay > 0) {
      lines.push({ codeEn: "OT_HOLIDAY", nameEn: `Overtime — Holiday (${fmtHrs(holidayOtHours)}h × ${holidayRate})`, nameAr: `وقت إضافي — عطلة رسمية (${fmtHrs(holidayOtHours)} س × ${holidayRate})`, type: "earning", amount: holidayOtPay, sortOrder: 3 });
    }

    const unpaidDays = approvedLeaves
      .filter(l => l.employeeId === emp.id && l.category === "unpaid")
      .reduce((sum, l) => sum + overlapDays(l.startDate, l.endDate, period.startDate, period.endDate, l.halfDay ?? false, weekendDays, empHolidaySet), 0);
    const deductedLeaveDays = Math.min(unpaidDays, employedWorkingDays);
    const dailyRate = periodWorkingDays > 0
      ? (baseSalary + housingAmount + transportAmount) / periodWorkingDays
      : 0;
    const leaveDeductionAmount = Math.round(deductedLeaveDays * dailyRate * 100) / 100;
    if (leaveDeductionAmount > 0) {
      lines.push({
        codeEn: "UNPAID_LEAVE", nameEn: "Unpaid Leave Deduction", nameAr: "خصم إجازة بدون راتب",
        type: "deduction", amount: leaveDeductionAmount, sortOrder: 4,
      });
    }

    // No-show absence deduction
    const attendedDates = new Set<string>();
    for (const e of punchEvents) {
      if (e.employeeId === emp.id) attendedDates.add(e.eventTime.toISOString().slice(0, 10));
    }
    for (const a of attendanceRecords) {
      if (a.employeeId === emp.id && a.status !== "absent") attendedDates.add(a.date);
    }
    const leaveCoveredDates = new Set<string>();
    for (const l of approvedLeaves) {
      if (l.employeeId !== emp.id) continue;
      const s = l.startDate > period.startDate ? l.startDate : period.startDate;
      const e2 = l.endDate < period.endDate ? l.endDate : period.endDate;
      if (s <= e2) for (const d of datesInRange(s, e2)) leaveCoveredDates.add(d);
    }
    const noShowDates = eligibleWorkdays.filter(d =>
      d >= emp.hireDate && d <= employEnd && !attendedDates.has(d) && !leaveCoveredDates.has(d)
    );
    // Days HR marked as excused for this period are not deducted.
    const excusedSet = excusedByEmp.get(emp.id);
    const unexcusedNoShowDates = excusedSet
      ? noShowDates.filter(d => !excusedSet.has(d))
      : noShowDates;
    const noShowDays = unexcusedNoShowDates.length;
    if (noShowDays > 0) noShowAlerts.push({ emp, dates: unexcusedNoShowDates });

    const deductedNoShowDays = Math.max(0, Math.min(noShowDays, employedWorkingDays - deductedLeaveDays));
    const absenceDeductionAmount = Math.round(deductedNoShowDays * dailyRate * 100) / 100;
    if (absenceDeductionAmount > 0) {
      lines.push({
        codeEn: "ABSENCE", nameEn: "Absence Deduction (No-Show)", nameAr: "خصم الغياب بدون إذن",
        type: "deduction", amount: absenceDeductionAmount, sortOrder: 5,
      });
    }

    // Pay components (allowances / deductions configured in the system)
    let compSortOrder = 10;
    for (const comp of components.filter(c => c.applicableTo === "all" || c.applicableTo === "commercial")) {
      let amount = 0;
      let compProrated = false;
      if (comp.calculationMethod === "fixed") {
        amount = parseFloat(comp.value);
        // Recurring fixed components (monthly stipends) are prorated to the
        // employed portion of the period; one-time payments are paid in full.
        if (comp.isRecurring && isProrated) {
          amount = amount * prorationFactor;
          compProrated = true;
        }
      } else if (comp.calculationMethod === "percentage") {
        const base = comp.percentageBase === "gross_salary"
          ? proratedBase + proratedHousing + proratedTransport
          : proratedBase;
        amount = base * (parseFloat(comp.value) / 100);
      }
      if (amount > 0) {
        lines.push({
          codeEn: comp.codeEn,
          nameEn: compProrated ? `${comp.nameEn}${prorationLabelEn}` : comp.nameEn,
          nameAr: compProrated ? `${comp.nameAr}${prorationLabelAr}` : comp.nameAr,
          type: comp.type, amount: Math.round(amount * 100) / 100,
          sortOrder: compSortOrder++,
          payComponentId: comp.id,
        });
      }
    }

    const totalEarnings = lines.filter(l => l.type === "earning").reduce((sum, l) => sum + l.amount, 0);
    const totalDeductionsEmp = lines.filter(l => l.type === "deduction").reduce((sum, l) => sum + l.amount, 0);
    const grossSalary = totalEarnings;
    const netSalary = grossSalary - totalDeductionsEmp;

    const hasException = !grade || cappedOtSessions.length > 0;
    if (hasException) exceptionCount++;

    const notes: string[] = [];
    if (!grade) notes.push("No salary grade assigned — using default base salary");
    if (cappedOtSessions.length > 0) {
      const detail = cappedOtSessions
        .map(c => `${c.date} (${Math.round(c.rawHours * 100) / 100}h)`)
        .join(", ");
      notes.push(`Suspicious overtime session(s) capped at ${maxOtSessionHours}h — likely missing end punch: ${detail}`);
    }
    if (isProrated) notes.push(`Prorated for partial employment: ${employedWorkingDays}/${periodWorkingDays} working days`);
    const [run] = await db.insert(payrollRunsTable).values({
      payrollPeriodId: periodId,
      employeeId: emp.id,
      salaryGradeId: grade?.id ?? null,
      baseSalary: String(Math.round(baseSalary * 100) / 100),
      grossSalary: String(Math.round(grossSalary * 100) / 100),
      totalEarnings: String(Math.round(totalEarnings * 100) / 100),
      totalDeductions: String(Math.round(totalDeductionsEmp * 100) / 100),
      netSalary: String(Math.round(netSalary * 100) / 100),
      overtimeHours: String(overtimeHours),
      overtimePay: String(Math.round(overtimePay * 100) / 100),
      deductedLeaveDays: String(deductedLeaveDays),
      leaveDeductionAmount: String(leaveDeductionAmount),
      workingDays: periodWorkingDays,
      presentDays: Math.max(0, employedWorkingDays - Math.ceil(deductedLeaveDays) - deductedNoShowDays),
      absentDays: Math.ceil(deductedLeaveDays) + deductedNoShowDays,
      hasException,
      exceptionNote: notes.length > 0 ? notes.join("; ") : null,
      status: hasException ? "exception" : "calculated",
      calculatedAt: new Date(),
    }).returning();

    for (const line of lines) {
      await db.insert(payrollRunLinesTable).values({
        payrollRunId: run.id,
        payComponentId: line.payComponentId ?? null,
        codeEn: line.codeEn,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        type: line.type,
        amount: String(line.amount),
        sortOrder: line.sortOrder,
      });
    }

    totalGross += grossSalary;
    totalDeductions += totalDeductionsEmp;
    totalNet += netSalary;
    runs.push(run);
  }

  // Warn affected employees (and their managers) about unexcused no-show days
  // so they can dispute the deduction before the period is approved and closed.
  if (noShowAlerts.length > 0) {
    const activeUsers = await db.select({ id: systemUsersTable.id, employeeId: systemUsersTable.employeeId })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.isActive, true));
    const userIdByEmployeeId = new Map<number, number>();
    for (const u of activeUsers) {
      if (u.employeeId != null && !userIdByEmployeeId.has(u.employeeId)) userIdByEmployeeId.set(u.employeeId, u.id);
    }
    for (const alert of noShowAlerts) {
      await notifyUnexcusedNoShows(period, alert.emp, alert.dates, userIdByEmployeeId);
    }
    // HR/admin users get one digest per calculation listing affected employees,
    // since HR is the only role that can excuse a no-show day.
    await notifyHrNoShowDigest(period, noShowAlerts);
  }

  // Update period aggregate totals (column names: totalGrossSalary, totalNetSalary, totalDeductions)
  await db.update(payrollPeriodsTable)
    .set({
      totalGrossSalary: String(Math.round(totalGross * 100) / 100),
      totalNetSalary: String(Math.round(totalNet * 100) / 100),
      totalDeductions: String(Math.round(totalDeductions * 100) / 100),
      exceptionCount,
      status: exceptionCount > 0 ? "under_review" : "calculated",
      updatedAt: new Date(),
    })
    .where(eq(payrollPeriodsTable.id, periodId));

  await db.insert(auditLogsTable).values({
    action: "payroll.calculated",
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ employeeCount: employees.length, exceptionCount, totalNet: Math.round(totalNet * 100) / 100 }),
  });

  return {
    periodId,
    runsCreated: runs.length,
    employeeCount: employees.length,
    exceptionCount,
    totalGross: Math.round(totalGross * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    runs: runs.map(r => ({ runId: r.id, employeeId: r.employeeId, grossSalary: r.grossSalary, netSalary: r.netSalary, hasException: r.hasException })),
  };
}

// True if the period already has payroll runs (i.e. was calculated before).
async function periodHasRuns(periodId: number): Promise<boolean> {
  const [run] = await db.select({ id: payrollRunsTable.id })
    .from(payrollRunsTable)
    .where(eq(payrollRunsTable.payrollPeriodId, periodId))
    .limit(1);
  return !!run;
}

// GET /payroll-periods/:id/no-shows — detected no-show days per employee (with excused status)
router.get("/payroll-periods/:id/no-shows", async (req, res): Promise<void> => {
  const periodId = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }

  const employees = await db.select().from(employeesTable).where(eq(employeesTable.status, "active"));
  const { punchEvents, attendanceRecords, approvedLeaves } = await loadNoShowInputs(period);
  const weekendDays = await getWeekendDays();
  const holidayRows = await loadHolidayRows();
  const startYear = parseInt(period.startDate.slice(0, 4), 10);
  const endYear = parseInt(period.endDate.slice(0, 4), 10);
  const excusedRows = await db.select().from(payrollExcusedAbsencesTable)
    .where(eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId));

  const entries = [];
  for (const emp of employees) {
  const empHolidaySet = buildHolidaySet(
    holidayRows,
    parseInt(period.startDate.slice(0, 4), 10),
    parseInt(period.endDate.slice(0, 4), 10),
    emp.organizationType ?? "commercial",
  );
  const eligibleWorkdays = eligibleNoShowWorkdays(period, weekendDays, empHolidaySet);
    const dates = computeNoShowDates(emp, eligibleWorkdays, punchEvents, attendanceRecords, approvedLeaves, period);
    if (dates.length === 0) continue;
    entries.push({
      employeeId: emp.id,
      employeeNumber: emp.employeeNumber,
      employeeNameEn: `${emp.firstNameEn} ${emp.lastNameEn}`,
      employeeNameAr: `${emp.firstNameAr} ${emp.lastNameAr}`,
      days: dates.map(date => {
        const ex = excusedRows.find(r => r.employeeId === emp.id && r.date === date);
        return {
          date,
          excused: !!ex,
          excusedId: ex?.id ?? null,
          reason: ex?.reason ?? null,
          excusedByUserId: ex?.excusedByUserId ?? null,
          excusedAt: ex?.createdAt ?? null,
        };
      }),
    });
  }
  res.json({ periodId, startDate: period.startDate, endDate: period.endDate, isClosed: period.isClosed, employees: entries });
});

// POST /payroll-periods/:id/excused-absences — HR excuses a detected no-show day
router.post("/payroll-periods/:id/excused-absences", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const periodId = parseInt(req.params.id, 10);
  const { employeeId, date, reason } = req.body ?? {};
  if (!employeeId || !date || !reason || !String(reason).trim()) {
    res.status(400).json({ error: "employeeId, date and reason are required" });
    return;
  }
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period is closed; excusals can no longer be changed" }); return; }
  if (date < period.startDate || date > period.endDate) {
    res.status(422).json({ error: "Date is outside this payroll period" });
    return;
  }

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, Number(employeeId)));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  // Only genuinely detected no-show days can be excused.
  const { punchEvents, attendanceRecords, approvedLeaves } = await loadNoShowInputs(period);
  const weekendDays = await getWeekendDays();
  const holidayRows = await loadHolidayRows();
  const empHolidaySet = buildHolidaySet(
    holidayRows,
    parseInt(period.startDate.slice(0, 4), 10),
    parseInt(period.endDate.slice(0, 4), 10),
    emp.organizationType ?? "commercial",
  );
  const eligibleWorkdays = eligibleNoShowWorkdays(period, weekendDays, empHolidaySet);
  const noShowDates = computeNoShowDates(emp, eligibleWorkdays, punchEvents, attendanceRecords, approvedLeaves, period);
  if (!noShowDates.includes(date)) {
    res.status(422).json({ error: "Date is not a detected no-show day for this employee" });
    return;
  }

  const [existing] = await db.select().from(payrollExcusedAbsencesTable).where(and(
    eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId),
    eq(payrollExcusedAbsencesTable.employeeId, emp.id),
    eq(payrollExcusedAbsencesTable.date, date),
  ));
  if (existing) { res.status(409).json({ error: "Day is already excused", excused: existing }); return; }

  const [created] = await db.insert(payrollExcusedAbsencesTable).values({
    payrollPeriodId: periodId,
    employeeId: emp.id,
    date,
    reason: String(reason).trim(),
    excusedByUserId: actorUserId,
  }).returning();

  await db.insert(auditLogsTable).values({
    action: "payroll.absence_excused",
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ employeeId: emp.id, date, reason: created.reason }),
  });

  // Auto-recalculate so run totals reflect the excusal without a manual step.
  // (Closed periods were rejected above; periods without runs stay untouched.)
  let recalculated = false;
  if (await periodHasRuns(periodId)) {
    await recalculatePeriodRuns(period, actorUserId);
    recalculated = true;
  }

  res.status(201).json({ ...created, recalculated });
});

// DELETE /payroll-periods/:id/excused-absences/:excusedId — undo an excusal
router.delete("/payroll-periods/:id/excused-absences/:excusedId", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const periodId = parseInt(req.params.id, 10);
  const excusedId = parseInt(req.params.excusedId, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period is closed; excusals can no longer be changed" }); return; }

  const [row] = await db.select().from(payrollExcusedAbsencesTable).where(and(
    eq(payrollExcusedAbsencesTable.id, excusedId),
    eq(payrollExcusedAbsencesTable.payrollPeriodId, periodId),
  ));
  if (!row) { res.status(404).json({ error: "Excused absence not found" }); return; }

  await db.delete(payrollExcusedAbsencesTable).where(eq(payrollExcusedAbsencesTable.id, excusedId));
  await db.insert(auditLogsTable).values({
    action: "payroll.absence_unexcused",
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ employeeId: row.employeeId, date: row.date }),
  });

  // Auto-recalculate so the reinstated deduction shows up without a manual step.
  let recalculated = false;
  if (await periodHasRuns(periodId)) {
    await recalculatePeriodRuns(period, actorUserId);
    recalculated = true;
  }

  res.json({ deleted: true, id: excusedId, recalculated });
});

// POST /payroll-periods/:id/approve — first/second approval step
router.post("/payroll-periods/:id/approve", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const periodId = parseInt(req.params.id, 10);
  const { approverId, note } = req.body;
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period already closed" }); return; }

  let updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (period.status === "under_review" || period.status === "calculated") {
    updateData = {
      ...updateData,
      status: "first_approved",
      firstApprovedBy: approverId ?? null,
      firstApprovedAt: new Date(),
      firstApproverNote: note ?? null,
    };
  } else if (period.status === "first_approved") {
    updateData = {
      ...updateData,
      status: "second_approved",
      secondApprovedBy: approverId ?? null,
      secondApprovedAt: new Date(),
      secondApproverNote: note ?? null,
    };
  } else {
    res.status(400).json({ error: `Cannot approve period in status: ${period.status}` });
    return;
  }

  const [updated] = await db.update(payrollPeriodsTable)
    .set(updateData)
    .where(eq(payrollPeriodsTable.id, periodId))
    .returning();

  await db.insert(auditLogsTable).values({
    action: `payroll.${updateData.status}`,
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ approverId, note }),
  });

  res.json(updated);
});

// POST /payroll-periods/:id/close — immutable close (requires second_approved)
router.post("/payroll-periods/:id/close", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const periodId = parseInt(req.params.id, 10);
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (!period) { res.status(404).json({ error: "Period not found" }); return; }
  if (period.isClosed) { res.status(400).json({ error: "Period already closed" }); return; }
  if (period.status !== "second_approved") {
    res.status(400).json({ error: "Period must have second approval before closing" });
    return;
  }

  const [closed] = await db.update(payrollPeriodsTable)
    .set({ status: "closed", isClosed: true, closedAt: new Date(), updatedAt: new Date() })
    .where(eq(payrollPeriodsTable.id, periodId))
    .returning();

  await db.insert(auditLogsTable).values({
    action: "payroll.closed",
    entityType: "payroll_period",
    entityId: periodId,
    entityLabel: period.nameEn,
    actorUserId,
    changesJson: JSON.stringify({ closedAt: new Date().toISOString() }),
  });

  res.json(closed);
});

export default router;
