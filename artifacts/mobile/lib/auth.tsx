import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginUser, setUnauthorizedHandler } from '@workspace/api-client-react';
import type { AuthUser } from '@workspace/api-client-react';

const STORAGE_KEY = 'hrms-mobile-session';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Any 401 from the API (outside credential-check endpoints) means the
  // server session is gone — clear the stored profile so the navigation
  // guards return the user to the sign-in screen instead of rendering
  // broken screens with failing reads.
  useEffect(() => {
    setUnauthorizedHandler((response) => {
      const url = response.url ?? '';
      // Login / password-change 401s are credential errors, not expiry.
      if (url.includes('/auth/login') || url.includes('/auth/change-password')) {
        return;
      }
      setUser(null);
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setUser(JSON.parse(raw) as AuthUser);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const authUser = await loginUser({ username, password });
    setUser(authUser);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, logout }),
    [user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
