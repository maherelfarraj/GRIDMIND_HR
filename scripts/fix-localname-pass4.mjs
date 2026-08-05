/**
 * Pass 4: fix all remaining English-only person-name renders where Arabic data
 * exists in the API client types.
 *
 * Patterns fixed:
 *  • `{e.firstNameEn} {e.lastNameEn}` in SelectItem children → localFullName
 *  • `emp.firstNameEn.charAt(0)` initials → localFullName(...).charAt(0)
 *  • `{emp.firstNameEn} {emp.lastNameEn}` in card renders → localFullName
 *  • `getEmpName` helper bodies → localFullName
 *  • `{req.employeeNameEn}` table cells → localName (has employeeNameAr?)
 *  • `{balance.employeeNameEn} — {balance.leaveTypeNameEn}` dialog desc → localName
 *  • Avatar initials from firstNameEn/lastNameEn pair → localFullName.split
 *
 * Also adds `lang` to sub-component useLanguage() destructures that were
 * missing it, and adds localFullName to imports where needed.
 *
 * Run: node scripts/fix-localname-pass4.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

function read(rel)  { return readFileSync(resolve(ROOT, rel), 'utf8'); }
function write(rel, s) { writeFileSync(resolve(ROOT, rel), s, 'utf8'); console.log(`  ✓ ${rel}`); }

/** Replace first occurrence; throw if not found. */
function rf(src, needle, replacement, label) {
  const idx = src.indexOf(needle);
  if (idx === -1) throw new Error(`NOT FOUND${label ? ' [' + label + ']' : ''}: ${JSON.stringify(needle.slice(0, 100))}`);
  return src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}
/** Replace ALL occurrences; throw if none found. */
function ra(src, needle, replacement, label) {
  if (!src.includes(needle)) throw new Error(`NOT FOUND (all)${label ? ' [' + label + ']' : ''}: ${JSON.stringify(needle.slice(0, 100))}`);
  return src.split(needle).join(replacement);
}

/** Add localFullName to an existing localName import from '@/lib/localise'. */
function addFullNameImport(src) {
  if (src.includes('localFullName')) return src; // already there
  return src
    .replace("{ localName }", "{ localName, localFullName }")
    .replace("import { localName, localFullName } from '@/lib/localise';",
             "import { localName, localFullName } from '@/lib/localise';"); // idempotent
}

/** Add localName + localFullName import after the useLanguage import line. */
function addBothImports(src) {
  if (src.includes("from '@/lib/localise'")) return addFullNameImport(src);
  return rf(src,
    "import { useLanguage } from '@/hooks/use-language';",
    "import { useLanguage } from '@/hooks/use-language';\nimport { localName, localFullName } from '@/lib/localise';",
  );
}

// The common SelectItem replacement — applies to every `{e.firstNameEn} {e.lastNameEn}` pair.
const EMP_SELECT_ITEM_OLD = `>{e.firstNameEn} {e.lastNameEn}</SelectItem>`;
const EMP_SELECT_ITEM_NEW = `>{localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}</SelectItem>`;

// ── 1. manager-portal.tsx ─────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/manager-portal.tsx');
  s = addFullNameImport(s);

  // NewDelegationDialog: add lang to useLanguage() destructure (only has t)
  s = rf(s, "const { t } = useLanguage();\n  const { toast } = useToast();\n  const qc = useQueryClient();\n  const { data: empData } = useListEmployees({ limit: 500 } as any);\n  const { mutate, isPending } = useCreateApprovalDelegation();",
           "const { t, lang } = useLanguage();\n  const { toast } = useToast();\n  const qc = useQueryClient();\n  const { data: empData } = useListEmployees({ limit: 500 } as any);\n  const { mutate, isPending } = useCreateApprovalDelegation();",
           'manager-portal NewDelegationDialog lang');

  // Delegation selector
  s = rf(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'manager-portal selector');

  // getEmpName helper (in main component, lang already available)
  s = rf(s,
    "return e ? `${e.firstNameEn} ${e.lastNameEn}` : `#${id}`;",
    "return e ? localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang) : `#${id}`;",
    'manager-portal getEmpName',
  );

  // Team card — avatar initial (single char)
  s = rf(s,
    '{emp.firstNameEn.charAt(0)}',
    '{localFullName(emp.firstNameEn, emp.lastNameEn, emp.firstNameAr, emp.lastNameAr, lang).charAt(0)}',
    'manager-portal avatar initial',
  );

  // Team card — name display
  s = rf(s,
    '<p className="font-medium text-sm truncate">{emp.firstNameEn} {emp.lastNameEn}</p>',
    '<p className="font-medium text-sm truncate">{localFullName(emp.firstNameEn, emp.lastNameEn, emp.firstNameAr, emp.lastNameAr, lang)}</p>',
    'manager-portal team card name',
  );

  // Pending leave row — r is typed `any`; LeaveRequestSummary has employeeNameAr?
  s = rf(s,
    '{r.employeeNameEn || `#${r.employeeId}`}',
    '{localName(r.employeeNameEn, r.employeeNameAr, lang) || `#${r.employeeId}`}',
    'manager-portal pending leave row',
  );

  write('artifacts/hrms/src/pages/manager-portal.tsx', s);
}

