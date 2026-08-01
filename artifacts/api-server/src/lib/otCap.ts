/**
 * Shared helper for the admin-configurable overtime session sanity cap.
 *
 * The cap (hours) for a single paired overtime session is stored in
 * system_config under "payroll.maxOtSessionHours" so HR can tune it per
 * organization without a redeploy. Sessions longer than the cap are almost
 * always bad punch data, so payroll clamps them and flags the run.
 *
 * Resolution order: system_config value → MAX_OT_SESSION_HOURS env var →
 * 12h default. Invalid stored values are ignored with a warning (fail-safe
 * to the previous behavior) rather than breaking payroll calculation.
 */
import { db, systemConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Default overtime session sanity cap in hours. */
export const DEFAULT_MAX_OT_SESSION_HOURS = 12;

/** System config key holding the overtime session sanity cap (positive number of hours). */
export const OT_CAP_CONFIG_KEY = "payroll.maxOtSessionHours";

function parsePositiveHours(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read the configured overtime session sanity cap from system_config
 * ("payroll.maxOtSessionHours"). Falls back to the MAX_OT_SESSION_HOURS env
 * var, then 12h, when unset or invalid.
 */
export async function getMaxOtSessionHours(): Promise<number> {
  const [row] = await db.select().from(systemConfigTable)
    .where(eq(systemConfigTable.key, OT_CAP_CONFIG_KEY));
  if (row?.value != null && row.value.trim() !== "") {
    const configured = parsePositiveHours(row.value);
    if (configured != null) return configured;
    console.warn(`Invalid ${OT_CAP_CONFIG_KEY} config value "${row.value}" — must be a positive number of hours; falling back`);
  }
  const fromEnv = parsePositiveHours(process.env.MAX_OT_SESSION_HOURS);
  if (fromEnv != null) return fromEnv;
  if (process.env.MAX_OT_SESSION_HOURS && process.env.MAX_OT_SESSION_HOURS.trim() !== "") {
    console.warn(`Invalid MAX_OT_SESSION_HOURS env value "${process.env.MAX_OT_SESSION_HOURS}" — must be a positive number of hours; using default ${DEFAULT_MAX_OT_SESSION_HOURS}h`);
  }
  return DEFAULT_MAX_OT_SESSION_HOURS;
}
