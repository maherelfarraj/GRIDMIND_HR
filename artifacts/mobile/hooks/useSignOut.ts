/**
 * Shared sign-out hook.
 *
 * Returns a stable `signOut` callback that calls the auth `logout` function.
 * The underlying `logout` already handles:
 *  - clearing the in-memory token, SecureStore token, and profile cache
 *  - setting the `logoutToast` flag in AuthContext when the server call fails
 *    so the user sees feedback even though local sign-out completed
 *
 * All sign-out entry points (home screen, settings, profile, future tabs)
 * should call this hook instead of accessing `logout` directly so that any
 * future changes to the sign-out flow (additional cleanup, analytics, etc.)
 * only need to happen here, once.
 */
import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';

export function useSignOut(): () => Promise<void> {
  const { logout } = useAuth();

  return useCallback(async () => {
    await logout();
  }, [logout]);
}
