/**
 * Guards the change-password UX contract: a 401 from a credential-check
 * endpoint (wrong current password on /auth/change-password, bad login on
 * /auth/login) must be shown inline by the calling screen — it must NOT
 * trigger the global session-expired logout/redirect. Any other 401 must.
 */
import { describe, it, expect } from 'vitest';
import { isSessionExpiry401 } from '../api';

describe('isSessionExpiry401', () => {
  it('does not treat a wrong current password on change-password as session expiry', () => {
    expect(isSessionExpiry401('http://localhost/api/auth/change-password')).toBe(false);
    expect(isSessionExpiry401('/api/auth/change-password')).toBe(false);
  });

  it('does not treat a failed login as session expiry', () => {
    expect(isSessionExpiry401('http://localhost/api/auth/login')).toBe(false);
  });

  it('treats 401s from any other endpoint as session expiry', () => {
    expect(isSessionExpiry401('http://localhost/api/auth/me')).toBe(true);
    expect(isSessionExpiry401('http://localhost/api/users')).toBe(true);
    expect(isSessionExpiry401('/api/employees/5')).toBe(true);
  });

  it('ignores query strings when matching', () => {
    expect(isSessionExpiry401('http://localhost/api/auth/change-password?x=1')).toBe(false);
    expect(isSessionExpiry401('http://localhost/api/users?page=1')).toBe(true);
  });
});
