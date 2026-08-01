/**
 * Shared public-holiday sector & recurrence logic.
 *
 * Payroll and every other surface that reads public_holidays (holiday
 * calendars, go-live gates, leave planning) must apply the same rules.
 * This module deliberately *mirrors* buildHolidaySet in
 * routes/payrollPeriods.ts (kept inline there because that file is a
 * high-contention merge hotspot); holiday-visibility.test.ts pins both
 * implementations to the same semantics:
 *
 *   applicableTo === "all"          → applies to everyone
 *   applicableTo === <sector>       → applies only to employees of that
 *                                     organizationType (commercial /
 *                                     government / military)
 *   isRecurring === true            → the *month-day* repeats every year,
 *                                     regardless of the stored year
 */

export interface HolidayRuleRow {
  date: string;
  isRecurring: boolean | null;
  applicableTo: string | null;
}

/** True when a holiday row applies to the given sector ("all" always applies). */
export function holidayAppliesToSector(applicableTo: string | null, sector: string): boolean {
  const applicable = applicableTo ?? "all";
  return applicable === "all" || applicable === sector;
}

/**
 * Resolve a holiday row's date for a given display year.
 * Recurring rows are remapped to `${year}-MM-DD`; non-recurring rows keep
 * their stored date, which is returned only when it falls inside `year`.
 */
export function holidayDateForYear(row: HolidayRuleRow, year: number): string | null {
  if (row.isRecurring) {
    // Extract "-MM-DD" regardless of how the date was stored
    // (full "YYYY-MM-DD" or "--MM-DD" / "-MM-DD").
    return `${year}${row.date.slice(-6)}`;
  }
  return row.date.slice(0, 4) === String(year) ? row.date : null;
}

/**
 * Build a Set of holiday ISO dates for [startYear, endYear], filtered to the
 * given sector. This is the reference implementation used by payroll.
 */
export function buildHolidaySet(
  rows: HolidayRuleRow[],
  startYear: number,
  endYear: number,
  sectorFilter: string,
): Set<string> {
  const set = new Set<string>();
  for (const h of rows) {
    if (!holidayAppliesToSector(h.applicableTo, sectorFilter)) continue;
    for (let y = startYear; y <= endYear; y++) {
      const date = holidayDateForYear(h, y);
      if (date) set.add(date);
    }
  }
  return set;
}

/**
 * Filter + expand full holiday rows for display.
 *
 * - When `sector` is given, rows not applicable to it are dropped.
 * - When `year` is given, recurring rows (from any stored year) are included
 *   with their `date`/`year` remapped to the requested year; non-recurring
 *   rows are included only when stored for that year.
 * - Without `year`, rows are returned as stored (sector filter still applies).
 *
 * Result is sorted by resolved date.
 */
export function resolveHolidaysForDisplay<T extends HolidayRuleRow & { year: number }>(
  rows: T[],
  opts: { year?: number; sector?: string },
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    if (opts.sector !== undefined && !holidayAppliesToSector(row.applicableTo, opts.sector)) continue;
    if (opts.year === undefined) {
      out.push(row);
      continue;
    }
    const date = holidayDateForYear(row, opts.year);
    if (date === null) continue;
    out.push({ ...row, date, year: opts.year });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
