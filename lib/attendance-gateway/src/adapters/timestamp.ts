/**
 * Normalize device timestamps without depending on the gateway host timezone.
 *
 * Vendor APIs commonly return `YYYY-MM-DD HH:mm:ss` with no offset. Treat
 * those values as UTC so the same punch produces the same instant on every
 * gateway. ISO strings that already include `Z` or an offset keep their
 * stated timezone semantics.
 */
export function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
