/**
 * Login screen — session-expired banner regression.
 *
 * When the 401 unauthorized handler fires (session expiry) and navigates to
 * /login, the login screen must show the "session-expired-notice" banner so
 * users know why they landed there.
 *
 * Covered cases:
 * - Banner renders when sessionExpiredBanner is true (typical mid-session expiry).
 * - Banner renders when sessionExpiredBanner is true but expiredReturnTo is null
 *   (user was on an auth screen like /change-password when the session expired).
 * - Banner is absent when sessionExpiredBanner is false (voluntary sign-out or
 *   first-visit).
 * - clearSessionExpiredBanner is called after a successful login.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// React Native → DOM shims
// ---------------------------------------------------------------------------

vi.mock('react-native', () => {
  const React = require('react');
  return {
    Platform: { OS: 'ios' },
    View: ({ children, testID, style: _style }: any) =>
      React.createElement('div', { 'data-testid': testID }, children),
    Text: ({ children, testID }: any) =>
      React.createElement('span', { 'data-testid': testID }, children),
    TextInput: ({ testID, value, onChangeText, secureTextEntry: _s }: any) =>
      React.createElement('input', {
        'data-testid': testID,
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
    Pressable: ({ children, testID, onPress, style: _style, ...rest }: any) =>
      React.createElement('button', { 'data-testid': testID, onClick: onPress, ...rest }, children),
    Image: () => null,
    StyleSheet: { create: (s: any) => s },
    ActivityIndicator: () => null,
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ---------------------------------------------------------------------------
// Expo / navigation mocks
// ---------------------------------------------------------------------------

const routerMock = { replace: vi.fn() };
vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  Redirect: ({ href }: any) => null,
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

// ---------------------------------------------------------------------------
// App component mocks
// ---------------------------------------------------------------------------

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

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000',
    foreground: '#fff',
    card: '#111',
    border: '#222',
    mutedForeground: '#888',
    destructive: '#f00',
    radius: 8,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en' as const }),
}));

// ---------------------------------------------------------------------------
// Auth mock — parameterised per test
// ---------------------------------------------------------------------------

const loginMock = vi.fn();
const clearExpiredReturnToMock = vi.fn();
const clearSessionExpiredBannerMock = vi.fn();

let mockSessionExpiredBanner = false;
let mockExpiredReturnTo: string | null = null;
let mockUser: object | null = null;

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    login: loginMock,
    expiredReturnTo: mockExpiredReturnTo,
    clearExpiredReturnTo: clearExpiredReturnToMock,
    sessionExpiredBanner: mockSessionExpiredBanner,
    clearSessionExpiredBanner: clearSessionExpiredBannerMock,
  }),
}));

// ---------------------------------------------------------------------------
// API client mock
// ---------------------------------------------------------------------------

vi.mock('@workspace/api-client-react', () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, data: unknown) {
      super(`ApiError ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return { ApiError };
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import LoginScreen from '../login';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSessionExpiredBanner = false;
  mockExpiredReturnTo = null;
  mockUser = null;
  loginMock.mockReset();
  clearExpiredReturnToMock.mockClear();
  clearSessionExpiredBannerMock.mockClear();
  routerMock.replace.mockClear();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Login screen — session-expired banner', () => {
  it('shows the session-expired-notice banner when sessionExpiredBanner is true', () => {
    mockSessionExpiredBanner = true;
    mockExpiredReturnTo = '/notifications';

    render(<LoginScreen />);

    expect(screen.getByTestId('session-expired-notice')).toBeDefined();
    // The banner text key is rendered via t('sessionExpiredNotice')
    expect(screen.getByText('sessionExpiredNotice')).toBeDefined();
  });

  it('shows the banner even when expiredReturnTo is null (e.g. expired on /change-password)', () => {
    // This is the gap the new sessionExpiredBanner flag closes: the banner
    // must appear even when there is no return destination.
    mockSessionExpiredBanner = true;
    mockExpiredReturnTo = null;

    render(<LoginScreen />);

    expect(screen.getByTestId('session-expired-notice')).toBeDefined();
  });

  it('does NOT show the banner when sessionExpiredBanner is false (voluntary sign-out or fresh visit)', () => {
    mockSessionExpiredBanner = false;
    mockExpiredReturnTo = null;

    render(<LoginScreen />);

    expect(screen.queryByTestId('session-expired-notice')).toBeNull();
  });

  it('calls clearSessionExpiredBanner and clearExpiredReturnTo when the dismiss button is tapped', async () => {
    mockSessionExpiredBanner = true;
    mockExpiredReturnTo = '/notifications';

    render(<LoginScreen />);

    // The dismiss button must be present inside the banner.
    const dismissBtn = screen.getByTestId('button-dismiss-session-expired');
    expect(dismissBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(clearSessionExpiredBannerMock).toHaveBeenCalledTimes(1);
    expect(clearExpiredReturnToMock).toHaveBeenCalledTimes(1);
    // The router must NOT be called — dismissing just hides the notice.
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('banner stays hidden after dismiss and remount (flag is not reset on screen mount)', async () => {
    // This test mimics the real AuthContext: the sessionExpiredBanner flag
    // lives in a provider that outlives individual screen mounts. Dismissing
    // the banner must update that provider state (via clearSessionExpiredBanner)
    // so that when LoginScreen unmounts and remounts (back-navigation) the
    // banner is still absent — i.e. the flag is NOT reset on screen mount.

    // A stateful wrapper that acts as the persistent AuthContext provider.
    // It holds `banner` in React state so that clearSessionExpiredBanner
    // triggers a genuine React re-render — not just a module-variable swap.
    function AuthStateWrapper({ showLogin }: { showLogin: boolean }) {
      const [banner, setBanner] = React.useState(true);

      // Sync the React state to the module-level variable so useAuth() picks
      // it up on every render of LoginScreen (reads mockSessionExpiredBanner).
      mockSessionExpiredBanner = banner;

      // Wire the mock dismiss callback to update React state, mirroring how
      // clearSessionExpiredBanner calls setSessionExpiredBanner(false) in the
      // real AuthProvider. This runs on first mount; no deps change after that.
      React.useEffect(() => {
        clearSessionExpiredBannerMock.mockImplementation(() => {
          setBanner(false);
        });
        return () => {
          // Restore the no-op default so other tests are unaffected.
          clearSessionExpiredBannerMock.mockReset();
        };
      }, []);

      // Swap LoginScreen in/out to simulate navigation away and back while
      // keeping this wrapper (the "provider") mounted throughout.
      return showLogin ? <LoginScreen /> : <div data-testid="other-screen" />;
    }

    const { rerender } = render(<AuthStateWrapper showLogin={true} />);

    // Banner is visible on the first render.
    expect(screen.getByTestId('session-expired-notice')).toBeDefined();

    // User taps dismiss — this calls clearSessionExpiredBanner which (via the
    // mock implementation above) calls setBanner(false), triggering a re-render.
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-dismiss-session-expired'));
    });

    // Immediately after dismiss the banner must disappear (React state = false).
    expect(screen.queryByTestId('session-expired-notice')).toBeNull();
    expect(clearSessionExpiredBannerMock).toHaveBeenCalledTimes(1);

    // Simulate navigating away — unmount LoginScreen but keep the wrapper alive.
    rerender(<AuthStateWrapper showLogin={false} />);
    expect(screen.getByTestId('other-screen')).toBeDefined();

    // Navigate back — remount LoginScreen while the wrapper still holds banner=false.
    rerender(<AuthStateWrapper showLogin={true} />);

    // The banner must NOT reappear. The flag lives in context state (the wrapper),
    // not in LoginScreen itself, so remounting the screen cannot reset it.
    expect(screen.queryByTestId('session-expired-notice')).toBeNull();
  });

  it('calls clearSessionExpiredBanner after a successful login', async () => {
    mockSessionExpiredBanner = true;
    mockExpiredReturnTo = '/approvals';
    loginMock.mockResolvedValue(undefined);

    render(<LoginScreen />);

    fireEvent.change(screen.getByTestId('input-username'), {
      target: { value: 'jdoe' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'secret123' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-login'));
    });

    await waitFor(() => {
      expect(clearSessionExpiredBannerMock).toHaveBeenCalledTimes(1);
    });
  });
});
