/**
 * Regression coverage for session-expiry sign-out on mobile.
 *
 * The AuthProvider registers an unauthorized (401) handler on the shared API
 * client. Any 401 from a non-credential endpoint means the server session is
 * gone: the stored profile must be cleared so navigation guards return the
 * user to the sign-in screen. A 401 from /auth/login or /auth/change-password
 * is a credential error and must NOT sign the user out.
 *
 * These tests exercise the real customFetch pipeline (with a stubbed
 * `fetch`) against the real AuthProvider, so removing the handler
 * registration or the endpoint carve-outs fails the suite.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(async () => {}),
  removeItem: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));

import { AuthProvider, useAuth } from '../auth';
// customFetch is internal to the api-client package (not re-exported), so
// import it directly to drive real requests through the 401 handling path.
import {
  customFetch,
  ApiError,
} from '../../../../lib/api-client-react/src/custom-fetch';

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

let latestAuth: ReturnType<typeof useAuth> | null = null;

function Probe() {
  latestAuth = useAuth();
  return null;
}

async function renderSignedIn() {
  asyncStorageMock.getItem.mockResolvedValue(STORED_USER);
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
  asyncStorageMock.getItem.mockReset();
  asyncStorageMock.removeItem.mockClear();
  asyncStorageMock.setItem.mockClear();
});

afterEach(() => {
  cleanup(); // unmounts providers -> clears the unauthorized handler
  vi.unstubAllGlobals();
});

describe('AuthProvider 401 session-expiry handling', () => {
  it('clears the stored session and user on a 401 from a non-auth endpoint', async () => {
    await renderSignedIn();

    await fire401('https://api.example.com/employees/me');

    await waitFor(() => {
      expect(latestAuth?.user).toBeNull();
    });
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith('hrms-mobile-session');
  });

  it('keeps the session on a 401 from /auth/login (bad credentials)', async () => {
    await renderSignedIn();

    await fire401('https://api.example.com/auth/login');

    expect(latestAuth?.user).not.toBeNull();
    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it('keeps the session on a 401 from /auth/change-password (wrong current password)', async () => {
    await renderSignedIn();

    await fire401('https://api.example.com/auth/change-password');

    expect(latestAuth?.user).not.toBeNull();
    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it('stops clearing sessions after the provider unmounts (handler deregistered)', async () => {
    await renderSignedIn();
    cleanup();
    asyncStorageMock.removeItem.mockClear();

    await fire401('https://api.example.com/employees/me');

    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
  });
});
