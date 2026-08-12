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
  if (orgId === null) localStorage.removeItem(ORG_STORAGE_KEY);
  else localStorage.setItem(ORG_STORAGE_KEY, String(orgId));
}

let installed = false;

export function installOrgFetch(): void {
  if (installed) return;
  installed = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const orgId = getActiveOrgId();
    if (orgId !== null) {
      const url =
        typeof input === 'string' ? input :
        input instanceof URL ? input.toString() :
        input.url;
      // Never attach X-Org-Id to auth endpoints — the session doesn't
      // exist yet (login) or is being torn down (logout/me on page load
      // before the session hydrates), so the server will reject it as
      // "Authentication required to select an organization context".
      if (url.includes('/api/') && !url.includes('/api/auth/')) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        // Respect an explicitly-set header (admin pages may pin an org)
        if (!headers.has('X-Org-Id')) headers.set('X-Org-Id', String(orgId));
        init = { ...init, headers };
      }
    }
    return origFetch(input, init);
  };
}
