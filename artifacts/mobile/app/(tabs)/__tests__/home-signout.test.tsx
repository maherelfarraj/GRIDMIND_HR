/**
 * Smoke coverage for the HomeScreen sign-out button.
 *
 * Pressing "button-signout" must invoke the full auth logout path — clearing
 * the in-memory user, the session token from SecureStore, and the profile
 * cache from AsyncStorage — leaving the auth context in a signed-out state.
 *
 * This test catches regressions where the Pressable's onPress is removed or
 * disconnected from the real logout function. The button→logout binding is the
 * one thing the existing auth.test.tsx suite cannot catch because it exercises
 * the hook directly, not via any UI interaction.
 *
 * The test uses the real AuthProvider (with mocked storage) and renders the
 * real HomeScreen so the full chain is exercised: button press → logout
 * callback → storage wipe → user state → null.
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
// Storage mocks — must be hoisted so vi.mock factories can reference them.
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

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));
vi.mock('expo-secure-store', () => secureStoreMock);

// ---------------------------------------------------------------------------
// React Native component mocks → DOM equivalents
// ---------------------------------------------------------------------------

vi.mock('react-native', () => {
  const React = require('react');
  const passthrough =
    (tag: string) =>
    ({ children, testID, ...rest }: any) =>
      React.createElement('div', { 'data-testid': testID }, children);
  return {
    Platform: { OS: 'ios' },
    View: passthrough('div'),
    Text: passthrough('span'),
    ScrollView: passthrough('div'),
    FlatList: ({ data, renderItem, keyExtractor, ...rest }: any) => {
      return React.createElement(
        'div',
        null,
        (data ?? []).map((item: any, i: number) =>
          renderItem ? renderItem({ item, index: i }) : null,
        ),
      );
    },
    RefreshControl: () => null,
    Pressable: ({ children, testID, onPress }: any) =>
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
    StyleSheet: { create: (s: any) => s, absoluteFill: {} },
    ActivityIndicator: () => null,
  };
});

// ---------------------------------------------------------------------------
// Expo / navigation mocks
// ---------------------------------------------------------------------------

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
}));

vi.mock('expo-router', () => ({
  usePathname: () => '/(tabs)',
  useRouter: () => routerMock,
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
vi.mock('expo-blur', () => ({ BlurView: () => null }));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('expo-glass-effect', () => ({ isLiquidGlassAvailable: () => false }));
vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: any) =>
      React.createElement('div', null, children),
  };
});

// ---------------------------------------------------------------------------
// UI / hook mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000',
    foreground: '#fff',
    card: '#111',
    border: '#222',
    primary: '#0af',
    primaryForeground: '#fff',
    mutedForeground: '#888',
    destructive: '#f00',
    success: '#0f0',
    warning: '#fa0',
    radius: 8,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en' as const }),
}));

vi.mock('@/lib/privileged-session-review', () => ({
  canViewPrivilegedSessions: () => false,
}));

vi.mock('@/components/NotificationBell', () => ({
  NotificationBell: () => null,
}));

vi.mock('@/components/ui', () => {
  const React = require('react');
  const pass =
    (tag: string) =>
    ({ children, testID }: any) =>
      React.createElement(tag, { 'data-testid': testID }, children);
  return {
    AppButton: ({ testID, label, onPress, disabled }: any) =>
      React.createElement(
        'button',
        { 'data-testid': testID, onClick: onPress, disabled: !!disabled },
        label,
      ),
    Badge: pass('span'),
    Card: pass('div'),
    EmptyState: ({ message }: any) =>
      React.createElement('div', null, message),
    ErrorView: ({ message }: any) =>
      React.createElement('div', null, message),
    LangToggle: () => null,
    LoadingView: () => null,
    ScreenHeader: ({ title, right }: any) =>
      React.createElement(
        'div',
        null,
        React.createElement('span', null, title),
        right,
      ),
    SectionTitle: ({ title }: any) =>
      React.createElement('span', null, title),
  };
});

// Stub the React query hooks to return empty/loading state so the home screen
// renders without hitting the network. All non-hook exports (setAuthTokenGetter,
// loginUser, logoutUser, etc.) are preserved from the real module so the
// AuthProvider can register its token getter and handlers normally.
vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useGetUser: () => ({ data: undefined, isLoading: true }),
    useListLeaveBalances: () => ({ data: undefined, isLoading: true }),
    useListLeaveRequests: () => ({ data: undefined, isLoading: true }),
    useListPayrollPeriods: () => ({ data: undefined, isLoading: true }),
    useListPayrollRuns: () => ({ data: undefined, isLoading: true }),
    useListPrivilegedSessions: () => ({ data: undefined, isLoading: true }),
    useListPublicHolidays: () => ({ data: undefined, isLoading: true }),
  };
});

// ---------------------------------------------------------------------------
// Modules under test
// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from '@/lib/auth';
import HomeScreen from '../index';

const PROFILE_KEY = 'hrms-mobile-session';
const TOKEN_KEY = 'hrms-mobile-session-token';

const STORED_USER = JSON.stringify({
  id: 'u1',
  username: 'jdoe',
  role: 'employee',
  fullNameEn: 'Jane Doe',
  employeeId: null,
});

// Probe component captures the auth context value for assertions.
let latestAuth: ReturnType<typeof useAuth> | null = null;
function Probe() {
  latestAuth = useAuth();
  return null;
}

function make200Response(url: string, payload: unknown) {
  return {
    status: 200,
    ok: true,
    statusText: 'OK',
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {},
    text: async () => JSON.stringify(payload),
    clone() { return this; },
  } as unknown as Response;
}

// Render the HomeScreen inside the real AuthProvider with a seeded signed-in
// session so the full logout path is available for the button to invoke.
async function renderHomeSignedIn() {
  secureStoreMock.getItemAsync.mockResolvedValue('tok-hometest');
  asyncStorageMock.getItem.mockResolvedValue(STORED_USER);
  const stored = JSON.parse(STORED_USER) as Record<string, unknown>;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    make200Response(String(input), stored),
  ));

  render(
    <AuthProvider>
      <Probe />
      <HomeScreen />
    </AuthProvider>,
  );

  // Wait for the auth bootstrap to finish (token validated, user hydrated).
  await waitFor(() => {
    expect(latestAuth?.isLoading).toBe(false);
    expect(latestAuth?.user).not.toBeNull();
  });
}

beforeEach(() => {
  latestAuth = null;
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  asyncStorageMock.getItem.mockReset();
  asyncStorageMock.removeItem.mockClear();
  asyncStorageMock.setItem.mockClear();
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
});

afterEach(async () => {
  // Ensure any outstanding session is cleared so the module-level token
  // doesn't leak into the next test.
  if (latestAuth?.user) {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await act(async () => { await latestAuth!.logout(); });
  }
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomeScreen sign-out button', () => {
  it('renders the sign-out button when the user is signed in', async () => {
    await renderHomeSignedIn();
    expect(screen.getByTestId('button-signout')).toBeTruthy();
  });

  it('pressing the sign-out button clears the user state', async () => {
    await renderHomeSignedIn();
    expect(latestAuth?.user).not.toBeNull();

    // Make the server call in logout() succeed silently (or fail — doesn't matter).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-signout'));
    });

    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
  });

  it('pressing the sign-out button deletes the session token from SecureStore', async () => {
    await renderHomeSignedIn();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-signout'));
    });

    await waitFor(() => {
      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    });
  });

  it('pressing the sign-out button removes the cached profile from AsyncStorage', async () => {
    await renderHomeSignedIn();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-signout'));
    });

    await waitFor(() => {
      expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
    });
  });

  it('logout succeeds even when the server call fails (offline resilience)', async () => {
    await renderHomeSignedIn();

    // Simulate a fully offline device — server request throws.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network request failed');
    }));

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-signout'));
    });

    // Local sign-out must complete regardless of the network error.
    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
  });
});
