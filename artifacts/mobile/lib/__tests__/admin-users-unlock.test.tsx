/**
 * Regression: admin-users highlight param + unlock flow.
 *
 * Guards proven here:
 * - Rendering with highlight=<username> marks the matching row (borderWidth 2
 *   on its Card) and shows the Unlock button for locked accounts.
 * - Pressing Unlock fires POST /users/:id/unlock and, on success, invalidates
 *   the list query so the badge and button clear immediately.
 * - A failed unlock shows the error banner (testID text-unlock-error) without
 *   touching the list.
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

// highlight param controlled per-test via this ref.
const searchParams: { highlight?: string } = {};

vi.mock('expo-router', () => {
  const React = require('react');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement('div', { 'data-testid': 'redirect', 'data-href': href }),
    useLocalSearchParams: () => searchParams,
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
    /**
     * Card exposes a `data-highlighted` attribute when its style carries a
     * borderWidth of 2 — the exact value the screen sets on highlighted rows.
     * This lets the test assert row highlighting without reading inline styles.
     */
    Card: ({ children, style }: any) => {
      const highlighted =
        style && typeof style === 'object' && (style as any).borderWidth === 2
          ? 'true'
          : undefined;
      return React.createElement(
        'div',
        { 'data-highlighted': highlighted },
        children,
      );
    },
    AppButton: ({ testID, label, onPress, disabled, loading }: any) =>
      React.createElement(
        'button',
        { 'data-testid': testID, onClick: onPress, disabled: !!disabled || !!loading },
        label,
      ),
    Badge: () => null,
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

