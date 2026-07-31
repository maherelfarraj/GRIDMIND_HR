import { useEffect, useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, CheckCircle, XCircle, ClipboardList, AlertCircle,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
import { apiFetch } from '@/lib/api';

interface GoLiveSummary {
  isReadyForGoLive: boolean;
  criticalBlockers: number;
  lastEvaluated?: string;
  reason?: string;
}

interface Scorecard {
  id: number;
  moduleKey: string;
  moduleName: string;
  moduleNameAr: string;
  readinessStatus: string;
  readinessPercentage: number;
}

interface Defect {
  id: number;
  defectCode: string;
  module: string;
  severity: string;
  titleEn: string;
  isGoLiveBlocker: boolean;
  daysOpen: number;
  status: string;
}

interface MigrationItem {
  id: number;
  itemName: string;
  priority: string;
  status: string;
  progressPct: number;
  recordsMigrated: number;
  totalRecords: number;
  sourceSystem?: string;
  isGoLiveBlocker: boolean;
}

interface MigrationSummary {
  overallPct: number;
  totalItems: number;
  completedItems: number;
  blockerItems: number;
}

// ─── Static module notes (honest per-module assessment) ──────────────────────

type ModuleStatusKey = 'VERIFIED' | 'PARTIAL' | 'MOCKED' | 'BLOCKED' | 'NOT_STARTED';

interface ModuleNote {
  key: string;
  nameEn: string;
  nameAr: string;
  status: ModuleStatusKey;
  score: number;
  note: string;
}

const MODULE_NOTES: ModuleNote[] = [
  { key: 'authentication',    nameEn: 'Authentication',      nameAr: 'المصادقة',                   status: 'BLOCKED',     score: 10, note: 'No session middleware active; PILOT_AUTH=false' },
  { key: 'authorization',     nameEn: 'Authorization',       nameAr: 'التفويض',                    status: 'BLOCKED',     score: 15, note: 'No role checks on any endpoint; PILOT_AUTH=false' },
  { key: 'payroll',           nameEn: 'Payroll',             nameAr: 'الرواتب',                    status: 'VERIFIED',    score: 92, note: 'Real salary calculation from DB grades; 3-tier OT from punch events' },
  { key: 'leave',             nameEn: 'Leave Management',    nameAr: 'إدارة الإجازات',              status: 'VERIFIED',    score: 90, note: 'Real DB queries; balance checked on approval' },
  { key: 'attendance',        nameEn: 'Attendance',          nameAr: 'الحضور',                     status: 'PARTIAL',     score: 80, note: 'Attendance Gateway live: HMAC-signed ingestion, encrypted offline queue, dedupe, drift detection, attendance materialization — 17 E2E tests. ZKTeco/Suprema still need vendor SDK on real hardware' },
  { key: 'documents',         nameEn: 'Documents',           nameAr: 'المستندات',                  status: 'PARTIAL',     score: 55, note: 'CRUD implemented; file storage is DB blob, not object store' },
  { key: 'recruitment',       nameEn: 'Recruitment',         nameAr: 'التوظيف',                    status: 'PARTIAL',     score: 50, note: 'Full lifecycle schema; automated scoring not implemented' },
  { key: 'performance',       nameEn: 'Performance',         nameAr: 'الأداء',                     status: 'PARTIAL',     score: 45, note: 'Goals and appraisals schema; calibration logic placeholder' },
  { key: 'training',          nameEn: 'Training',            nameAr: 'التدريب',                    status: 'PARTIAL',     score: 40, note: 'Schema implemented; LMS integration not wired' },
  { key: 'reporting',         nameEn: 'Reporting',           nameAr: 'التقارير',                   status: 'MOCKED',      score: 25, note: 'Report builder UI exists; execution returns simulated rows' },
  { key: 'backup_restore',    nameEn: 'Backup & Restore',    nameAr: 'النسخ الاحتياطي والاستعادة', status: 'VERIFIED',    score: 90, note: 'Real pg_dump (custom format) with checksum; restore tested into scratch DB with row-count verification' },
  { key: 'security',          nameEn: 'Security',            nameAr: 'الأمان',                     status: 'BLOCKED',     score: 18, note: '6 of 10 security test checks require real auth guards' },
  { key: 'integration',       nameEn: 'Integration',         nameAr: 'التكامل',                    status: 'PARTIAL',     score: 55, note: 'LDAP/SMTP/device adapters real; OIDC/SAML connection tests simulated' },
  { key: 'bilingual_ui',      nameEn: 'Bilingual UI',        nameAr: 'واجهة ثنائية اللغة',          status: 'VERIFIED',    score: 95, note: 'All pages have t(en, ar) wrappers; Arabic RTL tested' },
  { key: 'approval_workflow', nameEn: 'Approval Workflow',   nameAr: 'سير عمل الموافقات',           status: 'VERIFIED',    score: 88, note: 'Maker-checker enforced; policy governance chain active' },
];

const STATUS_BADGE: Record<ModuleStatusKey, string> = {
  VERIFIED:    'bg-emerald-900 text-emerald-300 border-emerald-700',
  PARTIAL:     'bg-amber-900 text-amber-300 border-amber-700',
  MOCKED:      'bg-orange-900 text-orange-300 border-orange-700',
  BLOCKED:     'bg-red-900 text-red-300 border-red-700',
  NOT_STARTED: 'bg-slate-700 text-slate-400 border-slate-600',
};

const STATUS_BAR: Record<ModuleStatusKey, string> = {
  VERIFIED:    'bg-emerald-500',
  PARTIAL:     'bg-amber-500',
  MOCKED:      'bg-orange-500',
  BLOCKED:     'bg-red-500',
  NOT_STARTED: 'bg-slate-600',
};

// ─── Static unresolved blockers (always visible even if API is down) ──────────

interface StaticBlocker {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  text: string;
}

const STATIC_BLOCKERS: StaticBlocker[] = [
  { severity: 'CRITICAL', text: 'No authentication middleware — all endpoints unauthenticated' },
  { severity: 'CRITICAL', text: 'Keycloak SSO not configured — SSO integration gate fails' },
  { severity: 'HIGH', text: 'ZKTeco/Suprema adapters require licensed vendor SDK + physical device; REST/CSV/simulator paths fully operational via Attendance Gateway' },
  { severity: 'HIGH',     text: 'Input validation missing on ~15 route files (payroll, leave, attendance use raw destructuring)' },
  { severity: 'HIGH',     text: 'Cross-org data isolation pending (Task #43 in progress)' },
  { severity: 'HIGH',     text: 'Config package signing key not rotatable independently of SESSION_SECRET' },
  { severity: 'MEDIUM',   text: 'Report builder execution simulated' },
  { severity: 'MEDIUM',   text: 'Local AI endpoints return mocked results' },
  { severity: 'MEDIUM',   text: 'System health checks return simulated results' },
];

const SEVERITY_BADGE: Record<'CRITICAL' | 'HIGH' | 'MEDIUM', string> = {
  CRITICAL: 'bg-red-900 text-red-300 border-red-700',
  HIGH:     'bg-amber-900 text-amber-300 border-amber-700',
  MEDIUM:   'bg-blue-900 text-blue-300 border-blue-700',
};

// ─── Hardcoded critical blockers (always present) ────────────────────────────

interface KnownBlocker {
  code: string;
  description: string;
  resolution: string;
  taskExists: boolean;
}

const KNOWN_BLOCKERS: KnownBlocker[] = [
  {
    code: 'AUTH',
    description: 'No session authentication middleware. PILOT_AUTH=false on all routes.',
    resolution: 'Wire express-session + set PILOT_AUTH=true before production.',
    taskExists: false,
  },
  {
    code: 'BIOMETRIC',
    description: 'Attendance Gateway implemented (signed ingestion, encrypted offline queue, dedupe, reconciliation, CSV/REST/simulator adapters; 17 E2E tests). Remaining: ZKTeco PUSH and Suprema BioStar adapters need the licensed vendor SDK and a physical device on-site.',
    resolution: 'Install vendor SDK on the gateway host at deployment; wire the ZKTECO/SUPREMA adapter stubs to it. No HR-core changes needed.',
    taskExists: false,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreFromScorecards(scorecards: Scorecard[], key: string): number | null {
  const sc = scorecards.find(s => s.moduleKey === key);
  return sc ? sc.readinessPercentage : null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReadinessPage() {
  const { t, lang } = useLanguage();

  const [summary, setSummary] = useState<GoLiveSummary | null>(null);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [migSummary, setMigSummary] = useState<MigrationSummary | null>(null);
  const [migItems, setMigItems] = useState<MigrationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [sumR, scR, defR, migSumR] = await Promise.allSettled([
        apiFetch('/api/go-live-gates/summary').then(r => r.json()),
        apiFetch('/api/readiness-scorecard').then(r => r.json()),
        apiFetch('/api/pilot-defects?status=open').then(r => r.json()),
        apiFetch('/api/migration-status/summary').then(r => r.json()),
      ]);
      if (sumR.status === 'fulfilled') setSummary(sumR.value);
      if (scR.status === 'fulfilled') setScorecards(Array.isArray(scR.value) ? scR.value : scR.value?.scorecards ?? []);
      if (defR.status === 'fulfilled') setDefects(Array.isArray(defR.value) ? defR.value : defR.value?.defects ?? []);
      if (migSumR.status === 'fulfilled') {
        const v = migSumR.value;
        setMigSummary(v?.summary ?? v ?? null);
        setMigItems(v?.items ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <AnimatedPage className="space-y-8 pb-10">
      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-amber-400" />
          {t('📋 Platform Readiness Report', '📋 تقرير جاهزية المنصة')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('Comprehensive per-module readiness assessment for technical reviewers', 'تقييم شامل لجاهزية كل وحدة للمراجعين التقنيين')}
        </p>
      </div>

      {/* ── Amber disclaimer banner ── */}
      <div className="flex items-start gap-3 bg-amber-950/60 border border-amber-600 rounded-lg px-4 py-3 text-amber-300 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <span>
          {t(
            'This report reflects the current demo installation. Gates marked BLOCKED or WARN must be resolved before production deployment.',
            'يعكس هذا التقرير التثبيت التجريبي الحالي. يجب معالجة البوابات المُعلَّمة بـ BLOCKED أو WARN قبل نشر الإنتاج.'
          )}
        </span>
      </div>

      {/* ── Big go/no-go status card ── */}
      {loading ? (
        <div className="h-24 bg-slate-700/40 rounded-lg animate-pulse" />
      ) : summary ? (
        <div className={`rounded-lg p-6 border-2 ${summary.isReadyForGoLive ? 'bg-emerald-900/30 border-emerald-600' : 'bg-red-900/30 border-red-600'}`}>
          <div className={`text-2xl font-bold flex items-center gap-3 ${summary.isReadyForGoLive ? 'text-emerald-300' : 'text-red-300'}`}>
            {summary.isReadyForGoLive
              ? <><CheckCircle className="w-7 h-7" /> {t('ALL CRITICAL GATES PASSED — System may proceed to go-live', 'اجتازت جميع البوابات الحرجة — يمكن للنظام المتابعة للإطلاق')}</>
              : <><XCircle className="w-7 h-7" /> {t(`NOT READY FOR GO-LIVE — ${summary.criticalBlockers} critical blocker(s) unresolved`, `غير جاهز للإطلاق — ${summary.criticalBlockers} عائق حرج غير محلول`)}</>}
          </div>
          {summary.reason && (
            <p className="text-slate-400 text-sm mt-2">{summary.reason}</p>
          )}
          {!summary.isReadyForGoLive && (
            <p className="text-slate-400 text-sm mt-2">
              {t(
                'Authentication middleware and biometric device integration must be implemented before any production deployment.',
                'يجب تطبيق وسيط المصادقة وتكامل أجهزة القياس الحيوي قبل أي نشر إنتاجي.'
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-5 text-slate-400 text-sm">
          {t('Go-live summary unavailable — API may be down.', 'ملخص الإطلاق غير متاح — قد تكون الـ API معطلة.')}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 1 — Module Status Grid                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-xl font-bold text-foreground mb-4">
          {t('1 — Module Status', '1 — حالة الوحدات')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULE_NOTES.map(mod => {
            // prefer live score from API if available
            const liveScore = scoreFromScorecards(scorecards, mod.key);
            const score = liveScore ?? mod.score;
            return (
              <Card key={mod.key} className="bg-card border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground text-sm">
                        {lang === 'ar' ? mod.nameAr : mod.nameEn}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {lang === 'ar' ? mod.nameEn : mod.nameAr}
                      </p>
                    </div>
                    <Badge className={`text-xs border shrink-0 ${STATUS_BADGE[mod.status]}`}>
                      {mod.status}
                    </Badge>
                  </div>
                  {/* Score bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t('Score', 'النتيجة')}</span>
                      <span>{score}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${STATUS_BAR[mod.status]}`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>
                  {/* Honest note */}
                  <p className="text-xs text-muted-foreground border-t border-border pt-2">
                    {mod.note}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 2 — Critical Blockers                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-xl font-bold text-foreground mb-4">
          {t('2 — Critical Blockers', '2 — العوائق الحرجة')}
        </h2>
        <div className="space-y-3">
          {KNOWN_BLOCKERS.map((b, i) => (
            <Card key={b.code} className="bg-red-950/20 border-red-800">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-red-400 font-bold text-lg shrink-0">{i + 1}.</span>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-red-900 text-red-300 border-red-700 text-xs border font-mono">
                        {b.code}
                      </Badge>
                      {b.taskExists && (
                        <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700 text-xs border">
                          {t('Task exists', 'مهمة موجودة')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-red-200 font-medium">{b.description}</p>
                    <p className="text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">{t('Required: ', 'مطلوب: ')}</span>
                      {b.resolution}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 3 — Open Pilot Defects                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-xl font-bold text-foreground mb-4">
          {t('3 — Open Pilot Defects', '3 — عيوب المرحلة التجريبية المفتوحة')}
        </h2>
        {loading ? (
          <div className="h-20 bg-slate-700/40 rounded animate-pulse" />
        ) : defects.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-5 text-muted-foreground text-sm">
              {t('No open defects found, or defects API unavailable.', 'لا توجد عيوب مفتوحة أو أن API العيوب غير متاحة.')}
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Code', 'الرمز')}</th>
                  <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Severity', 'الخطورة')}</th>
                  <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Module', 'الوحدة')}</th>
                  <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Title', 'العنوان')}</th>
                  <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">{t('Blocker', 'عائق')}</th>
                  <th className="text-end py-2.5 px-4 font-semibold text-muted-foreground">{t('Days Open', 'أيام مفتوحة')}</th>
                </tr>
              </thead>
              <tbody>
                {defects.map((d, idx) => {
                  const sevMap: Record<string, string> = {
                    critical: 'bg-red-900 text-red-300',
                    high: 'bg-amber-900 text-amber-300',
                    medium: 'bg-blue-900 text-blue-300',
                    low: 'bg-slate-700 text-slate-300',
                  };
                  return (
                    <tr key={d.id} className={`border-b border-border ${idx % 2 === 0 ? '' : 'bg-muted/10'} hover:bg-muted/20 transition-colors`}>
                      <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{d.defectCode}</td>
                      <td className="py-2.5 px-4">
                        <Badge className={`text-xs ${sevMap[d.severity] ?? 'bg-slate-700 text-slate-300'}`}>{d.severity}</Badge>
                      </td>
                      <td className="py-2.5 px-4 text-sm text-foreground">{d.module}</td>
                      <td className="py-2.5 px-4 text-sm text-foreground">{d.titleEn}</td>
                      <td className="py-2.5 px-4 text-center">
                        {d.isGoLiveBlocker
                          ? <Badge className="bg-red-900 text-red-300 text-xs">{t('Blocker', 'عائق')}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-end text-muted-foreground text-sm">{d.daysOpen}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 4 — Migration Status                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-xl font-bold text-foreground mb-4">
          {t('4 — Migration Status', '4 — حالة الهجرة')}
        </h2>
        {loading ? (
          <div className="h-20 bg-slate-700/40 rounded animate-pulse" />
        ) : (
          <div className="space-y-4">
            {migSummary && (
              <Card className="bg-card border-border">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{t('Overall Migration Progress', 'تقدم الهجرة الإجمالي')}</span>
                    <span className="text-sm font-bold text-foreground">{migSummary.overallPct ?? 0}%</span>
                  </div>
                  <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${migSummary.overallPct ?? 0}%` }}
                    />
                  </div>
                  <div className="flex gap-6 text-xs text-muted-foreground flex-wrap">
                    <span>{t('Total items:', 'إجمالي العناصر:')} <strong className="text-foreground">{migSummary.totalItems ?? 0}</strong></span>
                    <span>{t('Completed:', 'مكتملة:')} <strong className="text-emerald-400">{migSummary.completedItems ?? 0}</strong></span>
                    <span>{t('Blockers:', 'عوائق:')} <strong className="text-red-400">{migSummary.blockerItems ?? 0}</strong></span>
                  </div>
                </CardContent>
              </Card>
            )}
            {migItems.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Item', 'العنصر')}</th>
                      <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Priority', 'الأولوية')}</th>
                      <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Status', 'الحالة')}</th>
                      <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Progress', 'التقدم')}</th>
                      <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">{t('Blocker', 'عائق')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {migItems.map((item, idx) => (
                      <tr key={item.id} className={`border-b border-border ${idx % 2 === 0 ? '' : 'bg-muted/10'} hover:bg-muted/20 transition-colors`}>
                        <td className="py-2.5 px-4 text-foreground font-medium">{item.itemName}</td>
                        <td className="py-2.5 px-4">
                          <Badge className={`text-xs ${item.priority === 'critical' ? 'bg-red-900 text-red-300' : item.priority === 'high' ? 'bg-amber-900 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>
                            {item.priority}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-4">
                          <Badge className={`text-xs ${item.status === 'completed' ? 'bg-emerald-900 text-emerald-300' : item.status === 'in_progress' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>
                            {item.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden min-w-[60px]">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${item.progressPct ?? 0}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{item.progressPct ?? 0}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {item.isGoLiveBlocker
                            ? <Badge className="bg-red-900 text-red-300 text-xs">{t('Yes', 'نعم')}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!migSummary && migItems.length === 0 && (
              <Card className="bg-card border-border">
                <CardContent className="p-5 text-muted-foreground text-sm">
                  {t('Migration status unavailable — API may be down.', 'حالة الهجرة غير متاحة — قد تكون الـ API معطلة.')}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 5 — Unresolved Blockers (STATIC — always visible)              */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <Card className="bg-amber-950/20 border-amber-700">
          <CardHeader className="pb-3 border-b border-amber-800">
            <CardTitle className="flex items-center gap-2 text-amber-300">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {t(
                'Open Blockers — Must Resolve Before Any Production Deployment',
                'العوائق المفتوحة — يجب معالجتها قبل أي نشر إنتاجي'
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <ol className="space-y-3">
              {STATIC_BLOCKERS.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-amber-500 font-bold shrink-0 w-5 text-sm">{i + 1}.</span>
                  <div className="flex items-start gap-2 flex-wrap">
                    <Badge className={`text-xs border shrink-0 ${SEVERITY_BADGE[b.severity]}`}>
                      {b.severity}
                    </Badge>
                    <span className="text-sm text-foreground">{b.text}</span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-amber-800">
              {t(
                'This list is statically encoded in the component and is always visible regardless of API availability.',
                'هذه القائمة مُضمَّنة بشكل ثابت في المكوّن وتظهر دائمًا بغض النظر عن توفر الـ API.'
              )}
            </p>
          </CardContent>
        </Card>
      </section>
    </AnimatedPage>
  );
}
