/**
 * Regression coverage for secure mobile sessions.
 *
 * The AuthProvider must never trust a stored profile on its own:
 * - login opts in to bearer-token transport, stores the session token in
 *   SecureStore, and caches the profile (without the token) in AsyncStorage;
 * - on startup, a missing token means signed-out even if a cached profile
 *   exists; with a token, the server is asked (/auth/me) to validate it;
 * - every API request carries `Authorization: Bearer <token>`;
 * - any 401 from a non-credential endpoint clears the token and profile.
 *
 * These tests exercise the real customFetch pipeline (with a stubbed
 * `fetch`) against the real AuthProvider, so removing the handler
 * registration, the token getter, or the endpoint carve-outs fails the suite.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';

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
// usePathname/useRouter are used inside AuthProvider for route tracking and
// imperative navigation on session expiry. Tests supply controllable values.
let mockPathname = '/(tabs)';
const mockRouterReplace = vi.fn();
vi.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockRouterReplace }),
}));

import { AuthProvider, useAuth } from '../auth';
// customFetch is internal to the api-client package (not re-exported), so
// import it directly to drive real requests through the 401 handling path.
import {
  customFetch,
  ApiError,
} from '../../../../lib/api-client-react/src/custom-fetch';

const PROFILE_KEY = 'hrms-mobile-session';
const TOKEN_KEY = 'hrms-mobile-session-token';

const STORED_USER = JSON.stringify({
  id: 'u1',
  username: 'jdoe',
  role: 'employee',
});

function make401Response(url: string) {
  const response = {
    status: 401,
    ok: false,
    statusText: 'Unauthorized',
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: async () => JSON.stringify({ message: 'Unauthorized' }),
    clone() {
      return this;
    },
  };
  return response as unknown as Response;
}

function make200Response(url: string, payload: unknown) {
  const response = {
    status: 200,
    ok: true,
    statusText: 'OK',
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    // Non-null body: customFetch treats `body === null` as an empty response.
    body: {},
    text: async () => JSON.stringify(payload),
    clone() {
      return this;
    },
  };
  return response as unknown as Response;
}

let latestAuth: ReturnType<typeof useAuth> | null = null;

function Probe() {
  latestAuth = useAuth();
  return null;
}

/**
 * Render with a stored token + validated session. `/auth/me` returns a
 * successful profile so the session latch (sessionLiveRef) is armed — which
 * is required for the 401 handler to treat subsequent failures as mid-session
 * expiry rather than bootstrap noise.
 */
async function renderSignedIn() {
  secureStoreMock.getItemAsync.mockResolvedValue('tok-123');
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

async function renderSignedOut() {
  secureStoreMock.getItemAsync.mockResolvedValue(null);
  asyncStorageMock.getItem.mockResolvedValue(null);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => {
    expect(latestAuth?.isLoading).toBe(false);
  });
}

async function fire401(url: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => make401Response(url)),
  );
  await act(async () => {
    await expect(customFetch(url)).rejects.toBeInstanceOf(ApiError);
  });
}

beforeEach(() => {
  latestAuth = null;
  mockPathname = '/(tabs)';
  mockRouterReplace.mockClear();
  asyncStorageMock.getItem.mockReset();
  asyncStorageMock.removeItem.mockClear();
  asyncStorageMock.setItem.mockClear();
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
});

afterEach(async () => {
  // Sign out so the module-level token doesn't leak between tests.
  if (latestAuth?.user) {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    await act(async () => {
      await latestAuth!.logout();
    });
  }
  cleanup(); // unmounts providers -> clears the unauthorized handler
  vi.unstubAllGlobals();
});

describe('AuthProvider bootstrap', () => {
  it('does NOT trust a cached profile when no session token is stored', async () => {
    secureStoreMock.getItemAsync.mockResolvedValue(null);
    asyncStorageMock.getItem.mockResolvedValue(STORED_USER);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(latestAuth?.isLoading).toBe(false);
    });
    expect(latestAuth?.user).toBeNull();
    // The untrusted cached profile is dropped.
    await waitFor(() => {
      expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
    });
  });

  it('validates a stored token against /auth/me and adopts the fresh profile', async () => {
    secureStoreMock.getItemAsync.mockResolvedValue('tok-abc');
    asyncStorageMock.getItem.mockResolvedValue(STORED_USER);
    const fresh = { id: 'u1', username: 'jdoe', fullNameEn: 'John Doe' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      make200Response(String(input), fresh),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(latestAuth?.isLoading).toBe(false);
      expect(latestAuth?.user).toMatchObject(fresh);
    });

    // The validation request carried the bearer token.
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok-abc');
  });
});

