/**
 * UI-level coverage for the ChangePassword screen's form validation.
 *
 * Confirms that:
 * - Mismatched passwords show an inline mismatch error and keep the submit
 *   button disabled (no API call is made).
 * - A too-short but syntactically matching password reaches the API; a 400
 *   response is surfaced as an inline error.
 * - A valid new password that matches the confirmation triggers the API call
 *   and transitions the screen to a success state.
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
// React Native → DOM mocks
// ---------------------------------------------------------------------------

vi.mock('react-native', () => {
  const React = require('react');
  return {
    Platform: { OS: 'ios' },
    View: ({ children, testID }: any) =>
      React.createElement('div', { 'data-testid': testID }, children),
    Text: ({ children, testID }: any) =>
      React.createElement('span', { 'data-testid': testID }, children),
    ScrollView: ({ children, testID }: any) =>
      React.createElement('div', { 'data-testid': testID }, children),
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

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

// ---------------------------------------------------------------------------
// App component / hook mocks
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
  };
});

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
    radius: 8,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en' as const }),
}));

const markPasswordChangedMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      username: 'jdoe',
      role: 'employee',
      fullNameEn: 'Jane Doe',
      employeeId: null,
      mustChangePassword: false,
    },
    markPasswordChanged: markPasswordChangedMock,
  }),
}));

// ---------------------------------------------------------------------------
// API client mock — ApiError must be a real class so `instanceof` works in
// the screen's catch block.
// ---------------------------------------------------------------------------

const changeMyPasswordMock = vi.fn();

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
  return {
    ApiError,
    changeMyPassword: (...args: any[]) => changeMyPasswordMock(...args),
  };
});

// ---------------------------------------------------------------------------
// Module under test (imported after all mocks are in place)
// ---------------------------------------------------------------------------

import ChangePasswordScreen from '../change-password';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillInputs(current: string, newPw: string, confirm: string) {
  fireEvent.change(screen.getByTestId('input-current-password'), {
    target: { value: current },
  });
  fireEvent.change(screen.getByTestId('input-new-password'), {
    target: { value: newPw },
  });
  fireEvent.change(screen.getByTestId('input-confirm-password'), {
    target: { value: confirm },
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  routerMock.replace.mockClear();
  routerMock.back.mockClear();
  routerMock.push.mockClear();
  markPasswordChangedMock.mockClear();
  changeMyPasswordMock.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChangePassword screen — form validation', () => {
  it('shows a mismatch error when new and confirm passwords differ', () => {
    render(<ChangePasswordScreen />);

    fillInputs('currentPass1!', 'NewPass1!', 'WrongPass1!');

    expect(screen.getByTestId('text-password-mismatch')).toBeTruthy();
  });

  it('keeps the submit button disabled when passwords do not match', () => {
    render(<ChangePasswordScreen />);

    fillInputs('currentPass1!', 'NewPass1!', 'WrongPass1!');

    const btn = screen.getByTestId(
      'button-submit-change-password',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('does not call the API when passwords are mismatched', async () => {
    render(<ChangePasswordScreen />);

    fillInputs('currentPass1!', 'NewPass1!', 'WrongPass1!');

    // Button is disabled, but even a forced click must not reach the API.
    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    expect(changeMyPasswordMock).not.toHaveBeenCalled();
  });

  it('shows an inline error when the API rejects a too-short password', async () => {
    const { ApiError } = await import(
      '@workspace/api-client-react'
    ) as any;
    changeMyPasswordMock.mockRejectedValueOnce(
      new ApiError(400, { error: 'Password must be at least 8 characters' }),
    );

    render(<ChangePasswordScreen />);
    // "abc" is too short but the values match — canSubmit is true, so the
    // form submits and the error comes back from the API.
    fillInputs('currentPass1!', 'abc', 'abc');

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('text-change-password-error')).toBeTruthy();
    });
    expect(changeMyPasswordMock).toHaveBeenCalledOnce();
  });

  it('does not show a success state while the too-short API error is visible', async () => {
    const { ApiError } = await import(
      '@workspace/api-client-react'
    ) as any;
    changeMyPasswordMock.mockRejectedValueOnce(
      new ApiError(400, { error: 'Password must be at least 8 characters' }),
    );

    render(<ChangePasswordScreen />);
    fillInputs('currentPass1!', 'abc', 'abc');

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('text-change-password-error')).toBeTruthy();
    });
    expect(
      screen.queryByTestId('button-done-change-password'),
    ).toBeNull();
  });

  it('calls the API with the correct payload for a valid matching password', async () => {
    changeMyPasswordMock.mockResolvedValueOnce(undefined);

    render(<ChangePasswordScreen />);
    fillInputs('currentPass1!', 'NewStr0ng!Pass', 'NewStr0ng!Pass');

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    await waitFor(() => {
      expect(changeMyPasswordMock).toHaveBeenCalledWith({
        currentPassword: 'currentPass1!',
        newPassword: 'NewStr0ng!Pass',
      });
    });
  });

  it('shows the success state after a valid password change', async () => {
    changeMyPasswordMock.mockResolvedValueOnce(undefined);

    render(<ChangePasswordScreen />);
    fillInputs('currentPass1!', 'NewStr0ng!Pass', 'NewStr0ng!Pass');

    await act(async () => {
      fireEvent.click(screen.getByTestId('button-submit-change-password'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('button-done-change-password')).toBeTruthy();
    });
  });
});
