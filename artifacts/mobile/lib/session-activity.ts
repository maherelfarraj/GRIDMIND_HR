import type { AuditLog, GetPrivilegedSessionActivity200 } from '@workspace/api-client-react';

// Client-side pagination state for the privileged-session activity list.
// The server pages newest-first with limit/offset and reports the total, so
// the UI fetches fixed-size pages and appends them until it holds `total`
// rows. Kept as pure functions so the termination behavior is unit-testable.
// Mirrors the web implementation (artifacts/hrms/src/lib/session-activity.ts)
// so both clients treat pagination and correlation identically.

export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityState {
  items: AuditLog[];
  total: number;
  // How the server correlated entries to the session: "tagged" means exact
  // attribution; "time-window" means an estimate that may include routine
  // work done in the same window (sessions predating tagging).
  correlation: 'tagged' | 'time-window' | null;
}

export function emptyActivityState(): ActivityState {
  return { items: [], total: 0, correlation: null };
}

// Append a fetched page, deduping by id: rows inserted between requests can
// shift offsets, so the same row may appear on two consecutive pages.
export function appendActivityPage(state: ActivityState, page: GetPrivilegedSessionActivity200): ActivityState {
  const seen = new Set(state.items.map((i) => i.id));
  return {
    items: [...state.items, ...page.items.filter((i) => !seen.has(i.id))],
    total: page.total,
    correlation: page.correlation,
  };
}

export function hasMoreActivity(state: ActivityState): boolean {
  return state.items.length < state.total;
}

// Next request starts where the loaded rows end, so each "load more" fetches
// a fixed-size page regardless of how many rows are already displayed.
export function nextActivityOffset(state: ActivityState): number {
  return state.items.length;
}