describe('AuthProvider login', () => {
  it('stores the session token in SecureStore and the profile (without token) in AsyncStorage', async () => {
    await renderSignedOut();
    expect(latestAuth?.user).toBeNull();

    const authUser = { id: 'u2', username: 'asmith', sessionToken: 'tok-999' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      make200Response(String(input), authUser),
    );
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      await latestAuth!.login('asmith', 'correct-password');
    });

    await waitFor(() => {
      expect(latestAuth?.user).toMatchObject({ id: 'u2', username: 'asmith' });
    });

    // Opted in to bearer transport.
    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(new Headers(init.headers).get('x-session-transport')).toBe('bearer');

    // Token → SecureStore only; profile cache never contains the token.
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(TOKEN_KEY, 'tok-999');
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      PROFILE_KEY,
      JSON.stringify({ id: 'u2', username: 'asmith' }),
    );

    // Subsequent API calls carry the token.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init2?: RequestInit) => {
      expect(new Headers(init2?.headers).get('authorization')).toBe('Bearer tok-999');
      return make200Response(String(input), []);
    }));
    await customFetch('https://api.example.com/employees');
  });

  it('rejects a login response that lacks a session token', async () => {
    await renderSignedOut();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        make200Response(String(input), { id: 'u2', username: 'asmith' }),
      ),
    );
    await act(async () => {
      await expect(latestAuth!.login('asmith', 'pw')).rejects.toThrow(
        /session token/,
      );
    });
    expect(latestAuth?.user).toBeNull();
    expect(secureStoreMock.setItemAsync).not.toHaveBeenCalled();
  });

  it('does not persist anything when login fails with bad credentials', async () => {
    await renderSignedOut();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => make401Response('https://api.example.com/auth/login')),
    );

    await act(async () => {
      await expect(latestAuth!.login('asmith', 'wrong')).rejects.toBeInstanceOf(
        ApiError,
      );
    });

    expect(latestAuth?.user).toBeNull();
    expect(asyncStorageMock.setItem).not.toHaveBeenCalled();
    expect(secureStoreMock.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('AuthProvider forced password change', () => {
  it('markPasswordChanged clears the flag on the user and the cached profile', async () => {
    secureStoreMock.getItemAsync.mockResolvedValue('tok-123');
    asyncStorageMock.getItem.mockResolvedValue(
      JSON.stringify({ id: 'u1', username: 'jdoe', mustChangePassword: true }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network request failed');
    }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(latestAuth?.user).toMatchObject({ mustChangePassword: true });
    });

    await act(async () => {
      latestAuth!.markPasswordChanged();
    });

    expect(latestAuth?.user).toMatchObject({ mustChangePassword: false });
    // Cached profile is updated too, so a restart doesn't resurrect the flag.
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      PROFILE_KEY,
      JSON.stringify({ id: 'u1', username: 'jdoe', mustChangePassword: false }),
    );
  });
});

describe('AuthProvider logout', () => {
  it('clears the user, token, and cached profile (even when the server call fails)', async () => {
    await renderSignedIn();

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    await act(async () => {
      await latestAuth!.logout();
    });

    expect(latestAuth?.user).toBeNull();
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
  });
});

describe('AuthProvider 401 session-expiry handling', () => {
  it('clears the token, cached profile, and user on a 401 from a non-auth endpoint', async () => {
    await renderSignedIn();

    await fire401('https://api.example.com/employees/me');

    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
  });

  it('keeps the session on a 401 from /auth/login (bad credentials)', async () => {
    await renderSignedIn();

    await fire401('https://api.example.com/auth/login');

    expect(latestAuth?.user).not.toBeNull();
    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('keeps the session on a 401 from /auth/change-password (wrong current password)', async () => {
    await renderSignedIn();

    await fire401('https://api.example.com/auth/change-password');

    expect(latestAuth?.user).not.toBeNull();
    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('stops clearing sessions after the provider unmounts (handler deregistered)', async () => {
    await renderSignedIn();
    // Sign out cleanly first so afterEach doesn't double-logout.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    await act(async () => {
      await latestAuth!.logout();
    });
    cleanup();
    asyncStorageMock.removeItem.mockClear();
    secureStoreMock.deleteItemAsync.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => make401Response('https://api.example.com/employees/me')),
    );
    await expect(
      customFetch('https://api.example.com/employees/me'),
    ).rejects.toBeInstanceOf(ApiError);

    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
  });
});

