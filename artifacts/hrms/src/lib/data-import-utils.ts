import * as XLSX from 'xlsx';

export const EMPLOYEE_FIELDS = ['employeeNumber', 'firstNameEn', 'lastNameEn', 'firstNameAr', 'lastNameAr', 'nationalId', 'email', 'departmentId', 'jobTitleEn', 'hireDate'];

export const DEFAULT_MAPPING: Record<string, string> = {
  code: 'employeeNumber', first_name_en: 'firstNameEn', last_name_en: 'lastNameEn',
  nid: 'nationalId', email: 'email', start_date: 'hireDate',
};

/**
 * Returns true when at least one header matches a known target field or default
 * mapping key — meaning the sheet looks like a real data sheet.
 */
export function hasUsableHeaders(headers: string[]): boolean {
  if (headers.length === 0) return false;
  const knownFields = new Set([...EMPLOYEE_FIELDS, ...Object.keys(DEFAULT_MAPPING)]);
  return headers.some(h => knownFields.has(h));
}

/** Parse CSV text into an array of cell arrays, honoring quoted fields (RFC 4180-style). */
export function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      row.push(cell); cell = ''; sawAny = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      if (sawAny || cell !== '') { row.push(cell); rows.push(row); }
      row = []; cell = ''; sawAny = false;
    } else {
      cell += ch;
      sawAny = true;
    }
  }
  if (sawAny || cell !== '') { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Extract trimmed header cells from CSV text. */
export function parseCsvHeaders(csvText: string): string[] {
  const rows = parseCsv(csvText);
  return (rows[0] ?? []).map(h => h.trim()).filter(Boolean);
}

/**
 * Convert one worksheet of a workbook to CSV text and derive the column mapping,
 * keeping any previous mapping for headers that still exist and auto-mapping
 * known defaults. Empty sheets yield `{ text: '', mapping: {} }`.
 */
export function extractSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string,
  prevMapping: Record<string, string>,
): { text: string; mapping: Record<string, string> } {
  const sheet = workbook.Sheets[sheetName];
  const text = sheet ? XLSX.utils.sheet_to_csv(sheet) : '';
  if (!text.trim()) return { text: '', mapping: {} };
  const headers = parseCsvHeaders(text);
  const mapping: Record<string, string> = {};
  headers.forEach(h => {
    const target = prevMapping[h] ?? DEFAULT_MAPPING[h];
    if (target) mapping[h] = target;
  });
  return { text, mapping };
}
