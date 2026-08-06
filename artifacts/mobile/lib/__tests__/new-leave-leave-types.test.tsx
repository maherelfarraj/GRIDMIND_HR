/**
 * Regression test: leave type chips must appear on the New Leave Request screen.
 *
 * Root cause of the regression:
 *   useListLeaveTypes() fires on mount before the async readToken() bootstrap
 *   completes.  currentToken is still null at that point, so the request goes
 *   out without an Authorization header.  The server returns 401, but the 401
 *   handler returns early (sessionLiveRef.current === false during bootstrap)
 *   without navigating or clearing state.  leaveTypes.data stays undefined and
 *   the chip row renders empty with no visible error.
 *
 * Fix:
 *   Pass { query: { enabled: !authIsLoading } } to useListLeaveTypes() so the
 *   query only starts after the auth bootstrap has set currentToken.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));

vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

vi.mock('react-native', () => {
  const React = require('react');
  const passthrough =
    (tag: string) =>
    ({ children, testID, style, ...rest }: any) =>
      React.createElement(tag, { 'data-testid': testID }, children);
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
    StyleSheet: { create: (s: any) => s },
    ScrollView: ({ children }: any) => React.createElement('div', null, children),
  };
});

// Stub components that are not under test.
vi.mock('@/components/DateRangeCalendar', () => ({ DateRangeCalendarModal: () => null }));
vi.mock('@/components/KeyboardAwareScrollViewCompat', () => ({
  KeyboardAwareScrollViewCompat: ({ children, contentContainerStyle }: any) => {
    const React = require('react');
    return React.createElement('div', null, children);
  },
}));
vi.mock('@/components/ui', () => ({
  LoadingView: () => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'loading-view' }, 'Loading');
  },
  AppButton: ({ testID, label, disabled, onPress }: any) => {
    const React = require('react');
    return React.createElement(
      'button',
      { 'data-testid': testID, disabled, onClick: onPress },
      label,
    );
  },
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', card: '#f0f0f0', border: '#ccc',
    mutedForeground: '#999', primary: '#6366F1', primaryForeground: '#fff',
    destructive: '#f00', radius: 8,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en' }),
}));

// QueryClient mock – useQueryClient().invalidateQueries is a no-op.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));

// ---------------------------------------------------------------------------
// The two mocks we control per-test
// ---------------------------------------------------------------------------

const useAuthMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ useAuth: useAuthMock }));

const useListLeaveTypesMock = vi.hoisted(() => vi.fn());
const useCreateLeaveRequestMock = vi.hoisted(() =>
  vi.fn(() => ({ mutateAsync: vi.fn(async () => ({ id: 99 })) })),
);
const useSubmitLeaveRequestMock = vi.hoisted(() =>
  vi.fn(() => ({ mutateAsync: vi.fn(async () => {}) })),
);
const getListLeaveBalancesQueryKeyMock = vi.hoisted(() => vi.fn(() => ['leave-balances']));
const getListLeaveRequestsQueryKeyMock = vi.hoisted(() => vi.fn(() => ['leave-requests']));
vi.mock('@workspace/api-client-react', () => ({
  useListLeaveTypes: useListLeaveTypesMock,
  useCreateLeaveRequest: useCreateLeaveRequestMock,
  useSubmitLeaveRequest: useSubmitLeaveRequestMock,
  getListLeaveBalancesQueryKey: getListLeaveBalancesQueryKeyMock,
  getListLeaveRequestsQueryKey: getListLeaveRequestsQueryKeyMock,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_TYPES = [
  { id: 1, nameEn: 'Annual Leave', nameAr: 'إجازة سنوية', isActive: true },
  { id: 2, nameEn: 'Sick Leave', nameAr: 'إجازة مرضية', isActive: true },
  { id: 3, nameEn: 'Archived', nameAr: 'محفوظة', isActive: false },
];

function makeAuthReady(extra: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({
    user: { employeeId: 7 },
    isLoading: false,
    ...extra,
  });
}

function makeAuthLoading() {
  useAuthMock.mockReturnValue({ user: null, isLoading: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewLeaveScreen – leave type chips', () => {
  // Lazy import so mocks are applied before the module is evaluated.
  let NewLeaveScreen: typeof import('../../app/new-leave').default;

  beforeEach(async () => {
    vi.resetModules();
    routerMock.back.mockClear();
    routerMock.replace.mockClear();

    // Re-import after resetting modules so the factory functions re-run.
    // (Hoisted mocks survive resetModules and re-apply automatically.)
    const mod = await import('../../app/new-leave');
    NewLeaveScreen = mod.default;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders active leave type chips when auth is ready and the query succeeds', async () => {
    makeAuthReady();
    useListLeaveTypesMock.mockReturnValue({
      data: SAMPLE_TYPES,
      isLoading: false,
      isError: false,
    });

    render(React.createElement(NewLeaveScreen));

    // Both active types must appear.
    await waitFor(() => {
      expect(screen.getByTestId('chip-leave-type-1')).toBeTruthy();
      expect(screen.getByTestId('chip-leave-type-2')).toBeTruthy();
    });

    // The inactive type (id=3) must NOT appear.
    expect(screen.queryByTestId('chip-leave-type-3')).toBeNull();
  });

  it('does NOT fire the leave-types query while the auth bootstrap is in progress', () => {
    makeAuthLoading();

    // Capture the options passed to useListLeaveTypes.
    let capturedOptions: Record<string, unknown> | undefined;
    useListLeaveTypesMock.mockImplementation((opts: any) => {
      capturedOptions = opts;
      return { data: undefined, isLoading: true, isError: false };
    });

    render(React.createElement(NewLeaveScreen));

    // The query must be disabled so no request fires before currentToken is set.
    expect(capturedOptions?.query).toMatchObject({ enabled: false });
  });

  it('enables the leave-types query once auth bootstrap completes', () => {
    makeAuthReady();

    let capturedOptions: Record<string, unknown> | undefined;
    useListLeaveTypesMock.mockImplementation((opts: any) => {
      capturedOptions = opts;
      return { data: [], isLoading: false, isError: false };
    });

    render(React.createElement(NewLeaveScreen));

    expect(capturedOptions?.query).toMatchObject({ enabled: true });
  });

  it('shows an error message when the leave-types fetch fails', async () => {
    makeAuthReady();
    useListLeaveTypesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(React.createElement(NewLeaveScreen));

    await waitFor(() => {
      expect(screen.getByTestId('leave-types-error')).toBeTruthy();
    });

    // No chips should render when the fetch failed.
    expect(screen.queryByTestId('chip-leave-type-1')).toBeNull();
  });

  it('keeps the Submit button disabled until a chip is selected', async () => {
    makeAuthReady();
    useListLeaveTypesMock.mockReturnValue({
      data: SAMPLE_TYPES,
      isLoading: false,
      isError: false,
    });

    render(React.createElement(NewLeaveScreen));

    await waitFor(() => screen.getByTestId('chip-leave-type-1'));

    const submit = screen.getByTestId('button-submit-leave');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows LoadingView while the leave-types query is in-flight', async () => {
    makeAuthReady();
    useListLeaveTypesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(React.createElement(NewLeaveScreen));

    await waitFor(() => {
      expect(screen.getByTestId('loading-view')).toBeTruthy();
    });
  });
});