// ── 2. recruitment.tsx ────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/recruitment.tsx');
  s = addFullNameImport(s);
  // Selector — lang available at line 62 in the component that renders this
  s = rf(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'recruitment selector');
  write('artifacts/hrms/src/pages/recruitment.tsx', s);
}

// ── 3. leave.tsx ──────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave.tsx');
  s = addFullNameImport(s);

  // NewRequestDialog employee selector (multiline)
  s = rf(s,
    '                    {e.firstNameEn} {e.lastNameEn}\n                  </SelectItem>',
    '                    {localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}\n                  </SelectItem>',
    'leave NewRequestDialog employee selector',
  );

  // NewRequestDialog covering-employee selector (multiline, same pattern — second occurrence)
  s = rf(s,
    '                    {e.firstNameEn} {e.lastNameEn}\n                  </SelectItem>',
    '                    {localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}\n                  </SelectItem>',
    'leave covering employee selector',
  );

  // Search filter — also search Arabic name so Arabic-only queries match
  s = rf(s,
    'r.employeeNameEn.toLowerCase().includes(q)',
    '(r.employeeNameEn + \' \' + (r.employeeNameAr ?? \'\')).toLowerCase().includes(q)',
    'leave search filter',
  );

  // My-requests table cell (line 552) — req.employeeNameEn
  s = rf(s,
    '<TableCell>{req.employeeNameEn}</TableCell>\n                          <TableCell>\n                            <Badge\n                              variant="outline"\n                              className="text-xs"',
    '<TableCell>{localName(req.employeeNameEn, req.employeeNameAr, lang)}</TableCell>\n                          <TableCell>\n                            <Badge\n                              variant="outline"\n                              className="text-xs"',
    'leave my-requests table cell',
  );

  // Team-queue row (line 833) — req.employeeNameEn
  s = rf(s,
    '<TableCell className="font-medium">{req.employeeNameEn}</TableCell>\n                        <TableCell className="text-sm text-muted-foreground">\n                          {(req as any).departmentId ?? \'—\'}',
    '<TableCell className="font-medium">{localName(req.employeeNameEn, req.employeeNameAr, lang)}</TableCell>\n                        <TableCell className="text-sm text-muted-foreground">\n                          {(req as any).departmentId ?? \'—\'}',
    'leave team-queue row',
  );

  // Calendar entry — LeaveCalendarEntry type has NO employeeNameAr → leave as-is
  // (lines ~998, ~1000 — cannot fix without schema change)

  write('artifacts/hrms/src/pages/leave.tsx', s);
}

// ── 4. leave-balances.tsx ─────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave-balances.tsx');

  // AdjustDialog: add lang to useLanguage() destructure
  s = rf(s,
    "function AdjustDialog({ balance, onClose }: AdjustDialogProps) {\n  const { t } = useLanguage();",
    "function AdjustDialog({ balance, onClose }: AdjustDialogProps) {\n  const { t, lang } = useLanguage();",
    'leave-balances AdjustDialog lang',
  );

  // Dialog description
  s = rf(s,
    '{balance.employeeNameEn} — {balance.leaveTypeNameEn} ({balance.year})',
    '{localName(balance.employeeNameEn, balance.employeeNameAr, lang)} — {localName(balance.leaveTypeNameEn, balance.leaveTypeNameAr, lang)} ({balance.year})',
    'leave-balances dialog desc',
  );

  write('artifacts/hrms/src/pages/leave-balances.tsx', s);
}

// ── 5. skills.tsx ─────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/skills.tsx');
  s = addBothImports(s);

  // Main Skills component: add lang
  s = rf(s,
    "export default function Skills() {\n  const { t } = useLanguage();",
    "export default function Skills() {\n  const { t, lang } = useLanguage();",
    'skills lang',
  );

  // getEmpName
  s = rf(s,
    "return e ? `${e.firstNameEn} ${e.lastNameEn}` : `#${id}`;",
    "return e ? localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang) : `#${id}`;",
    'skills getEmpName',
  );

  // Selector
  s = rf(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'skills selector');

  write('artifacts/hrms/src/pages/skills.tsx', s);
}

