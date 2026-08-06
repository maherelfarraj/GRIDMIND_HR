/**
 * Navigation-guard coverage for the forced password-change flow.
 *
 * A user provisioned with a one-time password (mustChangePassword) must not
 * be able to reach the tabs, no matter how they get there:
 * - the login screen redirects them to /change-password, not /(tabs);
 * - the tab layout redirects them to /change-password (covers dismissing the
 *   modal via gesture and deep-linking straight to a tab);
 * - a mid-session 403 PASSWORD_CHANGE_REQUIRED flips the flag and bounces
 *   them out of the tabs;
 * - after a successful change the flag clears, the tabs render, and Done
 *   lands on the home tab.
 *
 * These tests render the REAL route components (app/login.tsx,
 * app/(tabs)/_layout.tsx, app/change-password.tsx) with the real
 * AuthProvider and real customFetch pipeline; only native-only UI modules
 * and expo-router primitives are stubbed with DOM equivalents.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
  fireEvent,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks: native modules → DOM equivalents
// ---------------------------------------------------------------------------

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(async () => {}),
  removeItem: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));

const secureStoreMock = vi.hoisted(() => ({
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  setItemAsync: vi.fn<(key: string, value: string) => Promise<void>>(async () => {}),
  deleteItemAsync: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));
vi.mock('expo-secure-store', () => secureStoreMock);

// Extra native modules imported by app/_layout.tsx (needed when RootLayoutNav
// is imported for the non-tab-screen guard tests below).
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: vi.fn(async () => {}),
  hideAsync: vi.fn(async () => {}),
}));
vi.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    GestureHandlerRootView: ({ children }: any) =>
      React.createElement('div', null, children),
  };
});
vi.mock('react-native-keyboard-controller', () => {
  const React = require('react');
  return {
    KeyboardProvider: ({ children }: any) =>
      React.createElement('div', null, children),
  };
});
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: null,
  Inter_500Medium: null,
  Inter_600SemiBold: null,
  Inter_700Bold: null,
  useFonts: () => [true, null],
}));
vi.mock('@/components/ErrorBoundary', () => {
  const React = require('react');
  return {
    ErrorBoundary: ({ children }: any) =>
      React.createElement('div', null, children),
  };
});

vi.mock('react-native', () => {
  const React = require('react');
  const passthrough =
    (tag: string) =>
    ({ children, testID, onPress, ...rest }: any) =>
      React.createElement(
        tag,
        { 'data-testid': testID, onClick: onPress },
        children,
      );
  return {
    Platform: { OS: 'ios' },
    View: passthrough('div'),
    Text: passthrough('span'),
    Pressable: ({ children, testID, onPress, style, ...rest }: any) =>
      React.createElement(
        'button',
        { 'data-testid': testID, onClick: onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    TextInput: ({ testID, value, onChangeText }: any) =>
      React.createElement('input', {
        'data-testid': testID,
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
    Image: () => null,
    StyleSheet: {
      create: (s: any) => s,
      absoluteFill: {},
    },
  };
});

// expo-router primitives: Redirect renders an inspectable marker.
let mockPathname = '/(tabs)';
vi.mock('expo-router', () => {
  const React = require('react');
  const Tabs = ({ children }: any) =>
    React.createElement('div', { 'data-testid': 'tabs-content' }, null);
  Tabs.Screen = () => null;
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement('div', {
        'data-testid': 'redirect',
        'data-href': href,
      }),
    Tabs,
    useRouter: () => routerMock,
    usePathname: () => mockPathname,
    Stack: Object.assign(
      ({ children }: any) => React.createElement('div', null, children),
      { Screen: () => null },
    ),
  };
});
vi.mock('expo-router/unstable-native-tabs', () => {
  const NativeTabs: any = () => null;
  NativeTabs.Trigger = () => null;
  return { NativeTabs, Icon: () => null, Label: () => null };
});

vi.mock('expo-glass-effect', () => ({ isLiquidGlassAvailable: () => false }));
vi.mock('expo-blur', () => ({ BlurView: () => null }));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: any) =>
      React.createElement('div', null, children),
  };
});
vi.mock('@/components/KeyboardAwareScrollViewCompat', () => {
  const React = require('react');
  return {
    KeyboardAwareScrollViewCompat: ({ children }: any) =>
      React.createElement('div', null, children),
  };
});
vi.mock('@/components/ui', () => {
  const React = require('react');
  return {
    AppButton: ({ testID, label, onPress, disabled }: any) =>
      React.createElement(
        'button',
        { 'data-testid': testID, onClick: onPress, disabled: !!disabled },
        label,
      ),
    LangToggle: () => null,
  };
});
// Static image imported via require() in login.tsx.
vi.mock('@/assets/images/icon.png', () => ({ default: 0 }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000',
    foreground: '#fff',
    card: '#111',
    border: '#222',
    primary: '#0af',
    mutedForeground: '#888',
    destructive: '#f00',
    success: '#0f0',
    radius: 8,
  }),
}));
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en' as const }),
}));

// ---------------------------------------------------------------------------
// Real modules under test
// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from '../auth';
// customFetch is internal to the api-client package; the package resolves to
// src, so this import shares module state with the handlers auth.tsx installs.
import {
  customFetch,
  ApiError,
} from '../../../../lib/api-client-react/src/custom-fetch';
import LoginScreen from '../../app/login';
import TabLayout from '../../app/(tabs)/_layout';
import ChangePasswordScreen from '../../app/change-password';
import { RootLayoutNav } from '../../app/_layout';

const PROFILE_KEY = 'hrms-mobile-session';

let latestAuth: ReturnType<typeof useAuth> | null = null;
function Probe() {
  latestAuth = useAuth();
  return null;
}

/** Mounts children only once the session has hydrated, mirroring how the
 * router only mounts /change-password after a guard redirected there. */
