// Pure-logic tests for the leave-request calendar range picker.
import { describe, expect, it } from 'vitest';
import {
  nextRange,
  parseISO,
  toISODate,
} from '@/components/dateRange';

describe('toISODate / parseISO', () => {
  it('round-trips local dates', () => {
    expect(toISODate(new Date(2026, 7, 5))).toBe('2026-08-05');
    expect(parseISO('2026-08-05')?.getDate()).toBe(5);
    expect(parseISO('2026-8-5')).toBeNull();
    expect(parseISO('')).toBeNull();
  });

  it('pads single-digit months and days', () => {
    expect(toISODate(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});

describe('nextRange selection rule', () => {
  it('first tap sets the start and clears the end', () => {
    expect(nextRange('', '', '2026-08-10')).toEqual({
      start: '2026-08-10',
      end: '',
    });
  });

  it('second tap on a later day completes the range', () => {
    expect(nextRange('2026-08-10', '', '2026-08-14')).toEqual({
      start: '2026-08-10',
      end: '2026-08-14',
    });
  });

  it('same-day tap yields a one-day range', () => {
    expect(nextRange('2026-08-10', '', '2026-08-10')).toEqual({
      start: '2026-08-10',
      end: '2026-08-10',
    });
  });

  it('tapping earlier than the start restarts the range (invalid range impossible)', () => {
    expect(nextRange('2026-08-10', '', '2026-08-05')).toEqual({
      start: '2026-08-05',
      end: '',
    });
  });

  it('tapping with a complete range starts a fresh range', () => {
    expect(nextRange('2026-08-10', '2026-08-14', '2026-08-20')).toEqual({
      start: '2026-08-20',
      end: '',
    });
  });

  it('ignores invalid tapped values', () => {
    expect(nextRange('2026-08-10', '2026-08-14', 'nope')).toEqual({
      start: '2026-08-10',
      end: '2026-08-14',
    });
  });

  it('crosses month boundaries correctly', () => {
    expect(nextRange('2026-08-30', '', '2026-09-02')).toEqual({
      start: '2026-08-30',
      end: '2026-09-02',
    });
  });
});
