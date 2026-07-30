/**
 * Shared helper for the admin-configurable weekend.
 *
 * Weekend days are stored in system_config under "payroll.weekendDays" as a
 * JSON array of day indexes (JS getUTCDay: 0=Sun … 6=Sat). Payroll, attendance
 * dashboards, and seeds must all read the same config so an org on e.g. a
 * Sat/Sun weekend sees consistent off-days everywhere.
 */
import { db, systemConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Default weekend day indexes: Friday=5, Saturday=6 — the Saudi weekend. */
export const DEFAULT_WEEKEND_DAYS = [5, 6];

/** System config key holding a JSON array of weekend day indexes (0=Sun … 6=Sat). */
export const WEEKEND_CONFIG_KEY = "payroll.weekendDays";

/**
 * Read configured weekend days from system_config ("payroll.weekendDays",
 * JSON array of day indexes 0–6). Falls back to Fri/Sat when unset or invalid.
 */
export async function getWeekendDays(): Promise<number[]> {
  const [row] = await db.select().from(systemConfigTable)
    .where(eq(systemConfigTable.key, WEEKEND_CONFIG_KEY));
  if (!row?.value) return DEFAULT_WEEKEND_DAYS;
  try {
    const parsed = JSON.parse(row.value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.length < 7 &&
      parsed.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return [...new Set(parsed as number[])];
    }
  } catch { /* fall through to default */ }
  console.warn(`Invalid ${WEEKEND_CONFIG_KEY} config value "${row.value}" — falling back to Fri/Sat`);
  return DEFAULT_WEEKEND_DAYS;
}