function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : null;
}

function json200(url: string, payload: unknown) {
  return {
    status: 200,
    ok: true,
    statusText: 'OK',
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {},
    text: async () => JSON.stringify(payload),
    clone() {
      return this;
    },
  } as unknown as Response;
}

function json403PasswordChangeRequired(url: string) {
  return {
    status: 403,
    ok: false,
    statusText: 'Forbidden',
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {},
    text: async () =>
      JSON.stringify({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'blocked' }),
    clone() {
      return this;
    },
  } as unknown as Response;
}

/** Sign in via stored token + cached profile; /auth/me fails offline so the
 * cached profile (including mustChangePassword) is what the guards see. */
function primeStoredSession(profile: Record<string, unknown>) {
  secureStoreMock.getItemAsync.mockResolvedValue('tok-123');
  asyncStorageMock.getItem.mockResolvedValue(JSON.stringify(profile));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Network request failed');
    }),
  );
}

function redirectHref(): string | null {
  const el = screen.queryByTestId('redirect');
  return el ? el.getAttribute('data-href') : null;
}

beforeEach(() => {
  latestAuth = null;
  mockPathname = '/(tabs)';
  routerMock.replace.mockClear();
  routerMock.back.mockClear();
  asyncStorageMock.getItem.mockReset();
  asyncStorageMock.setItem.mockClear();
  asyncStorageMock.removeItem.mockClear();
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
});

afterEach(async () => {
  if (latestAuth?.user) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await act(async () => {
      await latestAuth!.logout();
    });
  }
  cleanup();
  vi.unstubAllGlobals();
});

