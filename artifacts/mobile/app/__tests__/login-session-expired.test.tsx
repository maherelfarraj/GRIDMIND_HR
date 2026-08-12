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
