import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvHeaders } from '../../lib/data-import-utils';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsv('name,title\n"Doe, Jane","VP, Sales"')).toEqual([
      ['name', 'title'],
      ['Doe, Jane', 'VP, Sales'],
    ]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']]);
  });

  it('handles quoted fields containing newlines', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([['a', 'b'], ['line1\nline2', 'x']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });
});

describe('parseCsvHeaders', () => {
  it('returns trimmed header cells', () => {
    expect(parseCsvHeaders(' a , "b,x" ,c\n1,2,3')).toEqual(['a', 'b,x', 'c']);
  });
});
