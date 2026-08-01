// Centralized fetch with credentials
import { setDefaultCredentials, setUnauthorizedHandler } from '@workspace/api-client-react';

export interface ApiFetchOptions {
  /**
   * Deliberate, narrowly scoped opt-out of the global 401 session-expired
   * redirect. Use ONLY for optional probes of endpoints that require auth
   * even in demo mode (e.g. gateway administration), where a 401 means
   * "hide this optional section", not "your session expired".
   */
  optionalAuth?: boolean;
}

export async function apiFetch(path: string, init?: RequestInit, opts?: ApiFetchOptions): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'include' });
  if (res.status === 401 && !opts?.optionalAuth) {
    handleSessionExpired();
  }
  return res;
}

const SESSION_KEY = 'hrms-session';

/** Clear the stored session and send the user to the login screen. */
export function handleSessionExpired(): void {
  localStorage.removeItem(SESSION_KEY);
  if (!window.location.pathname.includes('/login')) {
    const next = window.location.pathname + window.location.search;
    const params = new URLSearchParams({ expired: '1' });
    // Only preserve an in-app destination worth returning to.
    if (next && next !== '/' && next.startsWith('/')) {
      params.set('next', next);
    }
    window.location.href = `/login?${params.toString()}`;
  }
}

/**
 * Endpoints where a 401 means "your input was wrong", not "your session
 * expired" — e.g. a bad login attempt or an incorrect current password on
 * self-service change. These must show an inline error, never force logout.
 */
const CREDENTIAL_CHECK_PATHS = ['/auth/login', '/auth/change-password'];

/** True when a 401 response should trigger the global session-expired flow. */
export function isSessionExpiry401(responseUrl: string): boolean {
  let pathname = responseUrl;
  try {
    pathname = new URL(responseUrl, 'http://localhost').pathname;
  } catch {
    // keep raw string fallback
  }
  return !CREDENTIAL_CHECK_PATHS.some((p) => pathname.endsWith(p));
}

/**
 * Configure the generated API client (react-query hooks) so every request
 * carries cookies and any session-expiry 401 signs the user out safely.
 * 401s from credential-check endpoints (login, change-password) are left to
 * the calling screen to display inline. Called once at app startup.
 */
export function configureApiClient(): void {
  setDefaultCredentials('include');
  setUnauthorizedHandler((response) => {
    if (isSessionExpiry401(response.url)) handleSessionExpired();
  });
}
