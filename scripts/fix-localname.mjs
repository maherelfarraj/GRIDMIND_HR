/**
 * Applies all remaining localName fixes across HRMS pages.
 * Run with: node scripts/fix-localname.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}
function write(rel, content) {
  writeFileSync(resolve(ROOT, rel), content, 'utf8');
  console.log(`  ✓ ${rel}`);
}
/** Replace the FIRST occurrence of needle with replacement; throws if not found. */
function rf(src, needle, replacement) {
  const idx = src.indexOf(needle);
  if (idx === -1) throw new Error(`NOT FOUND: ${JSON.stringify(needle.slice(0, 100))}`);
  return src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}
/** Replace ALL occurrences; throws if none found. */
function ra(src, needle, replacement) {
  if (!src.includes(needle)) throw new Error(`NOT FOUND (all): ${JSON.stringify(needle.slice(0, 100))}`);
  return src.split(needle).join(replacement);
}
/** Add `import { localName }` after the useLanguage import line. */
function addImport(src) {
  if (src.includes("from '@/lib/localise'")) return src;
  return rf(src,
    "import { useLanguage } from '@/hooks/use-language';",
    "import { useLanguage } from '@/hooks/use-language';\nimport { localName } from '@/lib/localise';"
  );
}
/** Change `const { t } = useLanguage()` → `const { t, lang } = useLanguage()` immediately
 *  after `anchor` (the function signature/comment that uniquely identifies the component). */
function addLang(src, anchor) {
  const hookLine   = '  const { t } = useLanguage();';
  const replacement = '  const { t, lang } = useLanguage();';
  const anchorIdx = src.indexOf(anchor);
  if (anchorIdx === -1) throw new Error(`Anchor not found: ${JSON.stringify(anchor.slice(0, 80))}`);
  // Find the first hookLine AFTER the anchor
  const afterAnchor = src.slice(anchorIdx);
  const localIdx = afterAnchor.indexOf(hookLine);
  if (localIdx === -1) throw new Error(`hookLine not found after anchor: ${JSON.stringify(anchor.slice(0, 80))}`);
  const absIdx = anchorIdx + localIdx;
  return src.slice(0, absIdx) + replacement + src.slice(absIdx + hookLine.length);
}

// ═══════════════════════════════════════════════════════════════════════════════

// 1. document-management.tsx ─────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/document-management.tsx');
  // Add lang to NewDocumentDialog
  s = addLang(s, 'function NewDocumentDialog(');
  // Fix category select in NewDocumentDialog (line ~433)
  s = rf(s,
    '<SelectItem key={c.id} value={String(c.id)}>{(c as any).nameEn ?? (c as any).code}</SelectItem>',
    '<SelectItem key={c.id} value={String(c.id)}>{localName((c as any).nameEn ?? (c as any).code, (c as any).nameAr, lang)}</SelectItem>'
  );
  // Add lang to TemplatesTab
  s = addLang(s, 'function TemplatesTab()');
  // Add lang to CategoriesTab
  s = addLang(s, 'function CategoriesTab()');
  write('artifacts/hrms/src/pages/document-management.tsx', s);
}

// 2. recruitment.tsx ─────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/recruitment.tsx');
  s = addLang(s, 'function NewRequisitionDialog(');
  write('artifacts/hrms/src/pages/recruitment.tsx', s);
}

// 3. duty-stations.tsx ───────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/duty-stations.tsx');
  s = addImport(s);
  s = addLang(s, 'export default function DutyStations()');
  s = rf(s,
    '<h3 className="font-semibold text-gray-900 dark:text-white leading-tight">{s.nameEn}</h3>',
    '<h3 className="font-semibold text-gray-900 dark:text-white leading-tight">{localName(s.nameEn, s.nameAr, lang)}</h3>'
  );
  write('artifacts/hrms/src/pages/duty-stations.tsx', s);
}

// 4. leave.tsx ───────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/leave.tsx');
  s = addImport(s);
  s = addLang(s, 'function NewRequestDialog(');
  s = rf(s, '{lt.nameEn}', '{localName(lt.nameEn, lt.nameAr, lang)}');
  write('artifacts/hrms/src/pages/leave.tsx', s);
}

// 5. report-builder.tsx ──────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/report-builder.tsx');
  s = addImport(s);
  s = addLang(s, 'function MyReportsTab()');
  s = rf(s,
    "{cfg.nameEn ?? cfg.name ?? 'Untitled'}",
    "{localName(cfg.nameEn ?? cfg.name, cfg.nameAr, lang)}"
  );
  write('artifacts/hrms/src/pages/report-builder.tsx', s);
}

// 6. policy-localization.tsx — lang already in scope at line 167 ─────────────
{
  let s = read('artifacts/hrms/src/pages/policy-localization.tsx');
  s = addImport(s);
  s = ra(s,
    '<SelectItem key={o.id} value={String(o.id)}>{o.nameEn}</SelectItem>',
    '<SelectItem key={o.id} value={String(o.id)}>{localName(o.nameEn, o.nameAr, lang)}</SelectItem>'
  );
  s = rf(s, '{et.labelEn}', '{localName(et.labelEn, et.labelAr, lang)}');
  write('artifacts/hrms/src/pages/policy-localization.tsx', s);
}

