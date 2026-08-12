/**
 * Global fetch patch: attaches the active organization context (X-Org-Id)
 * to every API request. Installed once at app startup (imported by main.tsx)
 * so both raw `fetch('/api/...')` calls and the generated API client hooks
 * are scoped to the org selected in the header switcher.
 */
export const ORG_STORAGE_KEY = 'hrms-org-id';

export function getActiveOrgId(): number | null {
  const raw = localStorage.getItem(ORG_STORAGE_KEY);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function setActiveOrgId(orgId: number | null): void {
  if (orgId === null) {
    localStorage.removeItem(ORG_STORAGE_KEY);
    return;
  }
  // Guard: only persist positive finite integers. Anything else (0, negative,
  // float, NaN, Infinity) would be silently dropped by getActiveOrgId on the
  // next read, breaking org-scoped requests without any visible error.
  if (!Number.isInteger(orgId) || orgId <= 0) {
    localStorage.removeItem(ORG_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ORG_STORAGE_KEY, String(orgId));
}

let installed = false;

export function installOrgFetch(): void {
  if (installed) return;
  installed = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const orgId = getActiveOrgId();
    const url =
      typeof input === 'string' ? input :
      input instanceof URL ? input.toString() :
      (input as Request).url;

    const isApiCall = url.includes('/api/') && !url.includes('/api/auth/');

    if (orgId !== null && isApiCall) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      // Respect an explicitly-set header (admin pages may pin an org)
      if (!headers.has('X-Org-Id')) headers.set('X-Org-Id', String(orgId));
      init = { ...init, headers };
    }

    const response = await origFetch(input, init);

    // If the server rejected the org ID as unknown (e.g. after a data wipe or
    // org deletion), clear the stale value and retry without it so the server
    // falls back to the user's home org automatically.
    if (response.status === 400 && isApiCall && orgId !== null) {
      const clone = response.clone();
      try {
        const body = await clone.json();
        if (body?.code === 'UNKNOWN_ORG') {
          setActiveOrgId(null);
          // Retry without X-Org-Id
          const retryInit = { ...init };
          if (retryInit.headers) {
            const h = new Headers(retryInit.headers);
            h.delete('X-Org-Id');
            retryInit.headers = h;
          }
          return origFetch(input, retryInit);
        }
      } catch {
        // body not JSON — fall through and return original response
      }
    }

    return response;
  };
}
