// @vitest-environment jsdom
/**
 * Guards the org-fetch interceptor contract: X-Org-Id must never be attached
 * to /api/auth/* endpoints, even when a stale org ID is stored in localStorage.
 *
 * Background: the login request runs before a session exists, so attaching
 * X-Org-Id causes the server to reject it with "Authentication required to
 * select an organization context", silently breaking the login page for any
 * user who previously selected an org.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ORG_STORAGE_KEY, getActiveOrgId } from '../org-fetch';

// We re-import the module fresh each test to reset the `installed` flag.
// vitest's module isolation via vi.resetModules() + dynamic import achieves this.

async function freshInstall() {
  vi.resetModules();
  const { installOrgFetch } = await import('../org-fetch');
  installOrgFetch();
}

describe('installOrgFetch — auth route exclusion', () => {
  let capturedRequests: Array<{ url: string; headers: Headers }> = [];

  beforeEach(async () => {
    capturedRequests = [];

    // Provide a minimal localStorage shim
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });

    // Stub window.fetch to capture calls without making real network requests
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input :
        input instanceof URL ? input.toString() :
        (input as Request).url;
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      capturedRequests.push({ url, headers });
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    // Store a stale org ID — this is what triggers the bug
    localStorage.setItem(ORG_STORAGE_KEY, '42');

    await freshInstall();
  });

  it('does NOT attach X-Org-Id to POST /api/auth/login', async () => {
    await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].headers.has('X-Org-Id')).toBe(false);
  });

  it('does NOT attach X-Org-Id to POST /api/auth/logout', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });

    expect(capturedRequests[0].headers.has('X-Org-Id')).toBe(false);
  });

  it('does NOT attach X-Org-Id to GET /api/auth/me', async () => {
    await fetch('/api/auth/me');

    expect(capturedRequests[0].headers.has('X-Org-Id')).toBe(false);
  });

  it('does NOT attach X-Org-Id to any /api/auth/* path', async () => {
    const authPaths = [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/auth/refresh',
    ];

    for (const path of authPaths) {
      await fetch(path);
    }

    for (const req of capturedRequests) {
      expect(req.headers.has('X-Org-Id')).toBe(false);
    }
  });

  it('DOES attach X-Org-Id to non-auth API endpoints', async () => {
    await fetch('/api/users');
    await fetch('/api/employees');

    for (const req of capturedRequests) {
      expect(req.headers.get('X-Org-Id')).toBe('42');
    }
  });

  it('does NOT attach X-Org-Id when no org is stored (even to non-auth routes)', async () => {
    localStorage.removeItem(ORG_STORAGE_KEY);
    // Re-install so the interceptor sees the cleared storage
    await freshInstall();

    await fetch('/api/users');

    expect(capturedRequests[0].headers.has('X-Org-Id')).toBe(false);
  });

  it('respects an explicitly-set X-Org-Id header on non-auth routes', async () => {
    await fetch('/api/employees', {
      headers: { 'X-Org-Id': '99' },
    });

    expect(capturedRequests[0].headers.get('X-Org-Id')).toBe('99');
  });
});

describe('getActiveOrgId — localStorage value validation', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });

  it('returns null when stored value is a non-numeric string', () => {
    localStorage.setItem(ORG_STORAGE_KEY, 'abc');
    expect(getActiveOrgId()).toBeNull();
  });

  it('returns null when stored value parses to NaN (e.g. "xyz")', () => {
    localStorage.setItem(ORG_STORAGE_KEY, 'xyz');
    expect(getActiveOrgId()).toBeNull();
  });

  it('returns null when stored value is "0"', () => {
    localStorage.setItem(ORG_STORAGE_KEY, '0');
    expect(getActiveOrgId()).toBeNull();
  });

  it('returns null when stored value is a negative number', () => {
    localStorage.setItem(ORG_STORAGE_KEY, '-5');
    expect(getActiveOrgId()).toBeNull();
  });

  it('returns null when stored value is an empty string', () => {
    localStorage.setItem(ORG_STORAGE_KEY, '');
    expect(getActiveOrgId()).toBeNull();
  });

  it('returns the numeric value when stored value is a valid positive integer', () => {
    localStorage.setItem(ORG_STORAGE_KEY, '7');
    expect(getActiveOrgId()).toBe(7);
  });

  it('returns null when nothing is stored', () => {
    // key was never set
    expect(getActiveOrgId()).toBeNull();
  });
});
