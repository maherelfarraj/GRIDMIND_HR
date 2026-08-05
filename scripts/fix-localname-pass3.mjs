/**
 * Pass 3: fix remaining bilingual-field ternaries found by the audit test.
 * Run: node scripts/fix-localname-pass3.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

function read(rel)  { return readFileSync(resolve(ROOT, rel), 'utf8'); }
function write(rel, s) { writeFileSync(resolve(ROOT, rel), s, 'utf8'); console.log(`  ✓ ${rel}`); }

function rf(src, needle, replacement) {
  const idx = src.indexOf(needle);
  if (idx === -1) throw new Error(`NOT FOUND: ${JSON.stringify(needle.slice(0, 120))}`);
  return src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}
function ra(src, needle, replacement) {
  if (!src.includes(needle)) throw new Error(`NOT FOUND (all): ${JSON.stringify(needle.slice(0, 120))}`);
  return src.split(needle).join(replacement);
}
function addImport(src) {
  if (src.includes("from '@/lib/localise'")) return src;
  return rf(src,
    "import { useLanguage } from '@/hooks/use-language';",
    "import { useLanguage } from '@/hooks/use-language';\nimport { localName } from '@/lib/localise';"
  );
}

// ── attendance.tsx ────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/attendance.tsx');
  // record.employeeNameEn/Ar — appears as JSX render and as .split() initials source (2 identical pairs)
  s = ra(s,
    '{lang === \'en\' ? record.employeeNameEn : record.employeeNameAr}',
    '{localName(record.employeeNameEn, record.employeeNameAr, lang)}',
  );
  s = ra(s,
    '(lang === \'en\' ? record.employeeNameEn : record.employeeNameAr)',
    '(localName(record.employeeNameEn, record.employeeNameAr, lang))',
  );
  // correction.employeeNameEn/Ar
  s = rf(s,
    '{lang === \'en\' ? correction.employeeNameEn : correction.employeeNameAr}',
    '{localName(correction.employeeNameEn, correction.employeeNameAr, lang)}',
  );
  // mapping.employeeNameEn/Ar — initials + render
  s = ra(s,
    '(lang === \'en\' ? mapping.employeeNameEn : mapping.employeeNameAr)',
    '(localName(mapping.employeeNameEn, mapping.employeeNameAr, lang))',
  );
  s = rf(s,
    '{lang === \'en\' ? mapping.employeeNameEn : mapping.employeeNameAr}',
    '{localName(mapping.employeeNameEn, mapping.employeeNameAr, lang)}',
  );
  // emp.firstNameEn/Ar + lastNameEn/Ar compound — use guarded ternary so blank Ar → En
  s = rf(s,
    "lang === 'en' ? emp.firstNameEn + ' ' + emp.lastNameEn : emp.firstNameAr + ' ' + emp.lastNameAr",
    "lang === 'ar' && emp.firstNameAr ? emp.firstNameAr + ' ' + emp.lastNameAr : emp.firstNameEn + ' ' + emp.lastNameEn",
  );
  write('artifacts/hrms/src/pages/attendance.tsx', s);
}

// ── integration-governance.tsx ────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/integration-governance.tsx');
  // selectedRef.labelAr/En — inside AddProfileDialog vault-ref detail card
  s = rf(s,
    '{lang === \'ar\' ? (selectedRef.labelAr || selectedRef.labelEn) : selectedRef.labelEn}',
    '{localName(selectedRef.labelEn, selectedRef.labelAr, lang)}',
  );
  // v.labelAr/En — vault table cell
  s = rf(s,
    '{lang === \'ar\' ? (v.labelAr || v.labelEn) : v.labelEn}',
    '{localName(v.labelEn, v.labelAr, lang)}',
  );
  write('artifacts/hrms/src/pages/integration-governance.tsx', s);
}

// ── my-portal.tsx ─────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/my-portal.tsx');
  s = rf(s,
    '{lang === \'en\' ? user?.fullNameEn : user?.fullNameAr}',
    '{localName(user?.fullNameEn, user?.fullNameAr, lang)}',
  );
  write('artifacts/hrms/src/pages/my-portal.tsx', s);
}

// ── overtime.tsx ──────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/overtime.tsx');
  s = rf(s, "name: lang === 'en' ? e.nameEn : e.nameAr,", "name: localName(e.nameEn, e.nameAr, lang),");
  s = rf(s,
    '{lang === \'en\' ? record.employeeNameEn : record.employeeNameAr}',
    '{localName(record.employeeNameEn, record.employeeNameAr, lang)}',
  );
  write('artifacts/hrms/src/pages/overtime.tsx', s);
}

// ── punch-events.tsx ──────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/punch-events.tsx');
  s = addImport(s);
  s = rf(s,
    '{lang === \'en\' ? ev.employeeNameEn : ev.employeeNameAr}',
    '{localName(ev.employeeNameEn, ev.employeeNameAr, lang)}',
  );
  s = rf(s,
    '{lang === \'en\' ? selectedEvent.employeeNameEn : selectedEvent.employeeNameAr}',
    '{localName(selectedEvent.employeeNameEn, selectedEvent.employeeNameAr, lang)}',
  );
  write('artifacts/hrms/src/pages/punch-events.tsx', s);
}

// ── users.tsx ─────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/users.tsx');
  // created user name in success handler
  s = rf(s,
    "const name = lang === 'en' ? created.fullNameEn : created.fullNameAr;",
    "const name = localName(created.fullNameEn, created.fullNameAr, lang);",
  );
  // openEditDialog sets editTarget.name
  s = rf(s,
    "setEditTarget({ id: user.id, name: lang === 'en' ? user.fullNameEn : user.fullNameAr });",
    "setEditTarget({ id: user.id, name: localName(user.fullNameEn, user.fullNameAr, lang) });",
  );
  // table cell primary name
  s = rf(s,
    '{lang === \'en\' ? user.fullNameEn : user.fullNameAr}',
    '{localName(user.fullNameEn, user.fullNameAr, lang)}',
  );
  // dropdown Set Password target
  s = rf(s,
    "setPasswordTarget({ id: user.id, name: lang === 'en' ? user.fullNameEn : user.fullNameAr })",
    "setPasswordTarget({ id: user.id, name: localName(user.fullNameEn, user.fullNameAr, lang) })",
  );
  // dropdown Issue OTP target (there are two setOtpTarget calls with this pattern)
  s = ra(s,
    "setOtpTarget({ id: user.id, name: lang === 'en' ? user.fullNameEn : user.fullNameAr })",
    "setOtpTarget({ id: user.id, name: localName(user.fullNameEn, user.fullNameAr, lang) })",
  );
  // handleUnlock arg
  s = rf(s,
    "handleUnlock(user.id, lang === 'en' ? user.fullNameEn : user.fullNameAr)",
    "handleUnlock(user.id, localName(user.fullNameEn, user.fullNameAr, lang))",
  );
  write('artifacts/hrms/src/pages/users.tsx', s);
}

// ── employees/[id].tsx ────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/employees/[id].tsx');
  // compound name — use guarded ternary (Ar only if Arabic first-name exists)
  s = rf(s,
    "const name = lang === 'en' ? `${employee.firstNameEn} ${employee.lastNameEn}` : `${employee.firstNameAr} ${employee.lastNameAr}`;",
    "const name = lang === 'ar' && employee.firstNameAr ? `${employee.firstNameAr} ${employee.lastNameAr}` : `${employee.firstNameEn} ${employee.lastNameEn}`;",
  );
  // job title
  s = rf(s,
    "const title = lang === 'en' ? employee.jobTitleEn : employee.jobTitleAr;",
    "const title = localName(employee.jobTitleEn, employee.jobTitleAr, lang);",
  );
  // department name
  s = rf(s,
    "const dept = lang === 'en' ? employee.departmentNameEn : employee.departmentNameAr;",
    "const dept = localName(employee.departmentNameEn, employee.departmentNameAr, lang);",
  );
  write('artifacts/hrms/src/pages/employees/[id].tsx', s);
}

// ── employees/index.tsx ───────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/employees/index.tsx');
  s = addImport(s);
  // compound employee full name — guarded ternary
  s = rf(s,
    "`${employee.firstNameEn} ${employee.lastNameEn}` : `${employee.firstNameAr} ${employee.lastNameAr}`",
    "`${employee.firstNameEn} ${employee.lastNameEn}` : (employee.firstNameAr ? `${employee.firstNameAr} ${employee.lastNameAr}` : `${employee.firstNameEn} ${employee.lastNameEn}`)",
  );
  // job title in employee table
  s = rf(s,
    "{lang === 'en' ? employee.jobTitleEn : employee.jobTitleAr}",
    "{localName(employee.jobTitleEn, employee.jobTitleAr, lang)}",
  );
  // department name
  s = rf(s,
    "{lang === 'en' ? employee.departmentNameEn : employee.departmentNameAr}",
    "{localName(employee.departmentNameEn, employee.departmentNameAr, lang)}",
  );
  write('artifacts/hrms/src/pages/employees/index.tsx', s);
}

console.log('\nAll done. Run `pnpm run typecheck && pnpm test` next.');
