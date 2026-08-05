// Pure date helpers for the leave-request calendar range picker.
// Kept free of react-native imports so vitest (jsdom) can test them directly.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pure range-selection rule: given the current range and a tapped day,
 * return the next {start, end}. Invalid ranges (end < start) are impossible:
 * tapping a day earlier than the current start restarts the range.
 */
export function nextRange(
  startISO: string,
  endISO: string,
  tappedISO: string,
): { start: string; end: string } {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  const tapped = parseISO(tappedISO);
  if (!tapped) return { start: startISO, end: endISO };
  if (!start || (start && end)) return { start: tappedISO, end: '' };
  if (tapped.getTime() < start.getTime()) return { start: tappedISO, end: '' };
  return { start: toISODate(start), end: tappedISO };
}
