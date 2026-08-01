import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractSheetData, parseCsvHeaders } from '@/pages/data-import';

/** Build a workbook with an empty cover sheet followed by a populated data sheet. */
function buildWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Cover');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['code', 'first_name_en', 'last_name_en', 'nid', 'email', 'start_date'],
      ['10001', 'Ahmed', 'Al-Qahtani', '1234567890', 'ahmed@example.com', '2023-01-01'],
    ]),
    'Employees',
  );
  return wb;
}

describe('extractSheetData (worksheet picker)', () => {
  it('returns empty text and mapping for an empty first sheet without throwing', () => {
    const wb = buildWorkbook();
    const { text, mapping } = extractSheetData(wb, 'Cover', {});
    expect(text).toBe('');
    expect(mapping).toEqual({});
    // The workbook still exposes both sheets so the picker can offer them.
    expect(wb.SheetNames).toEqual(['Cover', 'Employees']);
  });

  it('extracts CSV text and auto-maps default headers from a later sheet', () => {
    const wb = buildWorkbook();
    const { text, mapping } = extractSheetData(wb, 'Employees', {});
    expect(parseCsvHeaders(text)).toEqual(['code', 'first_name_en', 'last_name_en', 'nid', 'email', 'start_date']);
    expect(text).toContain('10001,Ahmed,Al-Qahtani');
    expect(mapping).toEqual({
      code: 'employeeNumber',
      first_name_en: 'firstNameEn',
      last_name_en: 'lastNameEn',
      nid: 'nationalId',
      email: 'email',
      start_date: 'hireDate',
    });
  });

  it('keeps a previous custom mapping for headers that still exist', () => {
    const wb = buildWorkbook();
    const { mapping } = extractSheetData(wb, 'Employees', { email: 'firstNameEn', gone_col: 'lastNameEn' });
    expect(mapping.email).toBe('firstNameEn'); // preserved override
    expect(mapping.gone_col).toBeUndefined(); // dropped: header absent
    expect(mapping.code).toBe('employeeNumber'); // default applied
  });

  it('survives a round-trip through xlsx file bytes (as the upload path reads them)', () => {
    const bytes = XLSX.write(buildWorkbook(), { type: 'array', bookType: 'xlsx' });
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames.length).toBeGreaterThan(1);
    expect(extractSheetData(wb, wb.SheetNames[0], {}).text).toBe('');
    expect(extractSheetData(wb, 'Employees', {}).text).toContain('ahmed@example.com');
  });

  it('returns empty for a sheet name that does not exist', () => {
    expect(extractSheetData(buildWorkbook(), 'Nope', {})).toEqual({ text: '', mapping: {} });
  });
});
