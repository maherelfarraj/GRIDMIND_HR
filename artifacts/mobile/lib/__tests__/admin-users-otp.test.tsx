/**
 * Regression: OTP show-once contract for the admin-users screen.
 *
 * The admin-users screen issues a one-time password in two steps:
 *   1. Confirm modal → POST /api/users/:id/one-time-password
 *   2. Show-once display → dismiss clears it from component state
 *
 * Guards proven here:
 * - The plaintext is never written to AsyncStorage or SecureStore.
 * - The POST carries Authorization: Bearer <token>.
 * - After dismissal the OTP element is gone from the tree.
 * - Cancelling the confirm modal never fires the POST.
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));
vi.mock('expo-secure-store', () => secureStoreMock);

vi.mock('react-native', () => {
  const React = require('react');
  return {
    Platform: { OS: 'ios' },
    View: ({ children, testID, style }: any) =>
      React.createElement('div', { 'data-testid': testID }, children),
    Text: ({ children, testID, selectable, style }: any) =>
      React.createElement('span', { 'data-testid': testID }, children),
    Pressable: ({ children, testID, onPress, style }: any) =>
      React.createElement(
        'button',
        { 'data-testid': testID, onClick: onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    // Modal renders children only when visible=true — mirrors native behaviour.
    Modal: ({ children, visible }: any) =>
      visible ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
    FlatList: ({ data, renderItem, ListEmptyComponent, keyExtractor }: any) => {
      if (!data || data.length === 0) {
        return ListEmptyComponent
          ? React.createElement('div', { 'data-testid': 'list-empty' }, ListEmptyComponent)
          : null;
      }
      return React.createElement(
        'div',
        { 'data-testid': 'flat-list' },
        data.map((item: any, i: number) =>
          React.createElement(
            'div',
            { key: keyExtractor ? keyExtractor(item) : i },
            renderItem({ item, index: i }),
          ),
        ),
      );
    },
    RefreshControl: () => null,
    ScrollView: ({ children }: any) => React.createElement('div', null, children),
    StyleSheet: { create: (s: any) => s, absoluteFill: {} },
    Animated: {
      View: ({ children }: any) => React.createElement('div', null, children),
      Value: class { setValue() {} },
    },
  };
});

vi.mock('expo-router', () => {
  const React = require('react');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement('div', { 'data-testid': 'redirect', 'data-href': href }),
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
    usePathname: () => '/(tabs)',
  };
});

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async () => {}),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

vi.mock('@/components/ui', () => {
  const React = require('react');
  return {
    AppButton: ({ testID, label, onPress, disabled, loading }: any) =>
      React.createElement(
        'button',
        { 'data-testid': testID, onClick: onPress, disabled: !!disabled || !!loading },
        label,
      ),
    Badge: () => null,
    Card: ({ children, style }: any) => React.createElement('div', null, children),
    EmptyState: () => React.createElement('div', { 'data-testid': 'empty-state' }),
    ErrorView: ({ onRetry }: any) =>
      React.createElement(
        'button',
        { 'data-testid': 'error-retry', onClick: onRetry },
        'Retry',
      ),
    LangToggle: () => null,
    LoadingView: () => React.createElement('div', { 'data-testid': 'loading-view' }),
    ScreenHeader: () => null,
  };
});

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
    warning: '#fa0',
    muted: '#333',
    radius: 8,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en' as const }),
}));

// ---------------------------------------------------------------------------
// Real modules under test
// ---------------------------------------------------------------------------

import { AuthProvider } from '../auth';
import AdminUsersScreen from '../../app/admin-users';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: 1,
  username: 'hradmin',
  roleNameEn: 'Super Administrator',
  fullNameEn: 'HR Admin',
  fullNameAr: null,
  isActive: true,
  mustChangePassword: false,
  lockedUntil: null,
};

const TARGET_USER = {
  id: 7,
  username: 'jdoe',
  roleNameEn: 'Employee',
  fullNameEn: 'John Doe',
  fullNameAr: null,
  isActive: true,
  mustChangePassword: false,
  lockedUntil: null,
};

const SESSION_TOKEN = 'tok-admin-456';
const ISSUED_OTP = 'otp-R4nd0mSecret!';

const TOKEN_KEY = 'hrms-mobile-session-token';
const PROFILE_KEY = 'hrms-mobile-session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

/** Prime the token and cached profile for a signed-in admin. */
function primeAdminSession() {
  secureStoreMock.getItemAsync.mockImplementation(async (key: string) =>
    key === TOKEN_KEY ? SESSION_TOKEN : null,
  );
  asyncStorageMock.getItem.mockImplementation(async (key: string) =>
    key === PROFILE_KEY
      ? JSON.stringify({
          id: ADMIN_USER.id,
          username: ADMIN_USER.username,
          roleNameEn: 'Super Administrator',
        })
      : null,
  );
}