// 7. org-branding.tsx ────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/org-branding.tsx');
  s = addImport(s);
  s = addLang(s, 'export default function OrgBranding()');
  s = rf(s,
    '<SelectItem key={o.id} value={String(o.id)}>{o.nameEn}</SelectItem>',
    '<SelectItem key={o.id} value={String(o.id)}>{localName(o.nameEn, o.nameAr, lang)}</SelectItem>'
  );
  s = rf(s, '{tp.nameEn}', '{localName(tp.nameEn, tp.nameAr, lang)}');
  write('artifacts/hrms/src/pages/org-branding.tsx', s);
}

// 8. integration-governance.tsx ──────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/integration-governance.tsx');
  s = addImport(s);
  // Add lang to HealthSettingsDialog
  s = addLang(s, 'function HealthSettingsDialog(');
  // Both dialog subtitle profile names (LinkVaultRefDialog line 422 + HealthSettingsDialog line 510)
  s = ra(s,
    '<p className="text-sm text-slate-400">{profile?.profileName}</p>',
    '<p className="text-sm text-slate-400">{localName(profile?.profileName, profile?.profileNameAr, lang)}</p>'
  );
  // ProfileDetailDialog detail.profileName (line 582)
  s = rf(s,
    '<p className="text-white font-medium">{detail.profileName}</p>',
    '<p className="text-white font-medium">{localName(detail.profileName, detail.profileNameAr, lang)}</p>'
  );
  // Health alert prof?.profileName (line 923)
  s = rf(s,
    '<span className="text-white font-medium">{prof?.profileName ?? `#${a.profileId}`}</span>',
    '<span className="text-white font-medium">{localName(prof?.profileName ?? `#${a.profileId}`, prof?.profileNameAr, lang)}</span>'
  );
  // Permissions rules table r.titleEn (line 1135)
  s = rf(s,
    '<TableCell className="text-white">{r.titleEn}</TableCell>',
    '<TableCell className="text-white">{localName(r.titleEn, r.titleAr, lang)}</TableCell>'
  );
  // SMTP test confirm (line 1251)
  s = rf(s,
    '<strong className="text-white">{smtpTestTarget?.profileName}</strong>',
    '<strong className="text-white">{localName(smtpTestTarget?.profileName, smtpTestTarget?.profileNameAr, lang)}</strong>'
  );
  // Suspend confirm (line 1291)
  s = rf(s,
    '<strong className="text-white">{suspendTarget?.profileName}</strong>?',
    '<strong className="text-white">{localName(suspendTarget?.profileName, suspendTarget?.profileNameAr, lang)}</strong>?'
  );
  // Delete vault ref warning — fix the Arabic template string
  s = rf(s,
    '`هذا المرجع مستخدم في ${linked.length} ملف اتصال: ${linked.map((p: any) => p.profileName).join(\', \')}. ستفقد تلك الملفات مرجع بيانات الاعتماد.`',
    '`هذا المرجع مستخدم في ${linked.length} ملف اتصال: ${linked.map((p: any) => p.profileNameAr || p.profileName).join(\', \')}. ستفقد تلك الملفات مرجع بيانات الاعتماد.`'
  );
  write('artifacts/hrms/src/pages/integration-governance.tsx', s);
}

// 9. reports.tsx ─────────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/reports.tsx');
  s = addImport(s);
  s = addLang(s, 'function RunReportsTab(');
  s = addLang(s, 'function ScheduledTab()');
  s = addLang(s, 'function NewScheduleDialog(');
  s = addLang(s, 'function OutputHistoryTab()');
  // Card title in RunReportsTab (line 234)
  s = rf(s, '{d.nameEn ?? d.name}', '{localName(d.nameEn ?? d.name, d.nameAr, lang)}');
  // Scheduled table cell (line 342)
  s = rf(s,
    "{sc.nameEn ?? def?.nameEn ?? '—'}",
    "{localName(sc.nameEn ?? def?.nameEn, sc.nameAr ?? def?.nameAr, lang)}"
  );
  // Select items (two identical occurrences in NewScheduleDialog and OutputHistoryTab)
  s = ra(s,
    '<SelectItem key={d.id} value={String(d.id)}>{(d as any).nameEn ?? (d as any).name}</SelectItem>',
    '<SelectItem key={d.id} value={String(d.id)}>{localName((d as any).nameEn ?? (d as any).name, (d as any).nameAr, lang)}</SelectItem>'
  );
  // History table cell (line 623)
  s = rf(s,
    "{def?.nameEn ?? def?.name ?? '—'}",
    "{localName(def?.nameEn ?? def?.name, def?.nameAr, lang)}"
  );
  write('artifacts/hrms/src/pages/reports.tsx', s);
}

