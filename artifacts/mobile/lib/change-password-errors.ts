import type { Lang } from '@/lib/i18n';

/**
 * Map a change-password API failure to a user-facing message in the active
 * language.
 *
 * Rules:
 * - 401 → the "current password is incorrect" string (bilingual local copy;
 *   the server's 401 body is English-only).
 * - 400 → prefer the server's message in the active language. The server
 *   sends bilingual `error`/`errorAr` for policy violations, but some 400s
 *   (schema validation such as "< 8 characters", or reusing the current
 *   password) carry an English-only `error`. In Arabic, never surface an
 *   English-only server message — fall back to the local Arabic weak-password
 *   string instead.
 * - anything else → the generic failure string.
 */
export function changePasswordErrorMessage(
  status: number | null,
  data: unknown,
  lang: Lang,
  t: (key: 'wrongCurrentPassword' | 'weakPassword' | 'changePasswordFailed') => string,
): string {
  if (status === 401) return t('wrongCurrentPassword');
  if (status === 400) {
    const body = (data ?? {}) as { error?: string; errorAr?: string };
    if (lang === 'ar') return body.errorAr || t('weakPassword');
    return body.error || t('weakPassword');
  }
  return t('changePasswordFailed');
}
