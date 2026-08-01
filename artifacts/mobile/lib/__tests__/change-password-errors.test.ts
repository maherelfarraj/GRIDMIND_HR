/**
 * Bilingual error mapping for the mobile change-password screen.
 *
 * The API's 401 body and some 400 bodies (schema validation, password reuse)
 * are English-only; Arabic users must never see raw English server text.
 * Policy-violation 400s carry bilingual error/errorAr and the server text is
 * preferred in the matching language.
 */
import { describe, it, expect } from 'vitest';
import { changePasswordErrorMessage } from '../change-password-errors';

const t = (key: string) => `t:${key}`;

describe('changePasswordErrorMessage', () => {
  it('maps 401 to the local wrong-current-password string in English', () => {
    expect(
      changePasswordErrorMessage(401, { error: 'Current password is incorrect' }, 'en', t),
    ).toBe('t:wrongCurrentPassword');
  });

  it('maps 401 to the local wrong-current-password string in Arabic', () => {
    expect(
      changePasswordErrorMessage(401, { error: 'Current password is incorrect' }, 'ar', t),
    ).toBe('t:wrongCurrentPassword');
  });

  it('uses the server Arabic message for bilingual 400 policy errors', () => {
    expect(
      changePasswordErrorMessage(
        400,
        { error: 'Password too weak', errorAr: 'كلمة المرور ضعيفة' },
        'ar',
        t,
      ),
    ).toBe('كلمة المرور ضعيفة');
  });

  it('uses the server English message for bilingual 400 policy errors', () => {
    expect(
      changePasswordErrorMessage(
        400,
        { error: 'Password too weak', errorAr: 'كلمة المرور ضعيفة' },
        'en',
        t,
      ),
    ).toBe('Password too weak');
  });

  it('falls back to the local Arabic weak-password string for English-only 400s', () => {
    // e.g. schema validation ("newPassword must be at least 8 characters")
    // or "New password must be different from the current password"
    expect(
      changePasswordErrorMessage(
        400,
        { error: 'newPassword must be at least 8 characters and currentPassword is required' },
        'ar',
        t,
      ),
    ).toBe('t:weakPassword');
  });

  it('keeps the English server message for English-only 400s in English', () => {
    expect(
      changePasswordErrorMessage(
        400,
        { error: 'New password must be different from the current password' },
        'en',
        t,
      ),
    ).toBe('New password must be different from the current password');
  });

  it('falls back to the local weak-password string when a 400 has no message', () => {
    expect(changePasswordErrorMessage(400, {}, 'en', t)).toBe('t:weakPassword');
    expect(changePasswordErrorMessage(400, null, 'ar', t)).toBe('t:weakPassword');
  });

  it('maps other failures to the generic message', () => {
    expect(changePasswordErrorMessage(500, { error: 'boom' }, 'en', t)).toBe(
      't:changePasswordFailed',
    );
    expect(changePasswordErrorMessage(null, undefined, 'ar', t)).toBe(
      't:changePasswordFailed',
    );
  });
});