// 10. manager-portal.tsx ─────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/manager-portal.tsx');
  s = addImport(s);
  s = addLang(s, 'export default function ManagerPortal()');
  s = ra(s, '{a.titleEn}', '{localName(a.titleEn, a.titleAr, lang)}');
  s = rf(s, '{g.titleEn}', '{localName(g.titleEn, g.titleAr, lang)}');
  write('artifacts/hrms/src/pages/manager-portal.tsx', s);
}

// 11. admin-airgap.tsx ───────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/admin-airgap.tsx');
  s = addImport(s);
  s = addLang(s, 'function OverviewTab()');
  s = rf(s, '{bs.nameEn}', '{localName(bs.nameEn, bs.nameAr, lang)}');
  s = addLang(s, 'function BranchServersTab()');
  s = rf(s,
    '<TableCell className="font-medium text-sm">{s.nameEn}</TableCell>',
    '<TableCell className="font-medium text-sm">{localName(s.nameEn, s.nameAr, lang)}</TableCell>'
  );
  write('artifacts/hrms/src/pages/admin-airgap.tsx', s);
}

// 12. my-portal.tsx — lang already present in main component ─────────────────
{
  let s = read('artifacts/hrms/src/pages/my-portal.tsx');
  s = addImport(s);
  s = rf(s,
    '<TableCell className="max-w-48 truncate">{r.titleEn}</TableCell>',
    '<TableCell className="max-w-48 truncate">{localName(r.titleEn, r.titleAr, lang)}</TableCell>'
  );
  s = rf(s,
    '<h3 className="font-semibold">{a.titleEn}</h3>',
    '<h3 className="font-semibold">{localName(a.titleEn, a.titleAr, lang)}</h3>'
  );
  write('artifacts/hrms/src/pages/my-portal.tsx', s);
}

// 13. organizations.tsx ──────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/organizations.tsx');
  s = addImport(s);
  s = addLang(s, 'function OrgDetailDrawer(');
  s = addLang(s, 'export default function Organizations()');
  s = rf(s,
    '<h2 className="text-lg font-bold text-white">{org.nameEn}</h2>',
    '<h2 className="text-lg font-bold text-white">{localName(org.nameEn, org.nameAr, lang)}</h2>'
  );
  s = rf(s,
    '<TableCell className="text-white font-medium">{org.nameEn}</TableCell>',
    '<TableCell className="text-white font-medium">{localName(org.nameEn, org.nameAr, lang)}</TableCell>'
  );
  s = rf(s, '{archiveTarget?.nameEn}', '{localName(archiveTarget?.nameEn, archiveTarget?.nameAr, lang)}');
  write('artifacts/hrms/src/pages/organizations.tsx', s);
}

// 14. notifications.tsx ──────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/notifications.tsx');
  s = addImport(s);
  s = addLang(s, 'function InboxTab()');
  s = rf(s, '{n.titleEn ?? n.title}', '{localName(n.titleEn ?? n.title, n.titleAr, lang)}');
  s = addLang(s, 'function EscalationRulesTab()');
  s = rf(s, '{r.nameEn ?? r.name}', '{localName(r.nameEn ?? r.name, r.nameAr, lang)}');
  write('artifacts/hrms/src/pages/notifications.tsx', s);
}

// 15. succession.tsx ─────────────────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/succession.tsx');
  s = addImport(s);
  s = addLang(s, 'function DevPlanPanel(');
  s = rf(s, '{a.titleEn}', '{localName(a.titleEn, a.titleAr, lang)}');
  write('artifacts/hrms/src/pages/succession.tsx', s);
}

// 16. readiness.tsx — lang already in main component ─────────────────────────
{
  let s = read('artifacts/hrms/src/pages/readiness.tsx');
  s = addImport(s);
  s = rf(s,
    '<td className="py-2.5 px-4 text-sm text-foreground">{d.titleEn}</td>',
    '<td className="py-2.5 px-4 text-sm text-foreground">{localName(d.titleEn, d.titleAr, lang)}</td>'
  );
  write('artifacts/hrms/src/pages/readiness.tsx', s);
}

// 17. pilot-control-center.tsx ───────────────────────────────────────────────
{
  let s = read('artifacts/hrms/src/pages/pilot-control-center.tsx');
  s = addImport(s);
  s = addLang(s, 'function OverrideGateDialog(');
  s = rf(s, '{gate?.titleEn}', '{localName(gate?.titleEn, gate?.titleAr, lang)}');
  // Defects table (main component, lang already present)
  s = rf(s,
    '<TableCell className="text-white text-sm">{d.titleEn}</TableCell>',
    '<TableCell className="text-white text-sm">{localName(d.titleEn, d.titleAr, lang)}</TableCell>'
  );
  // Integration profiles table p.profileName (line 592)
  s = rf(s,
    '<TableCell className="text-white text-xs">{p.profileName}</TableCell>',
    '<TableCell className="text-white text-xs">{localName(p.profileName, (p as any).profileNameAr, lang)}</TableCell>'
  );
  write('artifacts/hrms/src/pages/pilot-control-center.tsx', s);
}

console.log('\nAll done. Run `pnpm run typecheck` next.');