describe('AuthProvider sessionExpiredBanner', () => {
  it('is set to true when a 401 fires from a non-auth endpoint', async () => {
    mockPathname = '/(tabs)';
    await renderSignedIn();

    await fire401('https://api.example.com/employees/me');

    await waitFor(() => {
      expect(latestAuth?.sessionExpiredBanner).toBe(true);
    });
  });

  it('is set to true even when expiredReturnTo is null (user was on an auth screen)', async () => {
    // When the user is on /change-password and their session expires the 401
    // handler sets expiredReturnTo to null (auth screen isn't a useful
    // return destination), but the session-expired banner must still show.
    mockPathname = '/change-password';
    await renderSignedIn();

    await fire401('https://api.example.com/employees/me');

    await waitFor(() => { expect(latestAuth?.user).toBeNull(); });
    expect(latestAuth?.expiredReturnTo).toBeNull();
    expect(latestAuth?.sessionExpiredBanner).toBe(true);
  });

  it('is not set on a credential-check 401 (/auth/login)', async () => {
    mockPathname = '/(tabs)';
    await renderSignedIn();

    await fire401('https://api.example.com/auth/login');

    expect(latestAuth?.sessionExpiredBanner).toBe(false);
  });

  it('is not set on a credential-check 401 (/auth/change-password)', async () => {
    mockPathname = '/(tabs)';
    await renderSignedIn();

    await fire401('https://api.example.com/auth/change-password');

    expect(latestAuth?.sessionExpiredBanner).toBe(false);
  });

  it('is not set on a voluntary logout', async () => {
    await renderSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await act(async () => { await latestAuth!.logout(); });
    expect(latestAuth?.sessionExpiredBanner).toBe(false);
  });

  it('clearSessionExpiredBanner resets the value to false', async () => {
    mockPathname = '/(tabs)';
    await renderSignedIn();
    await fire401('https://api.example.com/employees/me');
    await waitFor(() => { expect(latestAuth?.sessionExpiredBanner).toBe(true); });

    await act(async () => { latestAuth!.clearSessionExpiredBanner(); });
    expect(latestAuth?.sessionExpiredBanner).toBe(false);
  });
});

describe('AuthProvider expiredReturnTo', () => {
  it('captures the current route as expiredReturnTo on session expiry', async () => {
    mockPathname = '/notifications';
    await renderSignedIn();

    await fire401('https://api.example.com/employees/me');

    await waitFor(() => {
      expect(latestAuth?.expiredReturnTo).toBe('/notifications');
    });
  });

  it('does not capture /login or /change-password as expiredReturnTo', async () => {
    mockPathname = '/login';
    await renderSignedIn();
    await fire401('https://api.example.com/employees/me');
    await waitFor(() => { expect(latestAuth?.user).toBeNull(); });
    expect(latestAuth?.expiredReturnTo).toBeNull();
  });

  it('does not set expiredReturnTo on credential-check 401s', async () => {
    mockPathname = '/(tabs)';
    await renderSignedIn();
    await fire401('https://api.example.com/auth/login');
    expect(latestAuth?.expiredReturnTo).toBeNull();
  });

  it('clearExpiredReturnTo resets the value to null', async () => {
    mockPathname = '/approvals';
    await renderSignedIn();
    await fire401('https://api.example.com/employees/me');
    await waitFor(() => { expect(latestAuth?.expiredReturnTo).toBe('/approvals'); });

    await act(async () => { latestAuth!.clearExpiredReturnTo(); });
    expect(latestAuth?.expiredReturnTo).toBeNull();
  });

  it('does not set expiredReturnTo on a voluntary logout', async () => {
    mockPathname = '/(tabs)/approvals';
    await renderSignedIn();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await act(async () => { await latestAuth!.logout(); });
    expect(latestAuth?.expiredReturnTo).toBeNull();
  });

  it('navigates to /login imperatively so unguarded screens are covered', async () => {
    mockPathname = '/notifications';
    await renderSignedIn();

    await fire401('https://api.example.com/employees/me');

    await waitFor(() => { expect(latestAuth?.user).toBeNull(); });
    expect(mockRouterReplace).toHaveBeenCalledWith('/login');
  });

  it('only the first concurrent 401 captures the route (latch prevents overwrite)', async () => {
    mockPathname = '/devices';
    await renderSignedIn();

    // Simulate two in-flight requests that both receive a 401.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => make401Response('https://api.example.com/api')),
    );
    await act(async () => {
      await Promise.allSettled([
        customFetch('https://api.example.com/api/first'),
        customFetch('https://api.example.com/api/second'),
      ]);
    });

    await waitFor(() => { expect(latestAuth?.user).toBeNull(); });
    // Route captured from the first 401; second was suppressed by the latch.
    expect(latestAuth?.expiredReturnTo).toBe('/devices');
    // router.replace called exactly once — not twice.
    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith('/login');
  });
});
