/**
 * Static audit — two checks in one file:
 *
 * CHECK 1 — No raw lang-ternary primary field selections
 *   `lang === 'ar' ? x.fieldAr : x.fieldEn`  and its inverse must not appear
 *   as a primary display expression.  All such renders must go through
 *   `localName(en, ar, lang)` so blank Arabic data falls back to English.
 *
 * CHECK 2 — No unguarded English-only person-name renders
 *   `.firstNameEn`, `.lastNameEn`, `*NameEn` must not be rendered directly in
 *   JSX when the API type carries an Arabic counterpart.  They must go through
 *   `localName` / `localFullName`.
 *
 * ── Intentional exceptions (CHECK 1) ─────────────────────────────────────────
 *
 * 1. Date-format LOCALE strings — `lang === 'ar' ? 'ar-SA' : 'en-US'`
 * 2. Compile-time label arrays  — `.label[0]`, `cfg.label`, `tab.label`
 * 3. Day-name arrays            — `DAY_NAMES_AR`, `DAY_AR` …
 * 4. `audit.tsx`                — local static `label.ar`/`label.en` objects
 * 5. Deliberately bilingual two-column tables (both languages always shown):
 *      military-hierarchy.tsx, leave-config.tsx, payroll-payslip.tsx
 * 6. Swapped subtitles          — `lang === 'ar' ? x.nameEn : x.nameAr`
 *                                 (shows the OTHER language as a secondary hint)
 * 7. Guarded ternaries          — `lang === 'ar' && x.fieldAr ?` includes an
 *                                 explicit blank guard, so they fall back correctly.
 *
 * ── Intentional exceptions (CHECK 2) ─────────────────────────────────────────
 *
 * A. LeaveCalendarEntry fields (`employeeNameEn`, `leaveTypeNameEn`) — the
 *    generated API type has no Arabic counterpart; cannot localise without a
 *    schema change.  Flagged lines in leave.tsx for these fields are exempted.
 *
 * B. `displayNameEn` in org-branding.tsx — this is the org's own branding field
 *    (not a person name) typed into a form by the operator; always English.
 *
 * C. Explicit "Full Name (EN)" bilingual label rows — payroll-payslip.tsx InfoRow
 *    and my-portal.tsx profile row intentionally show the English name under an
 *    English-labelled heading, with the Arabic name shown separately elsewhere.
 *
 * D. Filter / search computations — `.toLowerCase()` comparisons only affect
 *    which rows are visible, not what is rendered to the user.
 *
 * E. Image `alt=` attributes and avatar `charAt` / `.split` initials that are
 *    already routed through `localFullName`.
 *
 * F. Import lines, type annotations, state initialisers — never rendered.
 */

import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { describe, it, expect } from 'vitest';

