import { Router } from "express";
import { db, systemConfigTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router = Router();

// Keys whose numeric value must be strictly positive (hour/day/minute
// durations and caps — zero or negative values are always misconfiguration).
const POSITIVE_NUMBER_KEYS = new Set([
  "payroll.maxOtSessionHours", // see src/lib/otCap.ts — positive number of hours
  "security.break_glass_ttl_minutes",
  "security.audit_retention_days",
  "backup.rpo_hours",
  "backup.rto_hours",
  "backup.retention_days",
]);

/**
 * Validate a raw client-sent value against the config row's valueType.
 * Returns an error message, or null when the value is acceptable.
 */
function validateConfigValue(
  key: string,
  valueType: string,
  raw: unknown
): string | null {
  const str = String(raw).trim();
  switch (valueType) {
    case "number": {
      if (str === "" || !Number.isFinite(Number(str))) {
        return "must be a finite number";
      }
      if (POSITIVE_NUMBER_KEYS.has(key) && Number(str) <= 0) {
        return "must be a positive number";
      }
      return null;
    }
    case "boolean": {
      return str === "true" || str === "false"
        ? null
        : 'must be "true" or "false"';
    }
    case "json": {
      try {
        JSON.parse(str);
        return null;
      } catch {
        return "must be valid JSON";
      }
    }
    default:
      return null; // string — anything goes
  }
}

// GET /system-config — list all; optionally filter by ?category=xxx
router.get("/system-config", async (req, res): Promise<void> => {
  const { category } = req.query as Record<string, string>;
  let rows;
  if (category) {
    rows = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.category, category))
      .orderBy(asc(systemConfigTable.category), asc(systemConfigTable.key));
  } else {
    rows = await db
      .select()
      .from(systemConfigTable)
      .orderBy(asc(systemConfigTable.category), asc(systemConfigTable.key));
  }
  res.json(rows);
});

// PATCH /system-config — body is object like { "org.type": "military", "sec.level": "restricted" }
router.patch("/system-config", async (req, res): Promise<void> => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "Body must be an object of key-value pairs" });
    return;
  }

  // First pass: load rows and validate every value against its valueType,
  // so a request with any bad value saves nothing.
  const applicable: Array<[string, unknown]> = [];
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(updates)) {
    const [existing] = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, key));

    if (!existing) continue;
    if (existing.isReadonly) continue; // skip readonly silently

    const error = validateConfigValue(key, existing.valueType, value);
    if (error) {
      errors[key] = error;
    } else {
      applicable.push([key, value]);
    }
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: "Invalid config values", details: errors });
    return;
  }

  const updated: typeof systemConfigTable.$inferSelect[] = [];

  for (const [key, value] of applicable) {
    const [row] = await db
      .update(systemConfigTable)
      .set({ value: String(value), updatedAt: new Date() })
      .where(eq(systemConfigTable.key, key))
      .returning();

    if (row) updated.push(row);
  }

  res.json(updated);
});

export default router;
