import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetGoLiveGatesSummary, getGetGoLiveGatesSummaryQueryKey,
  useListReadinessScorecard, getListReadinessScorecardQueryKey,
  useListGoLiveGates, getListGoLiveGatesQueryKey,
  useListPilotDefects, getListPilotDefectsQueryKey,
  useListMigrationStatus, getListMigrationStatusQueryKey,
  useGetLatestRestoreTests, getGetLatestRestoreTestsQueryKey,
  useGetLatestBackup, getGetLatestBackupQueryKey,
  useGetUatTestRunsSummary,
  useListConnectionProfiles,
  useListDevices,
  useEvaluateGoLiveGates,
  useRecalculateReadinessScorecard,
  useRunRestoreTest,
  useCreatePilotDefect,
  useOverrideGoLiveGate,
} from '@workspace/api-client-react';
import type { GoLiveGate } from '@workspace/api-client-react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Gauge, RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock, Shield,
  Database, Server, ChevronDown, ChevronRight, AlertCircle, Info,
  PlusCircle, Edit,
} from 'lucide-react';
import { useLocation } from 'wouter';

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'pass') return <CheckCircle className="w-4 h-4 text-emerald-400" />;
  if (status === 'fail') return <XCircle className="w-4 h-4 text-red-400" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (status === 'blocked') return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <Clock className="w-4 h-4 text-slate-400" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = { critical: 'bg-red-900 text-red-300 border-red-700', major: 'bg-amber-900 text-amber-300 border-amber-700', minor: 'bg-slate-700 text-slate-300 border-slate-600' };
  return <Badge className={`text-xs border ${map[severity] ?? 'bg-slate-700 text-slate-300'}`}>{severity}</Badge>;
}