/**
 * Build a fetch stub that handles all endpoints the screen calls.
 * Optionally fires `onOtpPost` when the one-time-password endpoint is hit
 * so callers can capture the request URL and headers.
 */
function makeFetchStub(
  onOtpPost?: (url: string, init: RequestInit | undefined) => void,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('one-time-password')) {
      onOtpPost?.(url, init);
      return json200(url, {
        username: TARGET_USER.username,
        oneTimePassword: ISSUED_OTP,
      });
    }
    // GET /api/users/:id — current user's role check
    if (/\/api\/users\/\d+$/.test(url)) return json200(url, ADMIN_USER);
    // GET /api/users — user list
    if (/\/api\/users(\?.*)?$/.test(url)) return json200(url, [TARGET_USER]);
    // /auth/me — session validation on bootstrap
    return json200(url, {
      id: ADMIN_USER.id,
      username: ADMIN_USER.username,
      roleNameEn: 'Super Administrator',
    });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryClient = makeQueryClient();
  asyncStorageMock.getItem.mockReset();
  asyncStorageMock.setItem.mockClear();
  asyncStorageMock.removeItem.mockClear();
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin-users OTP show-once contract', () => {
  it('drives confirm → POST → display → dismiss and proves bearer auth on the POST', async () => {
    primeAdminSession();

    let capturedUrl: string | undefined;
    let capturedHeaders: HeadersInit | undefined;

    vi.stubGlobal(
      'fetch',
      makeFetchStub((url, init) => {
        capturedUrl = url;
        capturedHeaders = init?.headers;
      }),
    );

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    // Wait for the user list to render the Issue OTP button.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`button-issue-otp-${TARGET_USER.id}`),
      ).not.toBeNull();
    });

    // Step 1: open the confirm modal.
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`button-issue-otp-${TARGET_USER.id}`),
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId('button-confirm-issue-otp')).not.toBeNull();
    });

    // Step 2: confirm → POST fires.
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-confirm-issue-otp'));
    });

    // Step 3: OTP display modal appears with the plaintext.
    await waitFor(() => {
      expect(screen.queryByTestId('text-issued-otp')).not.toBeNull();
    });
    expect(screen.getByTestId('text-issued-otp').textContent).toBe(ISSUED_OTP);

    // POST targeted the correct endpoint.
    expect(capturedUrl).toMatch(
      new RegExp(`/api/users/${TARGET_USER.id}/one-time-password$`),
    );

    // Request carried the session token as a Bearer header.
    const sentAuth = new Headers(
      capturedHeaders as HeadersInit,
    ).get('authorization');
    expect(sentAuth).toBe(`Bearer ${SESSION_TOKEN}`);

    // OTP plaintext never written to persistent storage at any point.
    const storedPayloads = [
      ...asyncStorageMock.setItem.mock.calls.map((c) => c.join('\x00')),
      ...secureStoreMock.setItemAsync.mock.calls.map((c) => c.join('\x00')),
    ].join('\n');
    expect(storedPayloads).not.toContain(ISSUED_OTP);

    // Step 4: dismiss → OTP element leaves the tree.
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-close-issued-otp'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('text-issued-otp')).toBeNull();
    });
  });

  it('OTP plaintext is absent from AsyncStorage and SecureStore while the modal is open', async () => {
    primeAdminSession();
    vi.stubGlobal('fetch', makeFetchStub());

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId(`button-issue-otp-${TARGET_USER.id}`),
      ).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`button-issue-otp-${TARGET_USER.id}`),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('button-confirm-issue-otp')).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-confirm-issue-otp'));
    });

    // The modal is showing the OTP.
    await waitFor(() => {
      expect(screen.queryByTestId('text-issued-otp')).not.toBeNull();
    });

    // Scan every write to both stores — none should contain the plaintext.
    for (const call of asyncStorageMock.setItem.mock.calls) {
      expect(call.join('\x00')).not.toContain(ISSUED_OTP);
    }
    for (const call of secureStoreMock.setItemAsync.mock.calls) {
      expect(call.join('\x00')).not.toContain(ISSUED_OTP);
    }
  });

  it('cancelling the confirm modal fires no POST and shows no OTP modal', async () => {
    primeAdminSession();
    const fetchStub = makeFetchStub();
    vi.stubGlobal('fetch', fetchStub);

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId(`button-issue-otp-${TARGET_USER.id}`),
      ).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`button-issue-otp-${TARGET_USER.id}`),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('button-cancel-issue-otp')).not.toBeNull();
    });

    // Count fetch calls before cancel.
    const callsBefore = fetchStub.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-cancel-issue-otp'));
    });

    // No new network calls after cancelling.
    expect(fetchStub.mock.calls.length).toBe(callsBefore);
    // OTP display modal never appeared.
    expect(screen.queryByTestId('text-issued-otp')).toBeNull();
    // Nothing written to persistent storage.
    expect(asyncStorageMock.setItem).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(ISSUED_OTP),
    );
  });
});
