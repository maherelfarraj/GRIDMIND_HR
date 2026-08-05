/**
 * Returns the Arabic name when the UI language is Arabic and nameAr is non-empty;
 * falls back to nameEn otherwise. Handles nullable, undefined, and empty-string
 * Arabic columns, and also optional English name fields from API client types.
 *
 * @param nameEn  The English name (may be null/undefined for optional API fields).
 * @param nameAr  The Arabic name (may be null, undefined, or an empty string).
 * @param lang    The current UI language ('en' | 'ar').
 */
export function localName(
  nameEn: string | null | undefined,
  nameAr: string | null | undefined,
  lang: string,
): string {
  if (lang === 'ar' && nameAr) return nameAr;
  return nameEn ?? '';
}

/**
 * Assembles a full person name from separate first/last fields in two languages.
 *
 * The Arabic name is returned only when ALL of these hold:
 *   – the UI language is Arabic
 *   – firstAr is a non-empty string
 *   – lastAr is a non-empty string
 *
 * Any other condition (English UI, partially-blank Arabic fields, nulls) falls
 * back to the English full name so the rendered value is never incomplete.
 *
 * @param firstEn  English first name.
 * @param lastEn   English last name.
 * @param firstAr  Arabic first name (may be null/undefined/empty).
 * @param lastAr   Arabic last name (may be null/undefined/empty).
 * @param lang     The current UI language ('en' | 'ar').
 */
export function localFullName(
  firstEn: string | null | undefined,
  lastEn: string | null | undefined,
  firstAr: string | null | undefined,
  lastAr: string | null | undefined,
  lang: string,
): string {
  if (lang === 'ar' && firstAr && lastAr) {
    return `${firstAr} ${lastAr}`;
  }
  const en = `${firstEn ?? ''} ${lastEn ?? ''}`.trim();
  return en;
}