const PAGES_DIR = resolve(__dirname, '../../pages');

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadPages() {
  const entries = readdirSync(PAGES_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter(e => e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.ts')))
    .map(e => join((e as any).parentPath ?? (e as any).path, e.name));
}

function rel(file: string) { return file.replace(PAGES_DIR + '/', ''); }

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 1 — no raw lang-ternary primary field selections
// ─────────────────────────────────────────────────────────────────────────────

function isSafeTernary(line: string, file: string): boolean {
  const l = line.trim();

  if (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) return true;
  if (l.includes('localName(')) return true;

  // Exception 1: date-locale constants
  if (l.includes("'ar-SA'") || l.includes('"ar-SA"') ||
      l.includes("'en-US'") || l.includes('"en-US"')) return true;

  // Exception 2: compile-time label arrays
  if (l.includes('.label[') || l.includes('cfg.label') || l.includes('tab.label')) return true;

  // Exception 3: day-name arrays
  if (l.includes('DAY_')) return true;

  // Exception 4: audit.tsx static label object
  if (file.endsWith('audit.tsx')) return true;

  // Exception 5: deliberately bilingual two-column table files (raw nameAr/nameEn
  //   in those files are separate always-visible columns, not a language selection)
  const bilingualFiles = ['military-hierarchy.tsx', 'leave-config.tsx', 'payroll-payslip.tsx'];
  if (bilingualFiles.some(f => file.endsWith(f)) && !l.includes('lang ===')) return true;

  // Exception 6: swapped (opposite-language) subtitle — the TRUE branch contains
  //   an En-suffix field and the FALSE branch contains an Ar-suffix field (or vice
  //   versa).  These are intentional bilingual secondary labels.
  const swappedArToEn = /lang\s*===\s*['"]ar['"]\s*\?[^:]*[A-Za-z]En[^:]*:[^;\n,}]*[A-Za-z]Ar/;
  const swappedEnToAr = /lang\s*===\s*['"]en['"]\s*\?[^:]*[A-Za-z]Ar[^:]*:[^;\n,}]*[A-Za-z]En/;
  if (swappedArToEn.test(l) || swappedEnToAr.test(l)) return true;

  // Exception 7: guarded ternaries — `lang === 'ar' && x.fieldAr ?`
  if (/lang\s*===\s*['"](?:ar|en)['"]\s*&&/.test(l)) return true;

  return false;
}

const TERNARY_BAD_PATTERNS: RegExp[] = [
  // Simple field suffix: nameAr/nameEn, titleAr/titleEn, labelAr/labelEn, etc.
  /lang\s*===\s*['"]ar['"]\s*\?[^:]*[A-Za-z]Ar\b[^:]*:[^;\n,}]*[A-Za-z]En\b/,
  /lang\s*===\s*['"]en['"]\s*\?[^:]*[A-Za-z]En\b[^:]*:[^;\n,}]*[A-Za-z]Ar\b/,

  // Composite/prefixed fields: employeeNameAr/En, jobTitleAr/En, fullNameAr/En, etc.
  /lang\s*===\s*['"]ar['"]\s*\?[^:]*[A-Za-z]+(?:Name|Title|Label|Profile)Ar\b[^:]*:[^;\n,}]*[A-Za-z]+(?:Name|Title|Label|Profile)En\b/,
  /lang\s*===\s*['"]en['"]\s*\?[^:]*[A-Za-z]+(?:Name|Title|Label|Profile)En\b[^:]*:[^;\n,}]*[A-Za-z]+(?:Name|Title|Label|Profile)Ar\b/,

  // Dynamic bracket access: .[lang === 'ar' ? 'fieldAr' : 'fieldEn']
  /\.\[lang\s*===\s*['"](?:ar|en)['"]\s*\?\s*['"][a-zA-Z]+(?:Ar|En)['"]\s*:\s*['"][a-zA-Z]+(?:En|Ar)['"]\]/,

  // Template-literal compound names differing only in Ar/En suffix
  /lang\s*===\s*['"](?:ar|en)['"]\s*\?[^:]*first[Nn]ame(?:En|Ar)[^:]*:[^;\n,}]*first[Nn]ame(?:Ar|En)/,
];

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 2 — no unguarded English-only person-name renders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the line is a known-safe English-only name usage that should
 * not be flagged as "missing Arabic localisation".
 */
function isSafeEnglishOnly(line: string, file: string): boolean {
  const l = line.trim();

  // Already routed through a helper — safe
  if (l.includes('localName(') || l.includes('localFullName(')) return true;

  // Comments / imports / type annotations / interface declarations
  if (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*') ||
      l.startsWith('import ') || l.startsWith('export type') ||
      l.startsWith('interface ') || l.startsWith('type ')) return true;

  // State initialisers, variable assignment, function parameters — not rendered
  // Heuristic: line has `=` before the field and no JSX `{` / `>` rendering context
  if (/^\s*(const|let|var)\s/.test(l) && !l.includes('{') && !l.includes('<')) return true;

  // Filter / search — only affects visibility, not the rendered text
  if (l.includes('.toLowerCase()') || l.includes('.toUpperCase()') ||
      l.includes('.includes(') || l.includes('.filter(')) return true;

  // Image alt attributes — screen-reader text, not a rendered name element
  if (l.includes('alt=')) return true;

  // charAt / split for initials that are already routed through localFullName elsewhere
  // (the avatar fallback lines use localFullName(...).split(' ').map(n => n[0]))
  if (l.includes('.charAt(') || l.includes('.split(')) return true;

  // Exception A: LeaveCalendarEntry — no Arabic counterpart in the generated type.
  // The `employeeNameEn` and `leaveTypeNameEn` fields on the calendar cannot be
  // localised without an API schema change.
  if ((l.includes('e.employeeNameEn') || l.includes('e.leaveTypeNameEn') ||
       l.includes('employeeNameEn.split')) &&
      file.endsWith('leave.tsx')) return true;

  // Exception B: org-branding displayNameEn — org's own English branding field
  if (l.includes('displayNameEn') && file.endsWith('org-branding.tsx')) return true;

  // Exception C: explicit "Full Name (EN)" bilingual label rows
  // These intentionally show the English full name under an English-labelled row.
  if (l.includes("Full Name (EN)") || l.includes("'الاسم الكامل (إنجليزي)'")) return true;
  if ((l.includes('fullNameEn') || l.includes('firstNameEn')) &&
      (l.includes('InfoRow') || l.includes('Full Name'))) return true;

  // Exception: form field state — inviteNameEn, editNameEn, etc. — not rendered
  if (l.includes('inviteNameEn') || l.includes('editNameEn') ||
      l.includes('nameEn:') || l.includes('nameEn.trim') ||
      l.includes('fullNameEn:') || l.includes('firstNameEn:')) return true;

  // Exception: query/mutation params and data structures, not rendered
  if (l.includes('Params') || l.includes('params') ||
      l.includes('useState') || l.includes('setForm') ||
      l.includes('queryKey') || l.includes('invalidate')) return true;

  // ── Fields confirmed to have NO Arabic counterpart in the generated API types ──
  // These cannot be localised without an API/DB schema change.  Each entry is
  // documented with the source type and what was verified.

  // AttendanceRecord.departmentNameEn — only English department name on that type
  if (l.includes('record.departmentNameEn') && file.endsWith('attendance.tsx')) return true;

  // Department.parentNameEn, Department.headEmployeeNameEn — no Ar counterpart
  if ((l.includes('dept.parentNameEn') || l.includes('dept.headEmployeeNameEn')) &&
      file.endsWith('departments.tsx')) return true;

  // Document.employeeNameEn — no employeeNameAr on the Document type
  if (l.includes('doc.employeeNameEn') && file.endsWith('documents.tsx')) return true;

  // LeaveDelegation.delegatorNameEn / delegateeNameEn — no Ar counterpart
  if ((l.includes('d.delegatorNameEn') || l.includes('d.delegateeNameEn')) &&
      file.endsWith('leave-config.tsx')) return true;

  // SystemUser.roleNameEn — no roleNameAr on the SystemUser type
  if (l.includes('user.roleNameEn') && file.endsWith('users.tsx')) return true;

  // Employee.roleNameEn, Employee.managerNameEn — no Ar counterpart on Employee
  if ((l.includes('employee.roleNameEn') || l.includes('employee.managerNameEn')) &&
      (file.endsWith('[id].tsx') || file.endsWith('employees/[id].tsx'))) return true;

  // Approval.requestedByEmployeeNameEn — no Ar counterpart on the Approval type
  if (l.includes('requestedByEmployeeNameEn') && file.endsWith('approvals.tsx')) return true;

  // UatTestRun.testerNameEn — DB schema stores tester_name_en only (lib/db/src/schema/uatScripts.ts);
  // no tester_name_ar column exists. Cannot localise without a schema change.
  if (l.includes('run.testerNameEn') && file.endsWith('uat-scripts.tsx')) return true;

  return false;
}

/**
 * Detect lines that render a person-name field in English only —
 * `.firstNameEn`, `.lastNameEn`, or a compound `*NameEn` field — without
 * routing through localName / localFullName.
 *
 * We focus on JSX render contexts: template literals in JSX props, and
 * direct JSX expressions `{...}`.
 */
const ENGLISH_ONLY_PATTERNS: RegExp[] = [
  // {e.firstNameEn} — direct JSX expression of a split first name
  /\{[^}]*\.firstNameEn[^}]*\}/,

  // `${x.firstNameEn}` in a JSX prop / template literal
  /\$\{[^}]*\.firstNameEn[^}]*\}/,

  // {x.employeeNameEn}  {x.fullNameEn}  {x.managerNameEn}  etc.
  // (excludes localCalendar / 'Full Name (EN)' cases handled in isSafeEnglishOnly)
  /\{[^}]*\.[A-Za-z]+NameEn[^}]*\}/,

  // `${x.*NameEn}` in template literals used in JSX props (title=, description=)
  /\$\{[^}]*\.[A-Za-z]+NameEn[^}]*\}/,
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('bilingual render audit', () => {
  it('has no raw lang-ternary primary field selections in any page', () => {
    const files = loadPages();
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!TERNARY_BAD_PATTERNS.some(re => re.test(line))) continue;
        if (isSafeTernary(line, file)) continue;
        violations.push(`${rel(file)}:${i + 1}  ${line.trim().slice(0, 140)}`);
      }
    }

    if (violations.length > 0) {
      console.error('\nLang-ternary field-selection violations:');
      violations.forEach(v => console.error('  ', v));
      console.error(
        '\nFix: use localName(nameEn, nameAr, lang) or localFullName(…) instead of a raw ternary.',
      );
    }
    expect(violations).toEqual([]);
  });

  it('has no unguarded English-only person-name renders where Arabic data exists', () => {
    const files = loadPages();
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!ENGLISH_ONLY_PATTERNS.some(re => re.test(line))) continue;
        if (isSafeEnglishOnly(line, file)) continue;
        violations.push(`${rel(file)}:${i + 1}  ${line.trim().slice(0, 140)}`);
      }
    }

    if (violations.length > 0) {
      console.error('\nEnglish-only name render violations (Arabic counterpart exists in type):');
      violations.forEach(v => console.error('  ', v));
      console.error(
        '\nFix: use localName(nameEn, nameAr, lang) or localFullName(firstEn, lastEn, firstAr, lastAr, lang).\n' +
        'If the API type genuinely has no Arabic field, add the case to isSafeEnglishOnly() with a comment.',
      );
    }
    expect(violations).toEqual([]);
  });
});