// ── 6. disciplinary.tsx ───────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/disciplinary.tsx');
  s = addBothImports(s);

  // NewDisciplinaryDialog: add lang
  s = rf(s,
    "function NewDisciplinaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t } = useLanguage();",
    "function NewDisciplinaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t, lang } = useLanguage();",
    'disciplinary NewDisciplinaryDialog lang',
  );

  // PromotionDialog: add lang (contains 2 selectors)
  s = rf(s,
    "function PromotionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t } = useLanguage();",
    "function PromotionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t, lang } = useLanguage();",
    'disciplinary PromotionDialog lang',
  );

  // 3 selectors (all identical string, use ra)
  s = ra(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'disciplinary selectors');

  write('artifacts/hrms/src/pages/disciplinary.tsx', s);
}

// ── 7. probation.tsx ─────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/probation.tsx');
  s = addBothImports(s);

  // NewProbationDialog: add lang
  s = rf(s,
    "function NewProbationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t } = useLanguage();",
    "function NewProbationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t, lang } = useLanguage();",
    'probation NewProbationDialog lang',
  );

  // Selector
  s = rf(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'probation selector');

  write('artifacts/hrms/src/pages/probation.tsx', s);
}

// ── 8. training.tsx ───────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/training.tsx');
  s = addFullNameImport(s);

  // AddCertDialog: add lang
  s = rf(s,
    "function AddCertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t } = useLanguage();",
    "function AddCertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {\n  const { t, lang } = useLanguage();",
    'training AddCertDialog lang',
  );

  // AddCertDialog selector
  s = rf(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'training cert selector');

  // Main Training component getEmpName (lang already available there)
  s = rf(s,
    "return e ? `${e.firstNameEn} ${e.lastNameEn}` : `#${id}`;",
    "return e ? localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang) : `#${id}`;",
    'training getEmpName',
  );

  write('artifacts/hrms/src/pages/training.tsx', s);
}

// ── 9. leave-config.tsx ───────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave-config.tsx');
  s = addFullNameImport(s);

  // DelegationDialog: add lang (line ~608)
  s = rf(s,
    "function DelegationDialog({ open, onClose }: DelegationDialogProps) {\n  const { t } = useLanguage();",
    "function DelegationDialog({ open, onClose }: DelegationDialogProps) {\n  const { t, lang } = useLanguage();",
    'leave-config DelegationDialog lang',
  );

  // 2 selectors (identical string) in DelegationDialog
  s = ra(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'leave-config delegation selectors');

  write('artifacts/hrms/src/pages/leave-config.tsx', s);
}

// ── 10. document-management.tsx ───────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/document-management.tsx');
  s = addFullNameImport(s);

  // Both selectors (all sub-components already have lang)
  s = ra(s, EMP_SELECT_ITEM_OLD, EMP_SELECT_ITEM_NEW, 'document-management selectors');

  write('artifacts/hrms/src/pages/document-management.tsx', s);
}

// ── 11. recruitment-application.tsx ───────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/recruitment-application.tsx');
  s = addBothImports(s);

  // Main component: add lang
  s = rf(s,
    "export default function RecruitmentApplication() {\n  const { t } = useLanguage();",
    "export default function RecruitmentApplication() {\n  const { t, lang } = useLanguage();",
    'recruitment-application lang',
  );

  // Applicant name display (Applicant type has firstNameAr?/lastNameAr?)
  s = rf(s,
    "`${applicant.firstNameEn ?? ''} ${applicant.lastNameEn ?? ''}`.trim() || '—'",
    "localFullName(applicant.firstNameEn, applicant.lastNameEn, applicant.firstNameAr, applicant.lastNameAr, lang) || '—'",
    'recruitment-application applicant name',
  );

  write('artifacts/hrms/src/pages/recruitment-application.tsx', s);
}

// ── 12. employees/index.tsx — avatar initials ─────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/employees/index.tsx');
  // Avatar fallback initials — use localFullName and take first 2 chars
  s = rf(s,
    '{employee.firstNameEn.charAt(0)}{employee.lastNameEn.charAt(0)}',
    '{localFullName(employee.firstNameEn, employee.lastNameEn, employee.firstNameAr, employee.lastNameAr, lang).split(\' \').map(n => n[0]).filter(Boolean).slice(0,2).join(\'\')}',
    'employees/index avatar initials',
  );
  write('artifacts/hrms/src/pages/employees/index.tsx', s);
}

// ── 13. employees/[id].tsx — avatar initials ──────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/employees/[id].tsx');
  s = rf(s,
    '{employee.firstNameEn.charAt(0)}{employee.lastNameEn.charAt(0)}',
    '{localFullName(employee.firstNameEn, employee.lastNameEn, employee.firstNameAr, employee.lastNameAr, lang).split(\' \').map(n => n[0]).filter(Boolean).slice(0,2).join(\'\')}',
    'employees/[id] avatar initials',
  );
  write('artifacts/hrms/src/pages/employees/[id].tsx', s);
}

console.log('\nAll done. Run `pnpm run typecheck && pnpm test` next.');
