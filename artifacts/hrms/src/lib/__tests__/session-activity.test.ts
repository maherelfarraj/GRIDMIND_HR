import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_PAGE_SIZE,
  appendActivityPage,
  emptyActivityState,
  hasMoreActivity,
  nextActivityOffset,
  type ActivityState,
} from '../session-activity';
import type { AuditLog, GetPrivilegedSessionActivity200 } from '@workspace/api-client-react';

const SERVER_MAX_LIMIT = 200; // clamp enforced by the API

function makeLog(id: number): AuditLog {
  return {
    id,
    actorUserId: 1,
    action: `test.action.${id}`,
    entityType: 'employee',
    entityId: id,
    entityLabel: null,
    changesJson: null,
    createdAt: new Date(2026, 0, 1, 0, 0, id).toISOString(),
  } as unknown as AuditLog;
}

// Simulates the server: newest-first fixed dataset, limit clamped like the API.
function serverPage(all: AuditLog[], limit: number, offset: number): GetPrivilegedSessionActivity200 {
  const clamped = Math.min(Math.max(limit, 1), SERVER_MAX_LIMIT);
  return { items: all.slice(offset, offset + clamped), total: all.length, limit: clamped, offset, correlation: 'tagged' };
}

describe('session activity pagination', () => {
  it('loads a session with more rows than the server cap and terminates', () => {
    const TOTAL = 520; // > 200 server cap, not a multiple of the page size
    const all = Array.from({ length: TOTAL }, (_, i) => makeLog(i + 1));

    let state: ActivityState = emptyActivityState();
    let requests = 0;
    while (requests === 0 || hasMoreActivity(state)) {
      const offset = nextActivityOffset(state);
      state = appendActivityPage(state, serverPage(all, ACTIVITY_PAGE_SIZE, offset));
      requests++;
      expect(requests).toBeLessThanOrEqual(Math.ceil(TOTAL / ACTIVITY_PAGE_SIZE) + 1);
    }

    expect(state.items.length).toBe(TOTAL);
    expect(hasMoreActivity(state)).toBe(false);
    // rows past index 200 (the server cap) actually got loaded
    expect(state.items[300]!.id).toBe(all[300]!.id);
    // no duplicates
    expect(new Set(state.items.map((i) => i.id)).size).toBe(TOTAL);
    // requests advance by fixed-size pages, not ever-growing limits
    expect(requests).toBe(Math.ceil(TOTAL / ACTIVITY_PAGE_SIZE));
  });

  it('dedupes rows that shift across page boundaries when new rows arrive', () => {
    const all = Array.from({ length: 120 }, (_, i) => makeLog(i + 1));
    let state = appendActivityPage(emptyActivityState(), serverPage(all, ACTIVITY_PAGE_SIZE, 0));

    // A new row is prepended between requests, shifting offsets by one so the
    // last row of page 1 reappears at the start of page 2.
    const shifted = [makeLog(999), ...all];
    state = appendActivityPage(state, serverPage(shifted, ACTIVITY_PAGE_SIZE, nextActivityOffset(state)));

    expect(new Set(state.items.map((i) => i.id)).size).toBe(state.items.length);
    expect(state.total).toBe(shifted.length);
    expect(hasMoreActivity(state)).toBe(true);
  });

  it('reports no more pages for an empty window', () => {
    const state = appendActivityPage(emptyActivityState(), serverPage([], ACTIVITY_PAGE_SIZE, 0));
    expect(state.items.length).toBe(0);
    expect(hasMoreActivity(state)).toBe(false);
  });
});