function ReadinessBadge({ status }: { status: string }) {
  const map: Record<string, string> = { ready: 'bg-emerald-900 text-emerald-300', partial: 'bg-amber-900 text-amber-300', blocked: 'bg-red-900 text-red-300', not_started: 'bg-slate-700 text-slate-400' };
  return <Badge className={`text-xs ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>{status.replace('_', ' ')}</Badge>;
}

function DefectSeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = { critical: 'bg-red-900 text-red-300', high: 'bg-amber-900 text-amber-300', medium: 'bg-blue-900 text-blue-300', low: 'bg-slate-700 text-slate-300' };
  return <Badge className={`text-xs ${map[severity] ?? 'bg-slate-700 text-slate-300'}`}>{severity}</Badge>;
}

function CircularProgress({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className={`text-2xl font-bold ${color}`}>{pct}%</div>
  );
}

function SkeletonCard() {
  return <div className="h-32 bg-slate-700/50 rounded-lg animate-pulse" />;
}

// ─── Raise Defect Dialog ─────────────────────────────────────────────────────

function RaiseDefectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [form, setForm] = useState({ titleEn: '', module: '', severity: 'medium', description: '', isGoLiveBlocker: false });
  const createMut = useCreatePilotDefect();
  const saving = createMut.isPending;

  async function submit() {
    try {
      await createMut.mutateAsync({
        data: {
          module: form.module,
          titleEn: form.titleEn,
          descriptionEn: form.description || null,
          severity: form.severity || null,
          isGoLiveBlocker: form.isGoLiveBlocker,
        },
      });
      toast({ title: t('Defect raised', 'تم رفع العيب') });
      onCreated();
      onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader><DialogTitle>{t('Raise Defect', 'رفع عيب')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder={t('Title (EN)', 'العنوان (إنجليزي)')} className="bg-slate-700 border-slate-600 text-white" value={form.titleEn} onChange={e => setForm(f => ({ ...f, titleEn: e.target.value }))} />
          <Input placeholder={t('Module', 'الوحدة')} className="bg-slate-700 border-slate-600 text-white" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} />
          <select className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
            {['critical','high','medium','low'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <Textarea placeholder={t('Description', 'الوصف')} className="bg-slate-700 border-slate-600 text-white" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.isGoLiveBlocker} onChange={e => setForm(f => ({ ...f, isGoLiveBlocker: e.target.checked }))} />
            {t('Go-live blocker', 'يعيق الإطلاق')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : t('Submit', 'إرسال')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Override Gate Dialog ─────────────────────────────────────────────────────

function OverrideGateDialog({ gate, open, onClose, onDone }: { gate: GoLiveGate | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const overrideMut = useOverrideGoLiveGate();
  const saving = overrideMut.isPending;

  async function submit() {
    if (!gate) return;
    try {
      await overrideMut.mutateAsync({ gateCode: gate.gateCode, data: { reason } });
      toast({ title: t('Gate overridden', 'تم تجاوز البوابة') });
      onDone();
      onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader><DialogTitle>{t('Override Gate', 'تجاوز البوابة')}: {gate?.titleEn}</DialogTitle></DialogHeader>
        <Textarea placeholder={t('Reason for override (required)', 'سبب التجاوز (مطلوب)')} className="bg-slate-700 border-slate-600 text-white" value={reason} onChange={e => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={submit} disabled={saving || !reason.trim()} className="bg-amber-600 hover:bg-amber-700">{saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : t('Override', 'تجاوز')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PilotControlCenter() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const summaryQuery = useGetGoLiveGatesSummary();
  const scorecardQuery = useListReadinessScorecard();
  const gatesQuery = useListGoLiveGates();
  const defectsQuery = useListPilotDefects({ status: 'open' });
  const migrationsQuery = useListMigrationStatus();
  const restoreTestsQuery = useGetLatestRestoreTests();
  const backupQuery = useGetLatestBackup();
  const uatQuery = useGetUatTestRunsSummary();
  const profilesQuery = useListConnectionProfiles();
  const devicesQuery = useListDevices();

  const summary = summaryQuery.data ?? null;
  const scorecards = scorecardQuery.data ?? [];
  const gates = gatesQuery.data?.gates ?? [];
  const defects = defectsQuery.data ?? [];
  const migrations = migrationsQuery.data ?? [];
  const lastRestoreTest = restoreTestsQuery.data?.latest?.[0] ?? null;
  const lastBackup = backupQuery.data?.backup ?? null;
  const uatSummary = uatQuery.data ?? null;
  const profiles = profilesQuery.data ?? [];
  const devices = devicesQuery.data ?? [];

  const loading = summaryQuery.isLoading || scorecardQuery.isLoading || gatesQuery.isLoading
    || defectsQuery.isLoading || migrationsQuery.isLoading || uatQuery.isLoading
    || profilesQuery.isLoading || devicesQuery.isLoading;

  const evaluateMut = useEvaluateGoLiveGates();
  const recalculateMut = useRecalculateReadinessScorecard();
  const runRestoreMut = useRunRestoreTest();
  const evaluating = evaluateMut.isPending;
  const recalculating = recalculateMut.isPending;
  const runningRestore = runRestoreMut.isPending;
  const [restoreResult, setRestoreResult] = useState<string | null>(null);

  const [expandedGateCategories, setExpandedGateCategories] = useState<Record<string, boolean>>({});
  const [expandedGates, setExpandedGates] = useState<Record<number, boolean>>({});
  const [defectFilter, setDefectFilter] = useState({ severity: '', module: '', blockerOnly: false });
  const [showRaiseDefect, setShowRaiseDefect] = useState(false);
  const [overrideGate, setOverrideGate] = useState<GoLiveGate | null>(null);

  function invalidateGates() {
    queryClient.invalidateQueries({ queryKey: getGetGoLiveGatesSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGoLiveGatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListReadinessScorecardQueryKey() });
  }

  async function handleEvaluate() {
    try {
      await evaluateMut.mutateAsync();
      toast({ title: t('Gates re-evaluated', 'تمت إعادة تقييم البوابات') });
      invalidateGates();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function handleRecalculate() {
    try {
      await recalculateMut.mutateAsync();
      toast({ title: t('Scorecards recalculated', 'تمت إعادة حساب بطاقات الجاهزية') });
      queryClient.invalidateQueries({ queryKey: getListReadinessScorecardQueryKey() });
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function handleRunRestore() {
    try {
      const res = await runRestoreMut.mutateAsync({ data: {} });
      setRestoreResult(res.result ?? 'completed');
      queryClient.invalidateQueries({ queryKey: getGetLatestRestoreTestsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetLatestBackupQueryKey() });
    } catch { setRestoreResult('error'); }
  }

  // Per-gate manual evaluation has no dedicated server route; re-evaluate all automated gates instead.
  async function handleManualEvaluate() {
    try {
      await evaluateMut.mutateAsync();
      toast({ title: t('Gate evaluated', 'تم تقييم البوابة') });
      invalidateGates();
    } catch { /* silent */ }
  }

  function refreshDefects() {
    queryClient.invalidateQueries({ queryKey: getListPilotDefectsQueryKey({ status: 'open' }) });
  }

  const gatesByCategory = gates.reduce<Record<string, GoLiveGate[]>>((acc, g) => {
    if (!acc[g.category]) acc[g.category] = [];
    acc[g.category].push(g);
    return acc;
  }, {});

  const filteredDefects = defects.filter(d => {
    if (defectFilter.severity && d.severity !== defectFilter.severity) return false;
    if (defectFilter.module && d.module !== defectFilter.module) return false;
    if (defectFilter.blockerOnly && !d.isGoLiveBlocker) return false;
    return true;
  });

  const UAT_ROLES = ['HR Admin', 'Payroll Admin', 'Line Manager', 'Employee', 'Attendance Supervisor', 'Auditor', 'Security Admin', 'Government User', 'Defense User'];
  const uatRolesCovered = new Set(uatSummary?.rolesCovered ?? []);

  return (
    <AnimatedPage className="space-y-6">
      {/* Disclaimer banner */}
      <div className="bg-blue-950/60 border border-blue-700 rounded-lg p-3 text-blue-300 text-xs">
        <Info className="w-4 h-4 inline mr-1" />
        {t(
          'This pilot control center uses live data from the demo database. Go-live gates are evaluated against actual DB state. Gates marked WARN reflect demo-mode limitations that must be resolved before production deployment.',
          'يستخدم مركز التحكم التجريبي هذا بيانات حية من قاعدة البيانات التجريبية. يتم تقييم بوابات الإطلاق مقابل حالة قاعدة البيانات الفعلية. البوابات المحددة بـ WARN تعكس قيود الوضع التجريبي التي يجب معالجتها قبل النشر الإنتاجي.'
        )}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Gauge className="w-8 h-8 text-amber-400" />
            {t('🎯 Pilot Control Center', '🎯 مركز التحكم التجريبي')}
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {t('Total gates:', 'إجمالي البوابات:')} {summary?.totalGates ?? t('—', '—')}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleEvaluate} disabled={evaluating} className="bg-amber-600 hover:bg-amber-700">
            {evaluating ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {t('Re-evaluate All Gates', 'إعادة تقييم جميع البوابات')}
          </Button>
          <Button onClick={handleRecalculate} disabled={recalculating} variant="outline" className="border-slate-600 text-slate-300">
            {recalculating ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {t('Recalculate Scorecards', 'إعادة حساب بطاقات الجاهزية')}
          </Button>
        </div>
      </div>

      {/* Go/No-Go Banner */}
      {loading ? (
        <div className="h-20 bg-slate-700/50 rounded-lg animate-pulse" />
      ) : summary ? (
        <div className={`rounded-lg p-5 border-2 ${summary.isReadyForGoLive ? 'bg-emerald-900/30 border-emerald-600' : 'bg-red-900/30 border-red-600'}`}>
          <div className={`text-xl font-bold ${summary.isReadyForGoLive ? 'text-emerald-300' : 'text-red-300'}`}>
            {summary.isReadyForGoLive
              ? t('✅ ALL CRITICAL GATES PASSED — System may proceed to go-live', '✅ اجتازت جميع البوابات الحرجة — يمكن للنظام المتابعة للإطلاق')
              : t(`⛔ NOT READY FOR GO-LIVE — ${summary.criticalBlockers.length} critical blockers unresolved`, `⛔ غير جاهز للإطلاق — ${summary.criticalBlockers.length} عوائق حرجة غير محلولة`)}
          </div>
          <div className="text-slate-400 text-sm mt-2">
            {t(
              'This assessment reflects demo mode. Production deployment requires Keycloak integration, session guards, and verified backup restore.',
              'يعكس هذا التقييم الوضع التجريبي. يتطلب النشر الإنتاجي تكامل Keycloak وحراسة الجلسات واستعادة النسخ الاحتياطية الموثقة.'
            )}
          </div>
        </div>
      ) : null}

      {/* Section 1: Scorecards */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader><CardTitle className="text-white flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />{t('Readiness Scorecards', 'بطاقات الجاهزية')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{Array(6).fill(0).map((_, i) => <SkeletonCard key={i} />)}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {scorecards.map(sc => {
                let coveredRoles: string[] = [];
                try { const parsed = JSON.parse(sc.coveredRolesJson); if (Array.isArray(parsed)) coveredRoles = parsed; } catch { /* ignore */ }
                return (
                <div key={sc.id} className="bg-slate-700/50 border border-slate-600 rounded-lg p-4 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => navigate('/go-live-checklist')}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold text-white text-sm">{t(sc.moduleDisplayEn, sc.moduleDisplayAr)}</div>
                      <ReadinessBadge status={sc.readinessStatus} />
                    </div>
                    <CircularProgress pct={Math.round(Number(sc.readinessScore) || 0)} />
                  </div>
                  <div className="text-xs text-slate-400 mt-2">{sc.passingGates}/{sc.totalGates} {t('gates passing', 'بوابات ناجحة')}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {coveredRoles.slice(0, 3).map(r => (
                      <span key={r} className="text-[10px] bg-slate-600 text-slate-300 rounded px-1.5 py-0.5">{r}</span>
                    ))}
                  </div>
                </div>
                );
              })}
              {scorecards.length === 0 && <div className="col-span-3 text-slate-500 text-center py-8">{t('No scorecards found', 'لا توجد بطاقات جاهزية')}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Go-Live Gates */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader><CardTitle className="text-white flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" />{t('Go-Live Gates', 'بوابات الإطلاق')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading ? Array(3).fill(0).map((_, i) => <div key={i} className="h-12 bg-slate-700/50 rounded animate-pulse" />) :
            Object.entries(gatesByCategory).map(([cat, catGates]) => {
              const isExpanded = expandedGateCategories[cat] !== false;
              return (
                <div key={cat} className="border border-slate-600 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-700/50 hover:bg-slate-700 transition-colors text-left"
                    onClick={() => setExpandedGateCategories(p => ({ ...p, [cat]: !isExpanded }))}
                  >
                    <span className="font-semibold text-white text-sm">{cat}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{catGates.filter(g => g.status === 'pass').length}/{catGates.length} {t('pass', 'ناجح')}</span>
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="divide-y divide-slate-700">
                      {catGates.map(gate => {
                        const isGateExpanded = expandedGates[gate.id];
                        return (
                          <div key={gate.id} className="px-4 py-3 bg-slate-800">
                            <div className="flex items-center gap-3">
                              <StatusIcon status={gate.status} />
                              <span className="flex-1 text-sm text-white">{t(gate.titleEn, gate.titleAr)}</span>
                              <SeverityBadge severity={gate.severity} />
                              <div className="flex gap-1">
                                {gate.evaluationType === 'manual' && (
                                  <Button size="sm" variant="outline" className="h-6 text-xs border-slate-600 text-slate-300" onClick={() => handleManualEvaluate()}>
                                    {t('Evaluate', 'تقييم')}
                                  </Button>
                                )}
                                {gate.severity !== 'critical' && (gate.status === 'fail' || gate.status === 'warn') && (
                                  <Button size="sm" variant="outline" className="h-6 text-xs border-amber-600 text-amber-400" onClick={() => setOverrideGate(gate)}>
                                    {t('Override', 'تجاوز')}
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400" onClick={() => setExpandedGates(p => ({ ...p, [gate.id]: !isGateExpanded }))}>
                                  {isGateExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </Button>
                              </div>
                            </div>
                            {gate.blockerDescriptionEn && (
                              <div className="ml-7 mt-1 text-xs text-red-400">{gate.blockerDescriptionEn}</div>
                            )}
                            {isGateExpanded && (
                              <div className="ml-7 mt-2 space-y-1">
                                {gate.evidenceJson && <pre className="text-xs text-slate-400 bg-slate-900 rounded p-2 overflow-x-auto">{gate.evidenceJson}</pre>}
                                {gate.remediationEn && <div className="text-xs text-amber-400 bg-amber-900/20 rounded p-2">{t('Remediation:', 'الإصلاح:')} {gate.remediationEn}</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          }
        </CardContent>
      </Card>

      {/* Section 3: Defects */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <span className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-400" />{t('Unresolved Defects', 'العيوب غير المحلولة')}</span>
            <Button size="sm" onClick={() => setShowRaiseDefect(true)} className="bg-red-700 hover:bg-red-800">
              <PlusCircle className="w-4 h-4 mr-1" />{t('Raise Defect', 'رفع عيب')}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4 flex-wrap">
            <select className="bg-slate-700 border border-slate-600 text-slate-300 rounded px-2 py-1 text-sm" value={defectFilter.severity} onChange={e => setDefectFilter(f => ({ ...f, severity: e.target.value }))}>
              <option value="">{t('All Severities', 'كل الخطورات')}</option>
              {['critical','high','medium','low'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <Input placeholder={t('Filter module', 'فلتر الوحدة')} className="bg-slate-700 border-slate-600 text-white h-8 text-sm w-36" value={defectFilter.module} onChange={e => setDefectFilter(f => ({ ...f, module: e.target.value }))} />
            <label className="flex items-center gap-1 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={defectFilter.blockerOnly} onChange={e => setDefectFilter(f => ({ ...f, blockerOnly: e.target.checked }))} />
              {t('Blocker only', 'العوائق فقط')}
            </label>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">{t('Code', 'الرمز')}</TableHead>
                  <TableHead className="text-slate-400">{t('Module', 'الوحدة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Severity', 'الخطورة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Title', 'العنوان')}</TableHead>
                  <TableHead className="text-slate-400">{t('Blocker', 'عائق')}</TableHead>
                  <TableHead className="text-slate-400">{t('Days Open', 'أيام مفتوحة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Assignee', 'المسؤول')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">{t('Loading…', 'جارٍ التحميل…')}</TableCell></TableRow>
                ) : filteredDefects.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">{t('No defects found', 'لا توجد عيوب')}</TableCell></TableRow>
                ) : filteredDefects.map(d => (
                  <TableRow key={d.id} className="border-slate-700">
                    <TableCell><Badge className="bg-slate-700 text-slate-300 text-xs">{d.defectCode}</Badge></TableCell>
                    <TableCell><Badge className="bg-blue-900 text-blue-300 text-xs">{d.module}</Badge></TableCell>
                    <TableCell><DefectSeverityBadge severity={d.severity} /></TableCell>
                    <TableCell className="text-white text-sm">{d.titleEn}</TableCell>
                    <TableCell>{d.isGoLiveBlocker && <Badge className="bg-red-900 text-red-300 text-xs">⛔ {t('Blocker', 'عائق')}</Badge>}</TableCell>
                    <TableCell className="text-slate-300">{Math.max(0, Math.floor((Date.now() - new Date(d.reportedAt).getTime()) / 86400000))}</TableCell>
                    <TableCell><Badge className="bg-amber-900 text-amber-300 text-xs">{d.status}</Badge></TableCell>
                    <TableCell className="text-slate-400 text-sm">{d.assignedToUserId ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Migration */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader><CardTitle className="text-white flex items-center gap-2"><Database className="w-5 h-5 text-purple-400" />{t('Migration Status', 'حالة الترحيل')}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">{t('Item', 'العنصر')}</TableHead>
                  <TableHead className="text-slate-400">{t('Priority', 'الأولوية')}</TableHead>
                  <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Progress', 'التقدم')}</TableHead>
                  <TableHead className="text-slate-400">{t('Records', 'السجلات')}</TableHead>
                  <TableHead className="text-slate-400">{t('Source', 'المصدر')}</TableHead>
                  <TableHead className="text-slate-400">{t('Blocker', 'عائق')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-8">{t('Loading…', 'جارٍ التحميل…')}</TableCell></TableRow>
                ) : migrations.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-8">{t('No migration items', 'لا توجد عناصر ترحيل')}</TableCell></TableRow>
                ) : migrations.map(m => (
                  <TableRow key={m.id} className="border-slate-700">
                    <TableCell className="text-white text-sm">{m.titleEn}</TableCell>
                    <TableCell><Badge className={`text-xs ${m.priority === 'critical' ? 'bg-red-900 text-red-300' : 'bg-amber-900 text-amber-300'}`}>{m.priority}</Badge></TableCell>
                    <TableCell><Badge className={`text-xs ${m.status === 'complete' ? 'bg-emerald-900 text-emerald-300' : m.status === 'in_progress' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>{m.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-slate-600 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.round(Number(m.progressPercent) || 0)}%` }} /></div>
                        <span className="text-xs text-slate-400">{Math.round(Number(m.progressPercent) || 0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">{m.migratedRecords ?? 0}/{m.totalRecords ?? 0}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{m.sourceSystem ?? '—'}</TableCell>
                    <TableCell>{m.isGoLiveBlocker && <Badge className="bg-red-900 text-red-300 text-xs">⛔</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section 5: Backup & Restore */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <span className="flex items-center gap-2"><Server className="w-5 h-5 text-cyan-400" />{t('Backup & Restore Health', 'صحة النسخ الاحتياطي والاستعادة')}</span>
            <Button size="sm" onClick={handleRunRestore} disabled={runningRestore} variant="outline" className="border-cyan-600 text-cyan-400">
              {runningRestore ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              {t('Run Restore Test', 'تشغيل اختبار الاستعادة')}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
              <div className="text-slate-400 text-xs mb-1">{t('Last Backup', 'آخر نسخ احتياطي')}</div>
              {lastBackup ? (
                <>
                  <div className="text-white font-semibold">{new Date(lastBackup.startedAt).toLocaleString()}</div>
                  <div className="flex gap-2 mt-1">
                    <Badge className="bg-blue-900 text-blue-300 text-xs">{lastBackup.backupType}</Badge>
                    <Badge className={`text-xs ${lastBackup.status === 'success' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{lastBackup.status}</Badge>
                  </div>
                </>
              ) : <div className="text-slate-500 text-sm">{t('No backup data', 'لا توجد بيانات نسخ احتياطي')}</div>}
            </div>
            <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
              <div className="text-slate-400 text-xs mb-1">{t('Last Restore Test', 'آخر اختبار استعادة')}</div>
              {lastRestoreTest ? (
                <>
                  <div className="text-white font-semibold">{new Date(lastRestoreTest.testedAt).toLocaleString()}</div>
                  <div className="flex gap-2 mt-1">
                    <Badge className={`text-xs ${lastRestoreTest.result === 'success' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{lastRestoreTest.result}</Badge>
                    <span className="text-xs text-slate-400">{lastRestoreTest.restoreDurationSeconds ?? 0}s</span>
                  </div>
                </>
              ) : (
                <div className="bg-amber-900/30 border border-amber-700 rounded p-2 text-amber-400 text-sm">
                  ⚠ {t('No restore test in 30+ days — required for go-live', 'لا يوجد اختبار استعادة منذ 30+ يوم — مطلوب للإطلاق')}
                </div>
              )}
            </div>
          </div>
          {restoreResult && (
            <div className={`mt-3 p-3 rounded border ${restoreResult === 'error' ? 'bg-red-900/30 border-red-700 text-red-300' : 'bg-emerald-900/30 border-emerald-700 text-emerald-300'}`}>
              {t('Restore test result:', 'نتيجة اختبار الاستعادة:')} {restoreResult}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 6: UAT Coverage */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader><CardTitle className="text-white flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" />{t('UAT Coverage', 'تغطية قبول المستخدم')}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {UAT_ROLES.map(role => {
              const covered = uatRolesCovered.has(role);
              const color = covered ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-slate-700 text-slate-400 border-slate-600';
              return <Badge key={role} className={`text-sm px-3 py-1 border ${color}`}>{role}</Badge>;
            })}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            {UAT_ROLES.filter(r => uatRolesCovered.has(r)).length} / {UAT_ROLES.length} {t('roles have complete UAT coverage', 'أدوار لديها تغطية UAT كاملة')}
          </div>
        </CardContent>
      </Card>

      {/* Section 7: Integration & Device Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Database className="w-4 h-4 text-indigo-400" />{t('Integration Profiles', 'ملفات التكامل')}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow className="border-slate-700"><TableHead className="text-slate-400 text-xs">{t('Name', 'الاسم')}</TableHead><TableHead className="text-slate-400 text-xs">{t('Type', 'النوع')}</TableHead><TableHead className="text-slate-400 text-xs">{t('Status', 'الحالة')}</TableHead><TableHead className="text-slate-400 text-xs">{t('Last Tested', 'آخر اختبار')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {profiles.slice(0, 5).map(p => (
                  <TableRow key={p.id} className="border-slate-700">
                    <TableCell className="text-white text-xs">{p.profileName}</TableCell>
                    <TableCell className="text-slate-400 text-xs">{p.integrationType}</TableCell>
                    <TableCell><Badge className={`text-xs ${p.status === 'connected' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{p.status}</Badge></TableCell>
                    <TableCell className="text-slate-400 text-xs">{p.lastTestedAt ? new Date(p.lastTestedAt).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
                {profiles.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-500 text-xs py-4">{t('No profiles', 'لا توجد ملفات')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Server className="w-4 h-4 text-teal-400" />{t('Devices', 'الأجهزة')}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow className="border-slate-700"><TableHead className="text-slate-400 text-xs">{t('Name', 'الاسم')}</TableHead><TableHead className="text-slate-400 text-xs">{t('Code', 'الرمز')}</TableHead><TableHead className="text-slate-400 text-xs">{t('Status', 'الحالة')}</TableHead><TableHead className="text-slate-400 text-xs">{t('Heartbeat', 'نبضة')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {devices.slice(0, 5).map(d => (
                  <TableRow key={d.id} className="border-slate-700">
                    <TableCell className="text-white text-xs">{d.name}</TableCell>
                    <TableCell className="text-slate-400 text-xs">{d.serialNumber}</TableCell>
                    <TableCell><Badge className={`text-xs ${d.status === 'online' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{d.status}</Badge></TableCell>
                    <TableCell className="text-slate-400 text-xs">{d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
                {devices.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-500 text-xs py-4">{t('No devices', 'لا توجد أجهزة')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <RaiseDefectDialog open={showRaiseDefect} onClose={() => setShowRaiseDefect(false)} onCreated={refreshDefects} />
      <OverrideGateDialog gate={overrideGate} open={!!overrideGate} onClose={() => setOverrideGate(null)} onDone={invalidateGates} />
    </AnimatedPage>
  );
}