// A locked account that should show the Unlock button and be highlightable.
const LOCKED_USER = {
  id: 9,
  username: 'jlocked',
  roleNameEn: 'Employee',
  fullNameEn: 'Jane Locked',
  fullNameAr: null,
  isActive: true,
  mustChangePassword: false,
  // Set well into the future so `lockedUntil > Date.now()` is always true.
  lockedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const SESSION_TOKEN = 'tok-admin-999';
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

function json500(url: string) {
  return {
    status: 500,
    ok: false,
    statusText: 'Internal Server Error',
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {},
    text: async () => JSON.stringify({ message: 'server error' }),
    clone() {
      return this;
    },
  } as unknown as Response;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

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
 * Build a fetch stub. Pass overrides to control individual endpoint responses.
 *
 * @param unlockResponse - override the POST /unlock response (default: 200 {})
 * @param onUnlockPost   - spy called with (url, init) when the unlock endpoint fires
 */
function makeFetchStub(
  {
    unlockResponse,
    onUnlockPost,
    listUsers,
  }: {
    unlockResponse?: Response;
    onUnlockPost?: (url: string, init: RequestInit | undefined) => void;
    listUsers?: unknown[];
  } = {},
): ReturnType<typeof vi.fn> {
  const users = listUsers ?? [LOCKED_USER];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/unlock')) {
      onUnlockPost?.(url, init);
      return unlockResponse ?? json200(url, {});
    }
    if (/\/api\/users\/\d+$/.test(url)) return json200(url, ADMIN_USER);
    if (/\/api\/users(\?.*)?$/.test(url)) return json200(url, users);
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
  // Reset search params before each test.
  delete searchParams.highlight;
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin-users highlight param + unlock flow', () => {
  it('marks the highlighted row and shows the Unlock button for the locked user', async () => {
    primeAdminSession();
    searchParams.highlight = LOCKED_USER.username;
    vi.stubGlobal('fetch', makeFetchStub());

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    // Wait for the list to render the Unlock button.
    await waitFor(() => {
      expect(screen.queryByTestId(`button-unlock-${LOCKED_USER.id}`)).not.toBeNull();
    });

    // Unlock button is visible for the locked user.
    expect(screen.getByTestId(`button-unlock-${LOCKED_USER.id}`)).toBeTruthy();

    // The Card for the locked user carries data-highlighted="true" because the
    // username matches the highlight search param.
    const cards = document.querySelectorAll('[data-highlighted="true"]');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('does not mark the row as highlighted when the highlight param is absent', async () => {
    primeAdminSession();
    // No highlight param set.
    vi.stubGlobal('fetch', makeFetchStub());

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId(`button-unlock-${LOCKED_USER.id}`)).not.toBeNull();
    });

    // No card should carry the highlighted attribute.
    const cards = document.querySelectorAll('[data-highlighted="true"]');
    expect(cards.length).toBe(0);
  });

  it('does not show the Unlock button for an unlocked user even when highlighted', async () => {
    primeAdminSession();
    // List contains only the admin (not locked).
    searchParams.highlight = ADMIN_USER.username;
    vi.stubGlobal('fetch', makeFetchStub({ listUsers: [ADMIN_USER] }));

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    // Wait for the Issue OTP button (which always renders) to confirm the list loaded.
    await waitFor(() => {
      expect(screen.queryByTestId(`button-issue-otp-${ADMIN_USER.id}`)).not.toBeNull();
    });

    // Unlock button must NOT be present for an unlocked user.
    expect(screen.queryByTestId(`button-unlock-${ADMIN_USER.id}`)).toBeNull();
  });

  it('Unlock success fires POST and invalidates the list query (triggering a refetch)', async () => {
    primeAdminSession();
    searchParams.highlight = LOCKED_USER.username;

    let unlockCalled = false;
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;
    let listFetchCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/unlock')) {
          unlockCalled = true;
          capturedUrl = url;
          capturedHeaders = init?.headers;
          return json200(url, {});
        }
        if (/\/api\/users\/\d+$/.test(url)) return json200(url, ADMIN_USER);
        if (/\/api\/users(\?.*)?$/.test(url)) {
          listFetchCount++;
          return json200(url, [LOCKED_USER]);
        }
        return json200(url, {
          id: ADMIN_USER.id,
          username: ADMIN_USER.username,
          roleNameEn: 'Super Administrator',
        });
      }),
    );

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId(`button-unlock-${LOCKED_USER.id}`)).not.toBeNull();
    });

    const fetchCountBeforeUnlock = listFetchCount;

    await act(async () => {
      fireEvent.click(screen.getByTestId(`button-unlock-${LOCKED_USER.id}`));
    });

    // The POST /users/:id/unlock was fired.
    await waitFor(() => {
      expect(unlockCalled).toBe(true);
    });

    expect(capturedUrl).toMatch(
      new RegExp(`/api/users/${LOCKED_USER.id}/unlock$`),
    );

    // The request carried the admin's session token.
    const sentAuth = new Headers(capturedHeaders as HeadersInit).get('authorization');
    expect(sentAuth).toBe(`Bearer ${SESSION_TOKEN}`);

    // After success the list query is invalidated → at least one more GET /users.
    await waitFor(() => {
      expect(listFetchCount).toBeGreaterThan(fetchCountBeforeUnlock);
    });

    // No unlock error banner.
    expect(screen.queryByTestId('text-unlock-error')).toBeNull();
  });

  it('Unlock failure shows the error banner and does not clear the Unlock button', async () => {
    primeAdminSession();
    searchParams.highlight = LOCKED_USER.username;

    vi.stubGlobal(
      'fetch',
      makeFetchStub({ unlockResponse: json500('/api/users/9/unlock') }),
    );

    render(
      <Wrapper>
        <AdminUsersScreen />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId(`button-unlock-${LOCKED_USER.id}`)).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId(`button-unlock-${LOCKED_USER.id}`));
    });

    // Error banner must appear after the failed mutation.
    await waitFor(() => {
      expect(screen.queryByTestId('text-unlock-error')).not.toBeNull();
    });

    // The Unlock button is still visible (the user is still locked).
    expect(screen.queryByTestId(`button-unlock-${LOCKED_USER.id}`)).not.toBeNull();
  });
});
