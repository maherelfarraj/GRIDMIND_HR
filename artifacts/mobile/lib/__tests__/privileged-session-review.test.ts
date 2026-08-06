/**
 * Tests for the privileged-session role gates.
 *
 * Two concerns are covered:
 *  1. Unit tests – canViewPrivilegedSessions / canDecidePrivilegedSessions
 *     return the correct answer for every known system role, including edge
 *     cases (null, undefined, empty string, unknown role).
 *  2. Drift guard – the client-side role sets (VIEWER_ROLES / DECIDER_ROLES)
 *     must stay in sync with the server's SESSION_REVIEWER_ROLES /
 *     SESSION_DECIDER_ROLES constants in
 *     artifacts/api-server/src/routes/privilegedSessions.ts.
 *     If either side is updated without updating the other, this test fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  canViewPrivilegedSessions,
  canDecidePrivilegedSessions,
  VIEWER_ROLES,
  DECIDER_ROLES,
} from '../privileged-session-review';

// ---------------------------------------------------------------------------
// Canonical seeded system roles
// ---------------------------------------------------------------------------

/** Roles that should be allowed to VIEW privileged sessions. */
const ALLOWED_VIEWER_ROLES = [
  'Super Administrator',
  'Security Officer',
  'Read-Only Auditor',
] as const;

/** Roles that should be allowed to DECIDE (approve/reject) review outcomes. */
const ALLOWED_DECIDER_ROLES = [
  'Super Administrator',
  'Security Officer',
] as const;

/** All other seeded application roles — none should pass either gate. */
const DENIED_ROLES = [
  'HR Manager',
  'Payroll Admin',
  'Department Head',
  'Recruiter',
  'Employee',
] as const;

// ---------------------------------------------------------------------------
// 1. canViewPrivilegedSessions
// ---------------------------------------------------------------------------

describe('canViewPrivilegedSessions', () => {
  it.each(ALLOWED_VIEWER_ROLES)('grants access to %s', (role) => {
    expect(canViewPrivilegedSessions(role)).toBe(true);
  });

  it.each(DENIED_ROLES)('denies access to %s', (role) => {
    expect(canViewPrivilegedSessions(role)).toBe(false);
  });

  it('denies access to null', () => {
    expect(canViewPrivilegedSessions(null)).toBe(false);
  });

  it('denies access to undefined', () => {
    expect(canViewPrivilegedSessions(undefined)).toBe(false);
  });

  it('denies access to an empty string', () => {
    expect(canViewPrivilegedSessions('')).toBe(false);
  });

  it('denies access to an unrecognised role string', () => {
    expect(canViewPrivilegedSessions('Unknown Role')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. canDecidePrivilegedSessions
// ---------------------------------------------------------------------------

describe('canDecidePrivilegedSessions', () => {
  it.each(ALLOWED_DECIDER_ROLES)('grants decision rights to %s', (role) => {
    expect(canDecidePrivilegedSessions(role)).toBe(true);
  });

  // Read-Only Auditor can view but must NOT decide
  it('denies decision rights to Read-Only Auditor', () => {
    expect(canDecidePrivilegedSessions('Read-Only Auditor')).toBe(false);
  });

  it.each(DENIED_ROLES)('denies decision rights to %s', (role) => {
    expect(canDecidePrivilegedSessions(role)).toBe(false);
  });

  it('denies decision rights to null', () => {
    expect(canDecidePrivilegedSessions(null)).toBe(false);
  });

  it('denies decision rights to undefined', () => {
    expect(canDecidePrivilegedSessions(undefined)).toBe(false);
  });

  it('denies decision rights to an empty string', () => {
    expect(canDecidePrivilegedSessions('')).toBe(false);
  });

  it('denies decision rights to an unrecognised role string', () => {
    expect(canDecidePrivilegedSessions('Unknown Role')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Viewer ⊇ Decider — every decider must also be a viewer
// ---------------------------------------------------------------------------

describe('role-set invariant: deciders are a subset of viewers', () => {
  it('every role that can decide can also view', () => {
    for (const role of DECIDER_ROLES) {
      expect(
        VIEWER_ROLES.has(role),
        `DECIDER_ROLES contains "${role}" but VIEWER_ROLES does not — a decider must also be a viewer`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Drift guard — client sets must mirror the server constants
// ---------------------------------------------------------------------------

/**
 * Extract a Set literal from the server source text.
 *
 * Matches patterns like:
 *   const SESSION_REVIEWER_ROLES = new Set(["A", "B", "C"]);
 *
 * Returns a Set<string> of the quoted members, or throws if not found.
 */
function extractServerSet(source: string, constName: string): Set<string> {
  // Match: const <NAME> = new Set([...]);  (single or double quotes, multiline)
  const pattern = new RegExp(
    `const\\s+${constName}\\s*=\\s*new\\s+Set\\(\\[([^\\]]+)\\]\\)`,
    's',
  );
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(
      `Could not locate "${constName}" in the server privilegedSessions route. ` +
        'Has it been renamed or moved?',
    );
  }
  const members = match[1]!
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return new Set(members);
}

describe('client ↔ server role-set drift guard', () => {
  const serverSrc = readFileSync(
    resolve(
      __dirname,
      '../../../../artifacts/api-server/src/routes/privilegedSessions.ts',
    ),
    'utf8',
  );

  const serverReviewerRoles = extractServerSet(serverSrc, 'SESSION_REVIEWER_ROLES');
  const serverDeciderRoles = extractServerSet(serverSrc, 'SESSION_DECIDER_ROLES');

  it('VIEWER_ROLES matches the server SESSION_REVIEWER_ROLES', () => {
    expect(
      VIEWER_ROLES,
      'The mobile VIEWER_ROLES set has drifted from the server SESSION_REVIEWER_ROLES. ' +
        'Update artifacts/mobile/lib/privileged-session-review.ts to match.',
    ).toEqual(serverReviewerRoles);
  });

  it('DECIDER_ROLES matches the server SESSION_DECIDER_ROLES', () => {
    expect(
      DECIDER_ROLES,
      'The mobile DECIDER_ROLES set has drifted from the server SESSION_DECIDER_ROLES. ' +
        'Update artifacts/mobile/lib/privileged-session-review.ts to match.',
    ).toEqual(serverDeciderRoles);
  });

  it('server SESSION_REVIEWER_ROLES contains every SERVER_DECIDER role (server-side invariant)', () => {
    for (const role of serverDeciderRoles) {
      expect(
        serverReviewerRoles.has(role),
        `Server SESSION_DECIDER_ROLES contains "${role}" but SESSION_REVIEWER_ROLES does not`,
      ).toBe(true);
    }
  });
});
