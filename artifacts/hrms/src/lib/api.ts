// Centralized fetch with credentials
import { setDefaultCredentials, setUnauthorizedHandler } from '@workspace/api-client-react';
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'include' });
  if (res.status === 401) {
    handleSessionExpired();
  }
  return res;
}

const SESSION_KEY = 'hrms-session';

/** Clear the stored session and send the user to the login screen. */
export function handleSessionExpired(): void {
  localStorage.removeItem(SESSION_KEY);
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

/**
 * Configure the generated API client (react-query hooks) so every request
 * carries cookies and any 401 response signs the user out safely.
 * Called once at app startup.
 */
export function configureApiClient(): void {
  setDefaultCredentials('include');
  setUnauthorizedHandler(() => handleSessionExpired());
}
