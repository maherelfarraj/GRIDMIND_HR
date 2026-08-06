import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { usePathname, useRouter } from 'expo-router';
import {
  getAuthMe,
  loginUser,
  logoutUser,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  setPasswordChangeRequiredHandler,
} from '@workspace/api-client-react';
import type { AuthUser } from '@workspace/api-client-react';

export type { AuthUser };

// Cached profile for instant paint while the token is validated. Never
// trusted on its own: without a valid session token the user is signed out.
const PROFILE_KEY = 'hrms-mobile-session';
// Session token lives in the platform keychain via expo-secure-store.
const TOKEN_KEY = 'hrms-mobile-session-token';

// SecureStore is unavailable on web (Expo web preview); fall back to
// AsyncStorage there so the app still works in the browser preview.
const secureStoreAvailable = Platform.OS !== 'web';

async function readToken(): Promise<string | null> {
  try {
    return secureStoreAvailable
      ? await SecureStore.getItemAsync(TOKEN_KEY)
      : await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeToken(token: string): Promise<void> {
  if (secureStoreAvailable) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await AsyncStorage.setItem(TOKEN_KEY, token);
}

async function clearToken(): Promise<void> {
  try {
    if (secureStoreAvailable) await SecureStore.deleteItemAsync(TOKEN_KEY);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // Best-effort: a stale token that fails to delete is rejected
    // server-side anyway.
  }
}

// In-memory token mirror so the auth-token getter is synchronous-fast and
// never races SecureStore reads on every request.
let currentToken: string | null = null;

// Every API request carries `Authorization: Bearer <token>` when signed in.
setAuthTokenGetter(() => currentToken);

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Clear the mustChangePassword flag after a successful in-app password
   * change so the navigation guards let the user into the tabs again.
   */
  markPasswordChanged: () => void;
  /**
   * The route the user was on when their session expired, so login can
   * return them there. Null when the sign-out was voluntary.
   */
  expiredReturnTo: string | null;
  /** Consume and clear the saved return-to route after navigating. */
  clearExpiredReturnTo: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [expiredReturnTo, setExpiredReturnTo] = useState<string | null>(null);

  const router = useRouter();

  // Track the current route so the 401 handler can save it as the return
  // destination before clearing the user state.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Latch: true while a validated session is active, false otherwise. The 401
  // handler flips it to false on the first expiry so that concurrent in-flight
  // requests that also 401 are ignored instead of overwriting the saved route.
  const sessionLiveRef = useRef(false);

  // Any 401 from the API (outside credential-check endpoints) means the
  // server session is gone — clear the token and cached profile, navigate
  // every screen (including those without their own auth guard) to login,
  // and record the current route so login can return the user there.
  useEffect(() => {
    setUnauthorizedHandler((response) => {
      const url = response.url ?? '';
      // Login / password-change 401s are credential errors, not expiry.
      if (url.includes('/auth/login') || url.includes('/auth/change-password')) {
        return;
      }
      // Latch: only the first 401 per session captures the route and
      // navigates. Subsequent concurrent responses return early so they
      // can't overwrite the saved destination or issue a second replace.
      if (!sessionLiveRef.current) return;
      sessionLiveRef.current = false;

      // Capture the current route for post-login redirect. Exclude auth
      // screens themselves (they're not a meaningful return destination).
      const route = pathnameRef.current;
      const isAuthScreen = route === '/login' || route === '/change-password';
      setExpiredReturnTo(isAuthScreen ? null : route || null);
      currentToken = null;
      setUser(null);
      clearToken().catch(() => {});
      AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
      // Navigate imperatively so screens that lack their own auth guard
      // (e.g. /notifications, /devices, /payslip/[id]) are also sent to
      // login reliably; guarded screens would redirect on their own, but
      // this makes the behaviour unconditional.
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  // The API rejects all business endpoints with 403 PASSWORD_CHANGE_REQUIRED
  // while must_change_password is set (e.g. an admin reset the password
  // mid-session). Flip the flag on the in-memory + cached profile so the
  // navigation guards route to the forced change-password flow instead of
  // screens surfacing generic errors.
  useEffect(() => {
    setPasswordChangeRequiredHandler(() => {
      setUser((current) => {
        if (!current || current.mustChangePassword) return current;
        const flagged = { ...current, mustChangePassword: true };
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(flagged)).catch(() => {});
        return flagged;
      });
    });
    return () => setPasswordChangeRequiredHandler(null);
  }, []);

  // Bootstrap: a stored profile alone is never trusted. Restore the session
  // token from SecureStore, then validate it against the server (/auth/me).
  // The cached profile only provides an instant paint while validation runs;
  // a 401 during validation is handled by the unauthorized handler above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await readToken();
      if (!token) {
        // No token: any lingering cached profile is untrusted — drop it.
        AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
        return;
      }
      currentToken = token;

      const cached = await AsyncStorage.getItem(PROFILE_KEY).catch(() => null);
      if (cached && !cancelled) {
        try {
          setUser(JSON.parse(cached) as AuthUser);
        } catch {
          // Corrupt cache — wait for the server profile below.
        }
      }

      try {
        const fresh = await getAuthMe();
        if (!cancelled) {
          setUser(fresh as AuthUser);
          // Session is confirmed live — arm the latch so the 401 handler
          // will capture the route and navigate on mid-session expiry.
          sessionLiveRef.current = true;
        }
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(fresh)).catch(() => {});
      } catch {
        // 401 → unauthorized handler already signed us out. Network errors
        // keep the cached profile so brief offline periods don't log the
        // user out; the next successful request re-validates.
      }
    })().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    // Opt in to bearer-token transport: the API returns the session token in
    // the body instead of relying on a cookie.
    const authUser = await loginUser(
      { username, password },
      { headers: { 'x-session-transport': 'bearer' } },
    );
    const token = authUser.sessionToken;
    if (!token) {
      throw new Error('Login did not return a session token');
    }
    currentToken = token;
    await writeToken(token);
    const { sessionToken: _omit, ...profile } = authUser;
    // Arm the latch before setting user so any 401 that fires immediately
    // after login is treated as a mid-session expiry.
    sessionLiveRef.current = true;
    setUser(profile as AuthUser);
    // Cache profile for instant paint only — never store the token here.
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, []);

  const logout = useCallback(async () => {
    // Best-effort server-side session destruction; local sign-out always
    // proceeds even if the network call fails.
    try {
      await logoutUser();
    } catch {
      // Session may already be gone (expired/destroyed) — fine.
    }
    currentToken = null;
    setUser(null);
    await Promise.all([clearToken(), AsyncStorage.removeItem(PROFILE_KEY)]);
  }, []);

  const markPasswordChanged = useCallback(() => {
    setUser((current) => {
      if (!current || !current.mustChangePassword) return current;
      const cleared = { ...current, mustChangePassword: false };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(cleared)).catch(() => {});
      return cleared;
    });
  }, []);

  const clearExpiredReturnTo = useCallback(() => {
    setExpiredReturnTo(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login,
      logout,
      markPasswordChanged,
      expiredReturnTo,
      clearExpiredReturnTo,
    }),
    [user, isLoading, login, logout, markPasswordChanged, expiredReturnTo, clearExpiredReturnTo],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
