// Centralized fetch with credentials
import {
  setDefaultCredentials,
  setUnauthorizedHandler,
  setPasswordChangeRequiredHandler,
  isPasswordChangeRequiredBody,
} from '@workspace/api-client-react';

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
  if (res.status === 403) {
    // The API blocks all business endpoints with PASSWORD_CHANGE_REQUIRED
    // while must_change_password is set. Peek at a clone so callers can
    // still consume the body.
    try {
      const body: unknown = await res.clone().json();
      if (isPasswordChangeRequiredBody(body)) handlePasswordChangeRequired();
    } catch {
      // Non-JSON 403 — nothing to detect.
    }
  }
  return res;
}

const SESSION_KEY = 'hrms-session';

/**
 * Fired on window when any API request is rejected with
 * 403 PASSWORD_CHANGE_REQUIRED. The auth provider listens and flips
 * `mustChangePassword` on the current user so the router swaps the app for
 * the forced change-password screen — no generic error toast, no reload.
 */
export const PASSWORD_CHANGE_REQUIRED_EVENT = 'hrms:password-change-required';

/**
 * A session became flagged mid-use (e.g. an admin reset the password).
 * Mark the stored session and notify the auth provider so the user lands on
 * the mandatory change-password screen instead of seeing failing requests.
 */
export function handlePasswordChangeRequired(): void {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      parsed.mustChangePassword = true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
    }
  } catch {
    // Storage unavailable/corrupt — the event below still routes the UI.
  }
  window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
}

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
  setPasswordChangeRequiredHandler(() => {
    handlePasswordChangeRequired();
  });
}
