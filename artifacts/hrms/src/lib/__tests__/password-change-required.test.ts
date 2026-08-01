// @vitest-environment jsdom
/**
 * Guards the mid-session forced password-change contract: when the API
 * blocks a request with 403 { code: "PASSWORD_CHANGE_REQUIRED" } (e.g. an
 * admin reset the password while the user was signed in), the client must
 * flag the stored session and notify the auth provider so the router swaps
 * in the forced change-password screen — never a generic error toast.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isPasswordChangeRequiredBody } from '@workspace/api-client-react';
import { handlePasswordChangeRequired, PASSWORD_CHANGE_REQUIRED_EVENT } from '../api';

describe('isPasswordChangeRequiredBody', () => {
  it('matches only the PASSWORD_CHANGE_REQUIRED code', () => {
    expect(isPasswordChangeRequiredBody({ code: 'PASSWORD_CHANGE_REQUIRED' })).toBe(true);
    expect(
      isPasswordChangeRequiredBody({
        error: 'Password change required before accessing this resource',
        code: 'PASSWORD_CHANGE_REQUIRED',
      }),
    ).toBe(true);
    expect(isPasswordChangeRequiredBody({ code: 'FORBIDDEN' })).toBe(false);
    expect(isPasswordChangeRequiredBody({ error: 'Forbidden' })).toBe(false);
    expect(isPasswordChangeRequiredBody(null)).toBe(false);
    expect(isPasswordChangeRequiredBody('PASSWORD_CHANGE_REQUIRED')).toBe(false);
  });
});

describe('handlePasswordChangeRequired', () => {
  beforeEach(() => localStorage.clear());

  it('flags the stored session and dispatches the event', () => {
    localStorage.setItem('hrms-session', JSON.stringify({ id: 1, username: 'a' }));
    let fired = 0;
    const listener = () => { fired += 1; };
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, listener);
    try {
      handlePasswordChangeRequired();
    } finally {
      window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, listener);
    }
    expect(fired).toBe(1);
    expect(JSON.parse(localStorage.getItem('hrms-session')!)).toMatchObject({
      id: 1,
      mustChangePassword: true,
    });
  });

  it('still dispatches the event when no session is stored', () => {
    let fired = 0;
    const listener = () => { fired += 1; };
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, listener);
    try {
      handlePasswordChangeRequired();
    } finally {
      window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, listener);
    }
    expect(fired).toBe(1);
    expect(localStorage.getItem('hrms-session')).toBeNull();
  });
});