describe('login screen guard', () => {
  it('redirects a mustChangePassword user to /change-password, never /(tabs)', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe', mustChangePassword: true });
    render(
      <AuthProvider>
        <Probe />
        <LoginScreen />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });
  });

  it('redirects a normal signed-in user to /(tabs)', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe' });
    render(
      <AuthProvider>
        <Probe />
        <LoginScreen />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(redirectHref()).toBe('/(tabs)');
    });
  });

  it('login that returns mustChangePassword redirects to /change-password', async () => {
    secureStoreMock.getItemAsync.mockResolvedValue(null);
    asyncStorageMock.getItem.mockResolvedValue(null);
    render(
      <AuthProvider>
        <Probe />
        <LoginScreen />
      </AuthProvider>,
    );
    await waitFor(() => expect(latestAuth?.isLoading).toBe(false));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        json200(String(input), {
          id: 'u9',
          username: 'newhire',
          mustChangePassword: true,
          sessionToken: 'tok-otp',
        }),
      ),
    );
    fireEvent.change(screen.getByTestId('input-username'), {
      target: { value: 'newhire' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'one-time-pw' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-login'));
    });

    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });
    // The explicit replace('/(tabs)') in handleLogin is irrelevant: the tabs
    // layout guard (tested below) bounces the user back out anyway.
  });
});

describe('tabs layout guard (deep link / dismissed modal)', () => {
  it('redirects a mustChangePassword user out of the tabs to /change-password', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe', mustChangePassword: true });
    render(
      <AuthProvider>
        <Probe />
        <TabLayout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });
    expect(screen.queryByTestId('tabs-content')).toBeNull();
  });

  it('redirects a signed-out visitor to /login', async () => {
    secureStoreMock.getItemAsync.mockResolvedValue(null);
    asyncStorageMock.getItem.mockResolvedValue(null);
    render(
      <AuthProvider>
        <Probe />
        <TabLayout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(redirectHref()).toBe('/login');
    });
    expect(screen.queryByTestId('tabs-content')).toBeNull();
  });

  it('renders the tabs for a user without the flag', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe' });
    render(
      <AuthProvider>
        <Probe />
        <TabLayout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('tabs-content')).not.toBeNull();
    });
    expect(redirectHref()).toBeNull();
  });
});

describe('mid-session 403 PASSWORD_CHANGE_REQUIRED', () => {
  it('flips the flag and bounces the user out of the tabs', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe' });
    render(
      <AuthProvider>
        <Probe />
        <TabLayout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('tabs-content')).not.toBeNull();
    });

    // Admin resets the password mid-session: the next business request is
    // rejected with 403 PASSWORD_CHANGE_REQUIRED through the real pipeline.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        json403PasswordChangeRequired(String(input)),
      ),
    );
    await act(async () => {
      await expect(
        customFetch('https://api.example.com/employees/me'),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('tabs-content')).toBeNull();
      expect(redirectHref()).toBe('/change-password');
    });
    expect(latestAuth?.user).toMatchObject({ mustChangePassword: true });
    // Flag also persisted so an app restart can't skip the flow.
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      PROFILE_KEY,
      JSON.stringify({ id: 'u1', username: 'jdoe', mustChangePassword: true }),
    );
  });
});

