/**
 * Production Health Dashboard — GRIDMIND HR + Terra
 *
 * Admin-only operational view. Renders live data from GET /api/admin/production-health
 * with auto-refresh every 60 seconds. Exposes no secrets, passwords, or raw
 * session values — the backend strips those before responding.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Shield,
  Brain,
  Users,
  ClipboardList,
  Activity,
  Clock,
  Lock,
  Fingerprint,
  ServerCrash,
  Gauge,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'healthy' | 'warning' | 'critical';

interface FeatureBreakdown {
  feature: string;
  queries: number;
  tokens: number;
  avgMs: number;
  p95Ms: number;
  successes: number;
  failures: number;
}

interface Recommendation {
  severity: Severity;
  message: string;
}

interface SuperAdminEntry {
  id: number;
  username: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  orgId: number | null;
}

interface DuplicateAdminGroup {
  name: string;
  accounts: Array<{ id: number; username: string; mfaEnabled: boolean; lastLoginAt: string | null }>;
}

interface OrphanedOrgUser {
  id: number;
  username: string;
  orgId: number;
  roleName: string | null;
}

interface AuditEntry {
  id: number;
  actorUserId: number | null;
  action: string;
  entityType: string | null;
  entityLabel: string | null;
  createdAt: string;
}

interface HealthPayload {
  checkedAt: string;
  overallStatus: Severity;
  recommendations: Recommendation[];
  system: { status: Severity; apiUp: boolean; dbUp: boolean };
  ai: {
    status: Severity;
    configured: boolean;
    enabled: boolean;
    model: string | null;
    integrationProvisioned: boolean;
    auditAllQueries: boolean;
    enabledFeatures: string[];
    totalQueries: number;
    totalTokens: number;
    successCount: number;
    failureCount: number;
    auditCoveragePercent: number | null;
    costNote: string;
    featureBreakdown: FeatureBreakdown[];
    recentFailures: Array<{ id: number; feature: string; errorMessage: string | null; createdAt: string }>;
  };
  security: {
    status: Severity;
    activeSuperAdminCount: number;
    superAdmins: SuperAdminEntry[];
    adminsMissingMfaCount: number;
    duplicateAdminGroups: DuplicateAdminGroup[];
    failedLogins7d: number;
    lockouts7d: number;
    inactiveUserCount: number;
    orphanedOrgUserCount: number;
    orphanedOrgUsers: OrphanedOrgUser[];
    activeSessionsByUser: Array<{ userId: number; sessionCount: number }>;
    openAlertsCount: number;
  };
  hr: {
    status: Severity;
    employeeTotal: number;
    employeeActive: number;
    pendingApprovals: number;
    latestAttendanceAt: string | null;
    attendanceFreshHours: number | null;
    payrollPeriods: Array<{ id: number; nameEn: string; status: string; startDate: string; endDate: string; isClosed: boolean }>;
    payrollPeriodCount: number;
  };
  recentAudit: AuditEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFRESH_SECS = 60;

function SeverityBadge({ s }: { s: Severity }) {
  if (s === 'healthy') return (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1 shrink-0">
      <CheckCircle2 className="w-3 h-3" /> Healthy
    </Badge>
  );
  if (s === 'warning') return (
    <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1 shrink-0">
      <AlertTriangle className="w-3 h-3" /> Warning
    </Badge>
  );
  return (
    <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1 shrink-0">
      <XCircle className="w-3 h-3" /> Critical
    </Badge>
  );
}

function SeverityIcon({ s, className }: { s: Severity; className?: string }) {
  if (s === 'healthy') return <CheckCircle2 className={cn('text-emerald-400', className)} />;
  if (s === 'warning') return <AlertTriangle className={cn('text-amber-400', className)} />;
  return <XCircle className={cn('text-red-400', className)} />;
}

function featureLabel(f: string): string {
  const map: Record<string, string> = {
    policy_search: 'Policy Search',
    report_query: 'Report Query',
    document_classify: 'Document Classify',
    anomaly_explain: 'Anomaly Explain',
  };
  return map[f] ?? f;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function StatRow({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-medium tabular-nums', warn && 'text-amber-400')}>{value}</span>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  severity,
  children,
  defaultCollapsed = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  severity: Severity;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <Card className={cn(
      'border',
      severity === 'critical' && 'border-red-500/40',
      severity === 'warning' && 'border-amber-500/30',
      severity === 'healthy' && 'border-border',
    )}>
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            {title}
          </div>
          <div className="flex items-center gap-2">
            <SeverityBadge s={severity} />
            {collapsed
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
          </div>
        </CardTitle>
      </CardHeader>
      {!collapsed && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductionHealth() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_SECS);
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  const isAdmin = user?.roleId === 1;

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/production-health');
      if (res.status === 403) {
        setError('Access restricted — Super Administrator role required.');
        setData(null);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Server returned ${res.status}`);
        setData(null);
        return;
      }
      const json = await res.json() as HealthPayload;
      setData(json);
      setError(null);
      setCountdown(REFRESH_SECS);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // Auto-refresh countdown
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchHealth();
          return REFRESH_SECS;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [fetchHealth]);

  if (!isAdmin) {
    return (
      <AnimatedPage>
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <Lock className="w-12 h-12 text-muted-foreground" />
          <p className="text-muted-foreground text-lg">
            {t('Super Administrator access required.', 'يلزم حساب مسؤول أعلى.')}
          </p>
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="space-y-6 max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Gauge className="w-6 h-6 text-primary" />
              {t('Production Health', 'صحة الإنتاج')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('GRIDMIND HR + Terra — org 1 operational view', 'GRIDMIND HR + Terra — عرض تشغيلي للمؤسسة 1')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('Refreshes in', 'يتجدد خلال')} {countdown}s
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHealth}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              {t('Refresh', 'تحديث')}
            </Button>
          </div>
        </div>

        {/* ── Error state ── */}
        {error && (
          <Card className="border-red-500/40">
            <CardContent className="pt-6 flex items-center gap-3 text-red-400">
              <ServerCrash className="w-5 h-5 shrink-0" />
              <span className="text-sm">{error}</span>
            </CardContent>
          </Card>
        )}

        {/* ── Loading skeleton ── */}
        {loading && !data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader><div className="h-5 bg-muted rounded w-32" /></CardHeader>
                <CardContent><div className="h-20 bg-muted rounded" /></CardContent>
              </Card>
            ))}
          </div>
        )}

        {data && (() => {
          const { overallStatus, recommendations, system, ai, security, hr, recentAudit, checkedAt } = data;
          return (
            <>
              {/* ── Overall status banner ── */}
              <Card className={cn(
                'border-2',
                overallStatus === 'healthy' && 'border-emerald-500/40 bg-emerald-500/5',
                overallStatus === 'warning' && 'border-amber-500/40 bg-amber-500/5',
                overallStatus === 'critical' && 'border-red-500/40 bg-red-500/5',
              )}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <SeverityIcon s={overallStatus} className="w-6 h-6" />
                      <div>
                        <p className="font-semibold capitalize">
                          {overallStatus === 'healthy'
                            ? t('All systems operational', 'جميع الأنظمة تعمل')
                            : overallStatus === 'warning'
                            ? t('Attention required', 'يلزم الانتباه')
                            : t('Critical issues detected', 'تم اكتشاف مشكلات حرجة')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('Last checked', 'آخر فحص')}: {new Date(checkedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>API ✓</span>
                      <span>DB ✓</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ── Recommendations ── */}
              {recommendations.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    {t('Recommendations', 'التوصيات')}
                  </h2>
                  {recommendations.map((r, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-start gap-3 rounded-md p-3 text-sm border',
                        r.severity === 'critical' && 'bg-red-500/10 border-red-500/30 text-red-300',
                        r.severity === 'warning' && 'bg-amber-500/10 border-amber-500/30 text-amber-300',
                        r.severity === 'healthy' && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
                      )}
                    >
                      {r.severity === 'critical'
                        ? <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                      {r.message}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Terra AI ── */}
              <SectionCard title={t('Terra AI', 'Terra AI')} icon={Brain} severity={ai.status}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Configuration', 'الإعداد')}</p>
                    <StatRow label={t('Configured', 'مُعدّ')} value={ai.configured ? '✓ Yes' : '✗ No'} warn={!ai.configured} />
                    <StatRow label={t('Enabled', 'مُفعّل')} value={ai.enabled ? '✓ Yes' : '✗ No'} warn={!ai.enabled} />
                    <StatRow label={t('Model', 'النموذج')} value={ai.model ?? '—'} />
                    <StatRow label={t('Integration', 'التكامل')} value={ai.integrationProvisioned ? '✓ Provisioned' : '✗ Not provisioned'} warn={!ai.integrationProvisioned} />
                    <StatRow label={t('Audit all queries', 'تدقيق جميع الطلبات')} value={ai.auditAllQueries ? '✓ Yes' : '✗ No'} warn={!ai.auditAllQueries} />
                    <StatRow label={t('Enabled features', 'الميزات المفعّلة')} value={ai.enabledFeatures.length} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Usage (all-time)', 'الاستخدام (إجمالي)')}</p>
                    <StatRow label={t('Total queries', 'إجمالي الطلبات')} value={ai.totalQueries} />
                    <StatRow label={t('Successes', 'ناجح')} value={ai.successCount} />
                    <StatRow label={ai.failureCount > 0 ? '⚠ Failures' : t('Failures', 'فاشل')} value={ai.failureCount} warn={ai.failureCount > 0} />
                    <StatRow label={t('Total tokens', 'إجمالي الرموز')} value={ai.totalTokens.toLocaleString()} />
                    <StatRow label={t('Audit coverage', 'تغطية التدقيق')} value={ai.auditCoveragePercent !== null ? `${ai.auditCoveragePercent}%` : '—'} />
                    <StatRow label={t('Cost', 'التكلفة')} value={<span className="text-muted-foreground text-xs">{t('Unavailable', 'غير متاح')}</span>} />
                  </div>
                </div>

                {/* Feature breakdown table */}
                {ai.featureBreakdown.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('By Feature', 'حسب الميزة')}</p>
                    <div className="overflow-x-auto rounded-md border border-border/60">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/30 text-muted-foreground">
                            <th className="text-start px-3 py-2 font-medium">{t('Feature', 'الميزة')}</th>
                            <th className="text-end px-3 py-2 font-medium">{t('Queries', 'طلبات')}</th>
                            <th className="text-end px-3 py-2 font-medium">{t('Tokens', 'رموز')}</th>
                            <th className="text-end px-3 py-2 font-medium">{t('Avg ms', 'متوسط ms')}</th>
                            <th className="text-end px-3 py-2 font-medium">{t('p95 ms', 'p95 ms')}</th>
                            <th className="text-end px-3 py-2 font-medium">{t('Fails', 'فشل')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ai.featureBreakdown.map((f) => (
                            <tr key={f.feature} className="border-t border-border/40">
                              <td className="px-3 py-2 font-medium">{featureLabel(f.feature)}</td>
                              <td className="px-3 py-2 text-end tabular-nums">{f.queries}</td>
                              <td className="px-3 py-2 text-end tabular-nums">{f.tokens.toLocaleString()}</td>
                              <td className="px-3 py-2 text-end tabular-nums">{f.avgMs}</td>
                              <td className="px-3 py-2 text-end tabular-nums">{f.p95Ms}</td>
                              <td className={cn('px-3 py-2 text-end tabular-nums', f.failures > 0 && 'text-amber-400')}>{f.failures}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Cost note */}
                <p className="mt-3 text-xs text-muted-foreground italic">{ai.costNote}</p>

                {/* Recent failures */}
                {ai.recentFailures.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Recent Failures (7d)', 'الأخطاء الأخيرة (7 أيام)')}</p>
                    <div className="space-y-1">
                      {ai.recentFailures.map((f) => (
                        <div key={f.id} className="flex items-start gap-2 text-xs bg-red-500/10 rounded p-2">
                          <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                          <span className="font-medium text-red-300">{featureLabel(f.feature)}</span>
                          <span className="text-muted-foreground flex-1">{f.errorMessage ?? 'Unknown error'}</span>
                          <span className="text-muted-foreground shrink-0">{relativeTime(f.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* ── Security / Access ── */}
              <SectionCard title={t('Security & Access', 'الأمان والوصول')} icon={Shield} severity={security.status}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Privileged Accounts', 'الحسابات المميزة')}</p>
                    <StatRow
                      label={t('Active Super Admins', 'مسؤولون نشطون')}
                      value={security.activeSuperAdminCount}
                      warn={security.activeSuperAdminCount > 1}
                    />
                    <StatRow
                      label={t('Admins missing MFA', 'مسؤولون بدون MFA')}
                      value={security.adminsMissingMfaCount}
                      warn={security.adminsMissingMfaCount > 0}
                    />
                    <StatRow
                      label={t('Duplicate admin groups', 'مجموعات مسؤولين مكررة')}
                      value={security.duplicateAdminGroups.length}
                      warn={security.duplicateAdminGroups.length > 0}
                    />
                    <StatRow label={t('Active sessions', 'جلسات نشطة')} value={security.activeSessionsByUser.reduce((s, r) => s + r.sessionCount, 0)} />
                    <StatRow label={t('Open alerts', 'تنبيهات مفتوحة')} value={security.openAlertsCount} warn={security.openAlertsCount > 0} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Login Activity (7d)', 'نشاط تسجيل الدخول (7 أيام)')}</p>
                    <StatRow label={t('Failed logins', 'محاولات فاشلة')} value={security.failedLogins7d} warn={security.failedLogins7d > 10} />
                    <StatRow label={t('Lockouts', 'إقفالات')} value={security.lockouts7d} warn={security.lockouts7d > 2} />
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 mt-4">{t('Users', 'المستخدمون')}</p>
                    <StatRow label={t('Inactive users', 'مستخدمون غير نشطين')} value={security.inactiveUserCount} />
                    <StatRow label={t('Orphaned org users', 'مستخدمون بمؤسسة غير معروفة')} value={security.orphanedOrgUserCount} warn={security.orphanedOrgUserCount > 0} />
                  </div>
                </div>

                {/* Super Admin list */}
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Super Admin Accounts', 'حسابات المسؤولين')}</p>
                  <div className="space-y-2">
                    {security.superAdmins.map((a) => (
                      <div key={a.id} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{a.username}</span>
                          <span className="text-muted-foreground text-xs">id={a.id}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {a.mfaEnabled
                            ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs gap-1"><Fingerprint className="w-3 h-3" />MFA</Badge>
                            : <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs gap-1"><AlertTriangle className="w-3 h-3" />No MFA</Badge>}
                          <span className="text-xs text-muted-foreground">{relativeTime(a.lastLoginAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Duplicate admin groups */}
                {security.duplicateAdminGroups.length > 0 && (
                  <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                    <p className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('Duplicate Admin Warning', 'تحذير: مسؤولون مكررون')}
                    </p>
                    {security.duplicateAdminGroups.map((g, i) => (
                      <div key={i} className="text-xs text-amber-300">
                        <span className="font-medium">{g.name}</span>: {g.accounts.map((a) => a.username).join(', ')}
                      </div>
                    ))}
                  </div>
                )}

                {/* Orphaned org users */}
                {security.orphanedOrgUsers.length > 0 && (
                  <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                    <p className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('Users on unregistered org IDs', 'مستخدمون بمؤسسة غير مسجّلة')}
                    </p>
                    {security.orphanedOrgUsers.map((u) => (
                      <div key={u.id} className="text-xs text-amber-300">
                        {u.username} — org {u.orgId} ({u.roleName ?? '?'})
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* ── HR Operations ── */}
              <SectionCard title={t('HR Operations', 'العمليات')} icon={ClipboardList} severity={hr.status}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Workforce (Org 1)', 'القوى العاملة (المؤسسة 1)')}</p>
                    <StatRow label={t('Total employees', 'إجمالي الموظفين')} value={hr.employeeTotal} />
                    <StatRow label={t('Active employees', 'الموظفون النشطون')} value={hr.employeeActive} />
                    <StatRow label={t('Pending approvals', 'موافقات معلّقة')} value={hr.pendingApprovals} warn={hr.pendingApprovals > 10} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Data Freshness', 'حداثة البيانات')}</p>
                    <StatRow
                      label={t('Latest attendance', 'آخر سجل حضور')}
                      value={hr.latestAttendanceAt ? relativeTime(hr.latestAttendanceAt) : t('No data', 'لا بيانات')}
                      warn={hr.attendanceFreshHours !== null && hr.attendanceFreshHours > 48}
                    />
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 mt-4">{t('Payroll', 'الرواتب')}</p>
                    <StatRow label={t('Periods on record', 'فترات مسجّلة')} value={hr.payrollPeriodCount} warn={hr.payrollPeriodCount === 0} />
                  </div>
                </div>

                {hr.payrollPeriods.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('Recent Payroll Periods', 'أحدث فترات الرواتب')}</p>
                    <div className="space-y-1">
                      {hr.payrollPeriods.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-xs border border-border/40 rounded px-3 py-1.5">
                          <span className="font-medium">{p.nameEn}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{p.startDate} → {p.endDate}</span>
                            <Badge className="text-[10px] px-1.5 py-0 capitalize">{p.status}</Badge>
                            {p.isClosed && <Badge className="bg-slate-500/20 text-slate-400 text-[10px] px-1.5 py-0">Closed</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* ── Recent Audit Activity ── */}
              <SectionCard
                title={t('Recent Audit Activity', 'النشاط الحديث')}
                icon={Activity}
                severity="healthy"
                defaultCollapsed={true}
              >
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {recentAudit.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">{t('No audit records.', 'لا سجلات تدقيق.')}</p>
                  )}
                  {recentAudit.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 text-xs border-b border-border/30 py-1.5 last:border-0">
                      <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground shrink-0 w-16">{relativeTime(entry.createdAt)}</span>
                      <span className="font-medium shrink-0">{entry.action}</span>
                      <span className="text-muted-foreground truncate">{entry.entityLabel ?? entry.entityType ?? '—'}</span>
                      <span className="text-muted-foreground shrink-0 ml-auto">uid:{entry.actorUserId ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </>
          );
        })()}
      </div>
    </AnimatedPage>
  );
}
