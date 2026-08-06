import type { StringKey } from '@/lib/i18n';

// Role gates mirror the server's privileged-session route guards
// (artifacts/api-server/src/routes/privilegedSessions.ts). The server remains
// the real boundary — these only decide what UI to render.
//
// Exported for the drift test that verifies these sets stay in sync with the
// server's SESSION_REVIEWER_ROLES / SESSION_DECIDER_ROLES constants.
export const VIEWER_ROLES = new Set([
  'Super Administrator',
  'Security Officer',
  'Read-Only Auditor',
]);
export const DECIDER_ROLES = new Set(['Super Administrator', 'Security Officer']);

export function canViewPrivilegedSessions(roleNameEn: string | null | undefined): boolean {
  return !!roleNameEn && VIEWER_ROLES.has(roleNameEn);
}

export function canDecidePrivilegedSessions(roleNameEn: string | null | undefined): boolean {
  return !!roleNameEn && DECIDER_ROLES.has(roleNameEn);
}

// Maps a review outcome to its i18n string key; null/undefined means the
// session has not been reviewed yet.
export function outcomeStringKey(outcome: string | null | undefined): StringKey {
  switch (outcome) {
    case 'justified':
      return 'outcomeJustified';
    case 'unjustified':
      return 'outcomeUnjustified';
    case 'under_investigation':
      return 'outcomeUnderInvestigation';
    default:
      return 'notReviewed';
  }
}

export const REVIEW_OUTCOMES = [
  'justified',
  'unjustified',
  'under_investigation',
] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];
