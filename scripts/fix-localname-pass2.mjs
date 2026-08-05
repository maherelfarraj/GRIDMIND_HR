/**
 * Pass 2: convert all `lang === 'ar' ? x.nameAr : x.nameEn` (and inverse) patterns
 * in HRMS pages to localName(en, ar, lang), preventing empty renders when Arabic
 * data is blank.
 *
 * Run: node scripts/fix-localname-pass2.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGES = `${ROOT}/artifacts/hrms/src/pages`;

function read(rel)  { return readFileSync(resolve(ROOT, rel), 'utf8'); }
function write(rel, content) { writeFileSync(resolve(ROOT, rel), content, 'utf8'); console.log(`  ✓ ${rel}`); }

function rf(src, needle, replacement, label) {
  const idx = src.indexOf(needle);
  if (idx === -1) throw new Error(`NOT FOUND${label ? ` [${label}]` : ''}: ${JSON.stringify(needle.slice(0, 120))}`);
  return src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}
function ra(src, needle, replacement, label) {
  if (!src.includes(needle)) throw new Error(`NOT FOUND (all)${label ? ` [${label}]` : ''}: ${JSON.stringify(needle.slice(0, 120))}`);
  return src.split(needle).join(replacement);
}
function addImport(src) {
  if (src.includes("from '@/lib/localise'")) return src;
  return rf(src,
    "import { useLanguage } from '@/hooks/use-language';",
    "import { useLanguage } from '@/hooks/use-language';\nimport { localName } from '@/lib/localise';",
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. attendance.tsx — filterDepartmentName memo + table filter chip + table cell
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/attendance.tsx');
  s = addImport(s);
  // The memo uses two patterns; replace the whole memo body
  s = rf(s,
    `    if (dept) return lang === 'ar' ? dept.nameAr : dept.nameEn;
    return (
      attendanceData?.find((r) => r.departmentId === filterDepartmentId)?.departmentNameEn ??
      summaryData?.find((s) => s.departmentId === filterDepartmentId)?.[lang === 'ar' ? 'departmentNameAr' : 'departmentNameEn'] ??
      \`#\${filterDepartmentId}\`
    );`,
    `    if (dept) return localName(dept.nameEn, dept.nameAr, lang);
    const attRow = attendanceData?.find((r) => r.departmentId === filterDepartmentId);
    const sumRow = summaryData?.find((s) => s.departmentId === filterDepartmentId);
    return localName(
      attRow?.departmentNameEn ?? sumRow?.departmentNameEn,
      attRow?.departmentNameAr ?? sumRow?.departmentNameAr,
      lang,
    ) || \`#\${filterDepartmentId}\`;`,
  );
  // table filter department chip (line ~406)
  s = rf(s,
    '{lang === \'en\' ? dept.nameEn : dept.nameAr}',
    '{localName(dept.nameEn, dept.nameAr, lang)}',
  );
  write('artifacts/hrms/src/pages/attendance.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. alerts.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/alerts.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? alert.titleEn : alert.titleAr}', '{localName(alert.titleEn, alert.titleAr, lang)}');
  write('artifacts/hrms/src/pages/alerts.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. approvals.tsx  (line 104 component has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/approvals.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? item.titleEn : item.titleAr}', '{localName(item.titleEn, item.titleAr, lang)}');
  write('artifacts/hrms/src/pages/approvals.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. dashboard.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/dashboard.tsx');
  s = addImport(s);
  s = rf(s, 'name: lang === \'ar\' ? d.departmentNameAr : d.departmentNameEn,', 'name: localName(d.departmentNameEn, d.departmentNameAr, lang),');
  s = rf(s, '{lang === \'ar\' ? g.shiftNameAr : g.shiftNameEn}', '{localName(g.shiftNameEn, g.shiftNameAr, lang)}');
  s = rf(s, '{lang === \'ar\' ? e.nameAr : e.nameEn}', '{localName(e.nameEn, e.nameAr, lang)}');
  s = rf(s, '{lang === \'ar\' ? dept.departmentNameAr : dept.departmentNameEn}', '{localName(dept.departmentNameEn, dept.departmentNameAr, lang)}');
  write('artifacts/hrms/src/pages/dashboard.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. departments.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/departments.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? node.nameEn : node.nameAr}', '{localName(node.nameEn, node.nameAr, lang)}');
  s = rf(s, '{lang === \'en\' ? dept.nameEn : dept.nameAr}', '{localName(dept.nameEn, dept.nameAr, lang)}');
  write('artifacts/hrms/src/pages/departments.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. devices.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/devices.tsx');
  s = addImport(s);
  s = ra(s, '{lang === \'ar\' && g.nameAr ? g.nameAr : g.name}', '{localName(g.name, g.nameAr, lang)}');
  write('artifacts/hrms/src/pages/devices.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. documents.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/documents.tsx');
  s = addImport(s);
  // title attribute + rendered content — two identical occurrences
  s = ra(s, '{lang === \'en\' ? doc.titleEn : doc.titleAr}', '{localName(doc.titleEn, doc.titleAr, lang)}');
  write('artifacts/hrms/src/pages/documents.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. employees/[id].tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/employees/[id].tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? doc.titleEn : doc.titleAr}', '{localName(doc.titleEn, doc.titleAr, lang)}');
  write('artifacts/hrms/src/pages/employees/[id].tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 9. integration-governance.tsx  (import + lang already present where needed)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/integration-governance.tsx');
  // vault ref select items (two identical occurrences — LinkVaultRefDialog and AddProfileDialog)
  s = ra(s,
    '{lang === \'ar\' ? (r.labelAr || r.labelEn) : r.labelEn}',
    '{localName(r.labelEn, r.labelAr, lang)}',
  );
  // ProfileDetailDialog testerName computed value
  s = rf(s,
    'const testerName = detail ? (lang === \'ar\' ? (detail.lastTestedByNameAr || detail.lastTestedByNameEn) : (detail.lastTestedByNameEn || detail.lastTestedByNameAr)) : null;',
    'const testerName = detail ? localName(detail.lastTestedByNameEn, detail.lastTestedByNameAr, lang) : null;',
  );
  // Main component profiles table "tested by" name (line 1001)
  s = rf(s,
    '{lang === \'ar\' ? (p.lastTestedByNameAr || p.lastTestedByNameEn) : (p.lastTestedByNameEn || p.lastTestedByNameAr)}',
    '{localName(p.lastTestedByNameEn, p.lastTestedByNameAr, lang)}',
  );
  write('artifacts/hrms/src/pages/integration-governance.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 10. leave-balances.tsx  (line 132 component has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave-balances.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'ar\' ? lt.nameAr : lt.nameEn}', '{localName(lt.nameEn, lt.nameAr, lang)}');
  s = rf(s,
    '{lang === \'ar\' ? (b.employeeNameAr ?? b.employeeNameEn) : b.employeeNameEn}',
    '{localName(b.employeeNameEn, b.employeeNameAr, lang)}',
  );
  s = rf(s, '{lang === \'ar\' ? b.leaveTypeNameAr : b.leaveTypeNameEn}', '{localName(b.leaveTypeNameEn, b.leaveTypeNameAr, lang)}');
  write('artifacts/hrms/src/pages/leave-balances.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 11. leave-config.tsx  (line 241 component has lang; line 552 bilingual table — skip)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave-config.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'ar\' ? lt.nameAr : lt.nameEn}', '{localName(lt.nameEn, lt.nameAr, lang)}');
  write('artifacts/hrms/src/pages/leave-config.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 12. leave.tsx  (various components already have lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave.tsx');
  // leaveTypeNameAr/En — two occurrences (RequestsTab line 563 and TeamQueueTab line 843)
  s = ra(s,
    '{lang === \'ar\' ? req.leaveTypeNameAr : req.leaveTypeNameEn}',
    '{localName(req.leaveTypeNameEn, req.leaveTypeNameAr, lang)}',
  );
  // dept select in NewRequestDialog (line 796)
  s = rf(s, '{lang === \'ar\' ? d.nameAr : d.nameEn}', '{localName(d.nameEn, d.nameAr, lang)}');
  // calendar holiday map (CalendarTab line 935)
  s = rf(s,
    'map[h.date] = lang === \'ar\' ? h.nameAr : h.nameEn;',
    'map[h.date] = localName(h.nameEn, h.nameAr, lang);',
  );
  write('artifacts/hrms/src/pages/leave.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 13. overtime.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/overtime.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? rule.nameEn : rule.nameAr}', '{localName(rule.nameEn, rule.nameAr, lang)}');
  write('artifacts/hrms/src/pages/overtime.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 14. pay-components.tsx  (already has lang)
//     Line 195: primary name → localName
//     Line 196: secondary (shows OPPOSITE language as bilingual subtitle) — leave
//     Line 187: CALC_METHODS dynamic property access → two-line form
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/pay-components.tsx');
  s = addImport(s);
  // calcLabel — replace the one-liner with a two-liner
  s = rf(s,
    "const calcLabel = CALC_METHODS.find(m => m.value === c.calculationMethod)?.[lang === 'ar' ? 'labelAr' : 'labelEn'] ?? c.calculationMethod;",
    "const _calcMethod = CALC_METHODS.find(m => m.value === c.calculationMethod);\n                  const calcLabel = localName(_calcMethod?.labelEn ?? c.calculationMethod, _calcMethod?.labelAr, lang);",
  );
  // primary name cell (line 195)
  s = rf(s, "{lang === 'ar' ? c.nameAr : c.nameEn}", "{localName(c.nameEn, c.nameAr, lang)}");
  write('artifacts/hrms/src/pages/pay-components.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 15. payroll-payslip.tsx  (already has lang; bilingal pay-comp columns — skip)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/payroll-payslip.tsx');
  s = addImport(s);
  s = rf(s, "lang === 'ar' ? employee.jobTitleAr : employee.jobTitleEn", "localName(employee.jobTitleEn, employee.jobTitleAr, lang)");
  s = rf(s, "lang === 'ar' ? employee.departmentNameAr : employee.departmentNameEn", "localName(employee.departmentNameEn, employee.departmentNameAr, lang)");
  s = rf(s, "lang === 'ar' ? period.nameAr : period.nameEn", "localName(period.nameEn, period.nameAr, lang)");
  write('artifacts/hrms/src/pages/payroll-payslip.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 16. payroll.tsx  (each sub-component already has lang where needed)
//     Static badge labels (cfg.label[0/1], tab.label[0/1]) are always-defined
//     compile-time constants — leave those as-is.
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/payroll.tsx');
  s = addImport(s);
  // NoShowsCard employee name (line 424)
  s = rf(s, '{lang === \'ar\' ? emp.employeeNameAr : emp.employeeNameEn}', '{localName(emp.employeeNameEn, emp.employeeNameAr, lang)}');
  // dialog body state employeeName (line 449)
  s = rf(s, "employeeName: lang === 'ar' ? emp.employeeNameAr : emp.employeeNameEn,", "employeeName: localName(emp.employeeNameEn, emp.employeeNameAr, lang),");
  // PeriodDetail period name chip (line 654)
  s = rf(s, '{lang === \'ar\' ? period.nameAr : period.nameEn}', '{localName(period.nameEn, period.nameAr, lang)}');
  // Run row employee name (line 816)
  s = rf(s,
    '{lang === \'ar\' ? (run.employeeNameAr || run.employeeNameEn) : run.employeeNameEn}',
    '{localName(run.employeeNameEn, run.employeeNameAr, lang)}',
  );
  // main Payroll() dept chart (line 932) — in a computed object, no braces
  s = rf(s, "dept: lang === 'ar' ? d.departmentNameAr : d.departmentNameEn,", "dept: localName(d.departmentNameEn, d.departmentNameAr, lang),");
  // period select item (line 1080) — second period.nameAr/En pair
  s = rf(s, '{lang === \'ar\' ? period.nameAr : period.nameEn}', '{localName(period.nameEn, period.nameAr, lang)}');
  write('artifacts/hrms/src/pages/payroll.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 17. production-readiness.tsx  (already has lang)
//     Note: uses cat.title (not titleEn) as the English field
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/production-readiness.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'ar\' ? cat.titleAr : cat.title}', '{localName(cat.title, cat.titleAr, lang)}');
  write('artifacts/hrms/src/pages/production-readiness.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 18. readiness.tsx  (import already present; lang already in main component)
//     Line 293: offline gateway name (uses g.name as the English field)
//     Line 334: primary module name → localName
//     Line 337: secondary (OPPOSITE language on purpose) — leave as bilingual subtitle
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/readiness.tsx');
  // offline gateway card (readiness.tsx:293)
  s = rf(s, '{lang === \'ar\' && g.nameAr ? g.nameAr : g.name}', '{localName(g.name, g.nameAr, lang)}');
  // primary module name (readiness.tsx:334)
  s = rf(s,
    '                        {lang === \'ar\' ? mod.nameAr : mod.nameEn}',
    '                        {localName(mod.nameEn, mod.nameAr, lang)}',
  );
  write('artifacts/hrms/src/pages/readiness.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 19. roles.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/roles.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? role.nameEn : role.nameAr}', '{localName(role.nameEn, role.nameAr, lang)}');
  write('artifacts/hrms/src/pages/roles.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 20. rosters.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/rosters.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? d.nameEn : d.nameAr}', '{localName(d.nameEn, d.nameAr, lang)}');
  s = rf(s, '{lang === \'en\' ? emp.nameEn : emp.nameAr}', '{localName(emp.nameEn, emp.nameAr, lang)}');
  write('artifacts/hrms/src/pages/rosters.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 21. salary-grades.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/salary-grades.tsx');
  s = addImport(s);
  // filter buttons (line 182) — dynamic property access on static ORG_TYPES array
  s = rf(s,
    "ORG_TYPES.find(o => o.value === v)?.[lang === 'ar' ? 'labelAr' : 'labelEn']",
    "localName(ORG_TYPES.find(o => o.value === v)?.labelEn, ORG_TYPES.find(o => o.value === v)?.labelAr, lang)",
  );
  // orgLabel variable (line 194) — replace single-liner with two-liner
  s = rf(s,
    "const orgLabel = ORG_TYPES.find(o => o.value === org)?.[lang === 'ar' ? 'labelAr' : 'labelEn'] ?? org;",
    "const _orgType = ORG_TYPES.find(o => o.value === org);\n            const orgLabel = localName(_orgType?.labelEn ?? org, _orgType?.labelAr, lang);",
  );
  // grade name cell (line 232)
  s = rf(s, "{lang === 'ar' ? g.nameAr : g.nameEn}", "{localName(g.nameEn, g.nameAr, lang)}");
  write('artifacts/hrms/src/pages/salary-grades.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 22. security-tests.tsx  (line 118 component has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/security-tests.tsx');
  s = addImport(s);
  s = ra(s, '{lang === \'ar\' ? s.titleAr : s.titleEn}', '{localName(s.titleEn, s.titleAr, lang)}');
  write('artifacts/hrms/src/pages/security-tests.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 23. shifts.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/shifts.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? shift.nameEn : shift.nameAr}', '{localName(shift.nameEn, shift.nameAr, lang)}');
  write('artifacts/hrms/src/pages/shifts.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 24. uat-scripts.tsx  (line 183 component has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/uat-scripts.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'ar\' ? sc.titleAr : sc.titleEn}', '{localName(sc.titleEn, sc.titleAr, lang)}');
  write('artifacts/hrms/src/pages/uat-scripts.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 25. users.tsx  (already has lang)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/users.tsx');
  s = addImport(s);
  s = rf(s, '{lang === \'en\' ? role.nameEn : role.nameAr}', '{localName(role.nameEn, role.nameAr, lang)}');
  write('artifacts/hrms/src/pages/users.tsx', s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 26. pilot-control-center.tsx  (import + lang already present)
// ──────────────────────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/pilot-control-center.tsx');
  // "Tested by" template string (line 602)
  s = rf(s,
    '`${t(\'Tested by\', \'اختبرها\')} ${lang === \'ar\' ? (p.lastTestedByNameAr || p.lastTestedByNameEn) : (p.lastTestedByNameEn || p.lastTestedByNameAr)}`',
    '`${t(\'Tested by\', \'اختبرها\')} ${localName(p.lastTestedByNameEn, p.lastTestedByNameAr, lang)}`',
  );
  write('artifacts/hrms/src/pages/pilot-control-center.tsx', s);
}

console.log('\nAll done. Run `pnpm run typecheck` next.');
