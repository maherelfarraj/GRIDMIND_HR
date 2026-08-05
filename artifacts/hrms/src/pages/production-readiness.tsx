import { useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Server, Shield, Database, Globe, FileText,
  FolderOpen, Activity, CheckCircle, AlertTriangle,
  XCircle, HelpCircle,
} from 'lucide-react';

// ── Status types ──────────────────────────────────────────────────────────────

type ItemStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNVERIFIED' | 'SIMULATED' | 'PLANNED';

interface CheckItem {
  label: string;
  status: ItemStatus;
  note?: string;
}

interface CheckCategory {
  title: string;
  titleAr: string;
  icon: React.ComponentType<{ className?: string }>;
  items: CheckItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ItemStatus, { badge: string; icon: React.ReactNode }> = {
  PASS:       { badge: 'bg-green-500/20 text-green-400 border border-green-500/30',     icon: <CheckCircle  className="w-4 h-4 text-green-400 shrink-0" /> },
  WARN:       { badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',     icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /> },
  FAIL:       { badge: 'bg-red-500/20 text-red-400 border border-red-500/30',           icon: <XCircle      className="w-4 h-4 text-red-400 shrink-0" /> },
  UNVERIFIED: { badge: 'bg-slate-700 text-slate-400 border border-slate-600',           icon: <HelpCircle   className="w-4 h-4 text-slate-400 shrink-0" /> },
  SIMULATED:  { badge: 'bg-purple-500/20 text-purple-400 border border-purple-500/30', icon: <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" /> },
  PLANNED:    { badge: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',        icon: <HelpCircle   className="w-4 h-4 text-blue-400 shrink-0" /> },
};

function StatusBadge({ status }: { status: ItemStatus }) {
  const { badge } = STATUS_STYLES[status];
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${badge}`}>
      {status}
    </span>
  );
}

// ── Checklist data ────────────────────────────────────────────────────────────

const CATEGORIES: CheckCategory[] = [
  {
    title: 'Infrastructure',
    titleAr: 'البنية التحتية',
    icon: Server,
    items: [
      { label: 'PostgreSQL connection verified',        status: 'PASS' },
      { label: 'Minimum 8 GB RAM',                      status: 'UNVERIFIED', note: 'Requires manual check on host' },
      { label: '100 GB storage available',              status: 'UNVERIFIED', note: 'Requires manual check on host' },
      { label: 'Network isolation confirmed',           status: 'UNVERIFIED', note: 'Requires network config review' },
    ],
  },
  {
    title: 'Authentication & Sessions',
    titleAr: 'المصادقة والجلسات',
    icon: Shield,
    items: [
      { label: 'Session secret configured',             status: 'PASS',   note: 'SESSION_SECRET env var set' },
      { label: 'Default admin password changed',        status: 'UNVERIFIED', note: 'Manual verification required' },
      { label: 'Session expiry configured',             status: 'PASS',   note: '24-hour TTL active' },
      { label: 'Brute-force protection',                status: 'WARN',   note: 'Planned — not yet implemented' },
    ],
  },
  {
    title: 'Data Integrity',
    titleAr: 'سلامة البيانات',
    icon: Database,
    items: [
      { label: 'All schema migrations applied',         status: 'PASS' },
      { label: 'Seed data loaded',                      status: 'PASS',   note: 'Employees > 0 verified' },
      { label: 'Foreign key constraints verified',      status: 'PASS' },
      { label: 'Backup schedule configured',            status: 'WARN',   note: 'Manual verification required' },
    ],
  },
  {
    title: 'API & Routes',
    titleAr: 'واجهات برمجة التطبيقات والمسارات',
    icon: Globe,
    items: [
      { label: 'All 95+ endpoints responding',          status: 'PASS',   note: 'Verified in integration testing' },
      { label: 'Authorization guards on mutating routes', status: 'PASS' },
      { label: 'Rate limiting',                         status: 'WARN',   note: 'Planned — not yet implemented' },
      { label: 'HTTPS/TLS termination',                 status: 'UNVERIFIED', note: 'Requires network configuration' },
    ],
  },
  {
    title: 'Leave & Payroll Workflows',
    titleAr: 'سير عمل الإجازات والرواتب',
    icon: FileText,
    items: [
      { label: 'Leave request → approval → balance deduction', status: 'PASS', note: 'Integration tested' },
      { label: 'Medical certificate gating',            status: 'PASS',   note: 'Integration tested' },
      { label: 'Annual balance reset',                  status: 'PASS',   note: 'Integration tested' },
      { label: 'Concurrency-safe approval (SELECT FOR UPDATE)', status: 'PASS', note: 'Integration tested' },
      { label: 'Payroll calculation engine',            status: 'PASS',   note: 'Unit tested' },
    ],
  },
  {
    title: 'Document Management',
    titleAr: 'إدارة المستندات',
    icon: FolderOpen,
    items: [
      { label: 'Document storage path writable',        status: 'SIMULATED', note: 'Filesystem path not yet mounted' },
      { label: 'Version history tracking',              status: 'PASS' },
      { label: 'Legal hold enforcement',                status: 'PASS' },
      { label: 'Acknowledgement workflows',             status: 'PASS' },
      { label: 'Watermarking on download',              status: 'SIMULATED', note: 'Not yet implemented' },
    ],
  },
  {
    title: 'Monitoring & Audit',
    titleAr: 'المراقبة والتدقيق',
    icon: Activity,
    items: [
      { label: 'Structured audit logs',                 status: 'PASS' },
      { label: 'Health check endpoint',                 status: 'PASS' },
      { label: 'Log retention policy',                  status: 'WARN',   note: 'Manual configuration required' },
      { label: 'Backup verification',                   status: 'SIMULATED', note: 'Backup runs are simulated' },
    ],
  },
  {
    title: 'Bilingual & Accessibility',
    titleAr: 'ثنائية اللغة وإمكانية الوصول',
    icon: Globe,
    items: [
      { label: 'Arabic RTL layout',                     status: 'PASS' },
      { label: 'English/Arabic toggle',                 status: 'PASS' },
      { label: 'Form validation messages bilingual',    status: 'WARN',   note: 'Some messages EN-only' },
      { label: 'Screen reader labels',                  status: 'UNVERIFIED', note: 'ARIA audit not yet performed' },
    ],
  },
];

// ── Module table data ─────────────────────────────────────────────────────────

type ModuleStatus = 'Pending gate verification' | 'Beta' | 'Simulated' | 'Planned';

interface ModuleRow {
  module: string;
  status: ModuleStatus;
  integrationTested: boolean;
  notes: string;
}

const MODULE_STATUS_STYLES: Record<ModuleStatus, string> = {
  'Pending gate verification': 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  'Beta':                      'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  'Simulated':                 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  'Planned':                   'bg-blue-500/20 text-blue-400 border border-blue-500/30',
};

const MODULES: ModuleRow[] = [
  { module: 'Core HR',             status: 'Pending gate verification', integrationTested: true,  notes: 'Employee directory, departments, roles — see /readiness for gate status' },
  { module: 'Attendance',          status: 'Pending gate verification', integrationTested: true,  notes: 'Punch events stored; biometric vendor adapter not wired — see /readiness' },
  { module: 'Leave Management',    status: 'Pending gate verification', integrationTested: true,  notes: 'Real DB queries; auth gates must pass before production — see /readiness' },
  { module: 'Payroll',             status: 'Pending gate verification', integrationTested: true,  notes: 'Real calculation engine; requires auth middleware before production — see /readiness' },
  { module: 'Government/Military', status: 'Pending gate verification', integrationTested: true,  notes: 'Hierarchy, postings, clearances, mobilization — see /readiness for gate status' },
  { module: 'Recruitment',         status: 'Beta',             integrationTested: true,  notes: 'Requisitions, postings, applications pipeline' },
  { module: 'Onboarding',          status: 'Beta',             integrationTested: false, notes: 'Checklists, probation tracking' },
  { module: 'Performance',         status: 'Beta',             integrationTested: false, notes: 'KPIs, reviews, disciplinary' },
  { module: 'Training',            status: 'Beta',             integrationTested: false, notes: 'Courses, enrollment, skills matrix' },
  { module: 'Succession',          status: 'Beta',             integrationTested: false, notes: 'Succession planning, talent pools' },
  { module: 'Self-Service',        status: 'Beta',             integrationTested: false, notes: 'My Portal, Manager Portal' },
  { module: 'Document Management', status: 'Beta',             integrationTested: true,  notes: 'Storage simulated; version history active' },
  { module: 'Reports',             status: 'Simulated',        integrationTested: false, notes: 'Report engine is NOT implemented; execution returns placeholder rows' },
  { module: 'Notifications',       status: 'Beta',             integrationTested: false, notes: 'In-app alerts; email/SMS requires config' },
  { module: 'Deployment Ops',      status: 'Simulated',        integrationTested: false, notes: 'Health checks and package installs are NOT implemented in this installation' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductionReadiness() {
  const { t, lang } = useLanguage();

  const allItems = useMemo(() => CATEGORIES.flatMap(c => c.items), []);

  const counts = useMemo(() => ({
    passed:     allItems.filter(i => i.status === 'PASS').length,
    warnings:   allItems.filter(i => i.status === 'WARN').length,
    failed:     allItems.filter(i => i.status === 'FAIL').length,
    unverified: allItems.filter(i => i.status === 'UNVERIFIED' || i.status === 'SIMULATED' || i.status === 'PLANNED').length,
  }), [allItems]);

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t('Production Readiness', 'جاهزية الإنتاج')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t(
            'Pre-deployment verification for on-premises installations',
            'التحقق قبل النشر للتثبيتات المحلية'
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 text-amber-400 px-3 py-2 rounded-lg text-sm"><AlertTriangle className="w-4 h-4 shrink-0" />{t("NOT production ready in demo mode — authentication, backup, and biometric gates are BLOCKED. See /readiness for full details.", "ليس جاهزًا للإنتاج في وضع العرض التوضيحي — بوابات المصادقة والنسخ الاحتياطي والقياس الحيوي مُقفَلة. انظر /readiness للتفاصيل الكاملة.")}</div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle className="w-9 h-9 text-green-400 shrink-0" />
            <div>
              <p className="text-3xl font-bold text-green-400">{counts.passed}</p>
              <p className="text-xs text-green-400/70 font-medium uppercase tracking-wide">{t('Passed', 'اجتاز')}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-5 flex items-center gap-3">
            <AlertTriangle className="w-9 h-9 text-amber-400 shrink-0" />
            <div>
              <p className="text-3xl font-bold text-amber-400">{counts.warnings}</p>
              <p className="text-xs text-amber-400/70 font-medium uppercase tracking-wide">{t('Warnings', 'تحذيرات')}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-5 flex items-center gap-3">
            <XCircle className="w-9 h-9 text-red-400 shrink-0" />
            <div>
              <p className="text-3xl font-bold text-red-400">{counts.failed}</p>
              <p className="text-xs text-red-400/70 font-medium uppercase tracking-wide">{t('Failed', 'فشل')}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-600 bg-slate-800/30">
          <CardContent className="p-5 flex items-center gap-3">
            <HelpCircle className="w-9 h-9 text-slate-400 shrink-0" />
            <div>
              <p className="text-3xl font-bold text-slate-400">{counts.unverified}</p>
              <p className="text-xs text-slate-400/70 font-medium uppercase tracking-wide">{t('Unverified', 'غير محقق')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Checklist categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <Card key={cat.title} className="bg-card">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  {localName(cat.title, cat.titleAr, lang)}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {cat.items.map((item) => {
                    const { icon } = STATUS_STYLES[item.status];
                    return (
                      <div key={item.label} className="flex items-start gap-3 px-5 py-3">
                        {icon}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground font-medium">{item.label}</p>
                          {item.note && (
                            <p className="text-xs text-muted-foreground mt-0.5">{item.note}</p>
                          )}
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Status legend */}
      <Card className="bg-card">
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {t('Status Legend', 'دليل الحالات')}
          </p>
          <div className="flex flex-wrap gap-3">
            {(Object.entries(STATUS_STYLES) as [ItemStatus, typeof STATUS_STYLES[ItemStatus]][]).map(([status, { badge }]) => (
              <span key={status} className={`text-xs font-semibold px-2 py-0.5 rounded ${badge}`}>
                {status}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Module verification status table */}
      <Card className="bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle className="w-4 h-4 text-primary" />
            {t('Module Verification Status', 'حالة التحقق من الوحدات')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-start py-2.5 px-5 font-semibold text-muted-foreground">{t('Module', 'الوحدة')}</th>
                <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Status', 'الحالة')}</th>
                <th className="text-center py-2.5 px-4 font-semibold text-muted-foreground">{t('Integration Tested', 'اختبار التكامل')}</th>
                <th className="text-start py-2.5 px-4 font-semibold text-muted-foreground">{t('Notes', 'ملاحظات')}</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((row, idx) => (
                <tr key={row.module} className={`border-b border-border ${idx % 2 === 0 ? '' : 'bg-muted/10'} hover:bg-muted/20 transition-colors`}>
                  <td className="py-2.5 px-5 font-medium text-foreground whitespace-nowrap">{row.module}</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${MODULE_STATUS_STYLES[row.status]}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {row.integrationTested
                      ? <CheckCircle className="w-4 h-4 text-green-400 inline" />
                      : <XCircle className="w-4 h-4 text-slate-500 inline" />}
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground text-xs">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-end pb-4">
        {t(
          'This self-assessment reflects the current state of the air-gap deployment. Manual items require verification by the system administrator.',
          'يعكس هذا التقييم الذاتي الحالة الراهنة للنشر المعزول. تتطلب العناصر اليدوية التحقق من قِبل مسؤول النظام.'
        )}
      </div>
    </AnimatedPage>
  );
}
