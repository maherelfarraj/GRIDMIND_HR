/**
 * Tests for the shared useSignOut hook.
 *
 * The hook must:
 *  1. Return a stable callback that invokes auth logout when called.
 *  2. Set the logoutToast flag in AuthContext when the server call fails so
 *     the user gets feedback even though local sign-out completed.
 *  3. Complete local sign-out (clear user, token, profile cache) even when
 *     the server call fails.
 *
 * These tests use the real AuthProvider (with mocked storage) so the full
 * auth chain is exercised, not just the hook's internals.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Storage mocks — hoisted so vi.mock factories can reference them.
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
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockRouterReplace = vi.fn();
vi.mock('expo-router', () => ({
  usePathname: () => '/(tabs)',
  useRouter: () => ({ replace: mockRouterReplace }),
}));

// ---------------------------------------------------------------------------
// Modules under test
// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from '@/lib/auth';
import { useSignOut } from '../useSignOut';

const PROFILE_KEY = 'hrms-mobile-session';
const TOKEN_KEY = 'hrms-mobile-session-token';

const STORED_USER = JSON.stringify({
  id: 'u1',
  username: 'jdoe',
  role: 'employee',
  fullNameEn: 'Jane Doe',
  employeeId: null,
});

// Probe captures both the raw auth context and the hook's returned callback.
let latestAuth: ReturnType<typeof useAuth> | null = null;
let capturedSignOut: (() => Promise<void>) | null = null;

function Probe() {
  latestAuth = useAuth();
  capturedSignOut = useSignOut();
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

// Boot into a signed-in state: SecureStore returns a token, AsyncStorage
// returns a cached profile, and /auth/me (fetch) returns the same profile.
async function bootSignedIn() {
  secureStoreMock.getItemAsync.mockResolvedValue('tok-test');
  asyncStorageMock.getItem.mockResolvedValue(STORED_USER);
  const stored = JSON.parse(STORED_USER) as Record<string, unknown>;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    make200Response(String(input), stored),
  ));

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() => {
    expect(latestAuth?.isLoading).toBe(false);
    expect(latestAuth?.user).not.toBeNull();
  });
}

beforeEach(() => {
  latestAuth = null;
  capturedSignOut = null;
  mockRouterReplace.mockClear();
  asyncStorageMock.getItem.mockReset();
  asyncStorageMock.removeItem.mockClear();
  asyncStorageMock.setItem.mockClear();
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
});

afterEach(async () => {
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

describe('useSignOut hook', () => {
  it('returns a function', async () => {
    await bootSignedIn();
    expect(typeof capturedSignOut).toBe('function');
  });

  it('clears the user state when called', async () => {
    await bootSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => make200Response('/auth/logout', {})));

    await act(async () => { await capturedSignOut!(); });

    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
  });

  it('removes the session token from SecureStore', async () => {
    await bootSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => make200Response('/auth/logout', {})));

    await act(async () => { await capturedSignOut!(); });

    await waitFor(() => {
      expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    });
  });

  it('removes the cached profile from AsyncStorage', async () => {
    await bootSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => make200Response('/auth/logout', {})));

    await act(async () => { await capturedSignOut!(); });

    await waitFor(() => {
      expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
    });
  });

  it('sets logoutToast in AuthContext when the server call fails', async () => {
    await bootSignedIn();

    // Server call throws — simulates offline or 500.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network request failed');
    }));

    await act(async () => { await capturedSignOut!(); });

    // Local sign-out must have completed AND the toast flag must be set.
    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
      expect(latestAuth?.logoutToast).toBe(true);
    });
  });

  it('does NOT set logoutToast when the server call succeeds', async () => {
    await bootSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => make200Response('/auth/logout', {})));

    await act(async () => { await capturedSignOut!(); });

    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
    expect(latestAuth?.logoutToast).toBe(false);
  });

  it('completes local sign-out even when the server call fails', async () => {
    await bootSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network request failed');
    }));

    await act(async () => { await capturedSignOut!(); });

    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
  });
});