describe('successful forced change', () => {
  it('clears the flag, lets the tabs render, and Done lands on the home tab', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe', mustChangePassword: true });
    render(
      <AuthProvider>
        <Probe />
        <WhenSignedIn>
          <ChangePasswordScreen />
        </WhenSignedIn>
        <TabLayout />
      </AuthProvider>,
    );
    // Guard active while the flag is set.
    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });
    // Forced mode: required hint visible, no close button.
    expect(screen.queryByTestId('text-password-change-required')).not.toBeNull();
    expect(screen.queryByTestId('button-close-change-password')).toBeNull();

    fireEvent.change(screen.getByTestId('input-current-password'), {
      target: { value: 'one-time-pw' },
    });
    fireEvent.change(screen.getByTestId('input-new-password'), {
      target: { value: 'N3w-Str0ng-Pass!' },
    });
    fireEvent.change(screen.getByTestId('input-confirm-password'), {
      target: { value: 'N3w-Str0ng-Pass!' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => json200(String(input), {})),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    // Flag cleared → the tabs guard no longer redirects.
    await waitFor(() => {
      expect(latestAuth?.user).toMatchObject({ mustChangePassword: false });
      expect(redirectHref()).toBeNull();
      expect(screen.queryByTestId('tabs-content')).not.toBeNull();
    });

    // Done from the success state replaces to the home tabs.
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-done-change-password'));
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('keeps the guard in place when the change fails (wrong current password)', async () => {
    primeStoredSession({ id: 'u1', username: 'jdoe', mustChangePassword: true });
    render(
      <AuthProvider>
        <Probe />
        <WhenSignedIn>
          <ChangePasswordScreen />
        </WhenSignedIn>
        <TabLayout />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });

    fireEvent.change(screen.getByTestId('input-current-password'), {
      target: { value: 'wrong' },
    });
    fireEvent.change(screen.getByTestId('input-new-password'), {
      target: { value: 'N3w-Str0ng-Pass!' },
    });
    fireEvent.change(screen.getByTestId('input-confirm-password'), {
      target: { value: 'N3w-Str0ng-Pass!' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => ({
        status: 401,
        ok: false,
        statusText: 'Unauthorized',
        url: String(input),
        headers: new Headers({ 'content-type': 'application/json' }),
        body: {},
        text: async () => JSON.stringify({ message: 'Unauthorized' }),
        clone() {
          return this;
        },
      }) as unknown as Response),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    // Still flagged, still redirected — and the session was NOT cleared
    // (change-password 401s are credential errors, not expiry).
    expect(latestAuth?.user).toMatchObject({ mustChangePassword: true });
    expect(redirectHref()).toBe('/change-password');
    expect(screen.queryByTestId('tabs-content')).toBeNull();
    expect(screen.queryByTestId('text-change-password-error')).not.toBeNull();
  });
});

describe('root layout guard (non-tab screens)', () => {
  // These tests exercise the guard in RootLayoutNav from app/_layout.tsx,
  // which is the only barrier protecting non-tab routes (notifications,
  // devices, admin-users, new-leave, payslip/[id], etc.) from a
  // mustChangePassword user who arrived via a deep link or a mid-session
  // admin reset while already on one of those screens.

  it('redirects a mustChangePassword user to /change-password from /notifications', async () => {
    mockPathname = '/notifications';
    primeStoredSession({ id: 'u1', username: 'jdoe', mustChangePassword: true });
    render(
      <AuthProvider>
        <Probe />
        <RootLayoutNav />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });
  });

  it('does not redirect a normal user on /notifications', async () => {
    mockPathname = '/notifications';
    primeStoredSession({ id: 'u1', username: 'jdoe' });
    render(
      <AuthProvider>
        <Probe />
        <RootLayoutNav />
      </AuthProvider>,
    );
    await waitFor(() => expect(latestAuth?.isLoading).toBe(false));
    expect(redirectHref()).toBeNull();
  });

  it('does not redirect a mustChangePassword user already on /change-password', async () => {
    mockPathname = '/change-password';
    primeStoredSession({ id: 'u1', username: 'jdoe', mustChangePassword: true });
    render(
      <AuthProvider>
        <Probe />
        <RootLayoutNav />
      </AuthProvider>,
    );
    await waitFor(() => expect(latestAuth?.isLoading).toBe(false));
    // No redirect loop — the guard exempts /change-password itself.
    expect(redirectHref()).toBeNull();
  });

  it('flips the flag mid-session on /notifications and redirects to /change-password', async () => {
    mockPathname = '/notifications';
    primeStoredSession({ id: 'u1', username: 'jdoe' });
    render(
      <AuthProvider>
        <Probe />
        <RootLayoutNav />
      </AuthProvider>,
    );
    await waitFor(() => expect(latestAuth?.isLoading).toBe(false));
    expect(redirectHref()).toBeNull();

    // Simulate mid-session admin reset: next business request returns 403
    // PASSWORD_CHANGE_REQUIRED which flips the flag via the global handler.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        json403PasswordChangeRequired(String(input)),
      ),
    );
    await act(async () => {
      await expect(
        customFetch('https://api.example.com/notifications'),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => {
      expect(redirectHref()).toBe('/change-password');
    });
    expect(latestAuth?.user).toMatchObject({ mustChangePassword: true });
  });
});
