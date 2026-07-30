import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  fullNameEn: string;
  fullNameAr: string;
  roleId: number;
  employeeId: number | null;
  isActive: boolean;
  mfaEnabled: boolean;
  preferredLanguage: string;
  lastLoginAt: string | null;
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_KEY = 'hrms-session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Only restore session if the user previously explicitly logged in
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as User;
      // Validate stored session is still good by re-fetching
      fetch('/api/auth/me', { credentials: 'include' })
        .then((res) => res.ok ? res.json() : Promise.reject())
        .then((userData: User) => {
          setUser(userData);
          localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
        })
        .catch(() => {
          localStorage.removeItem(SESSION_KEY);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
      // Optimistically set from storage while validating
      setUser(parsed);
    } catch {
      localStorage.removeItem(SESSION_KEY);
      setIsLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Login failed' }));
      const err = new Error(error.error || 'Invalid credentials') as Error & {
        errorAr?: string;
        retryAfterSeconds?: number;
      };
      if (typeof error.errorAr === 'string') err.errorAr = error.errorAr;
      if (typeof error.retryAfterSeconds === 'number') err.retryAfterSeconds = error.retryAfterSeconds;
      throw err;
    }

    const userData: User = await res.json();
    setUser(userData);
    localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Password change failed' }));
      throw new Error(error.error || 'Password change failed');
    }
    const userData: User = await res.json();
    setUser(userData);
    localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
