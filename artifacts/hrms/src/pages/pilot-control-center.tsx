import { useState, useEffect } from 'react';
import {
  getGoLiveGatesSummary,
  listReadinessScorecard,
  listGoLiveGates,
  listPilotDefects,
  listMigrationStatus,
  getLatestRestoreTests,
  getLatestBackup,
  getUatTestRunsSummary,
  listConnectionProfiles,
  listDevices,
  evaluateGoLiveGates,
  recalculateReadinessScorecard,
  runRestoreTest,
  overrideGoLiveGate,
  createPilotDefect,
} from '@workspace/api-client-react';

import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface GoLiveSummary { isReadyForGoLive: boolean; criticalBlockers: number; lastEvaluated: string; }
interface Scorecard { id: number; moduleKey: string; moduleName: string; moduleNameAr: string; readinessStatus: string; readinessPercentage: number; totalGates: number; passingGates: number; coveredRoles: string[]; }
interface GoLiveGate { id: number; gateKey: string; titleEn: string; titleAr: string; category: string; severity: string; status: string; blockerDescription?: string; remediationHint?: string; evidenceJson?: string; isManual: boolean; }
interface Defect { id: number; defectCode: string; module: string; severity: string; titleEn: string; titleAr?: string | null; isGoLiveBlocker: boolean; daysOpen: number; status: string; assignee?: string; }
interface Migration { id: number; itemName: string; priority: string; status: string; progressPct: number; recordsMigrated: number; totalRecords: number; sourceSystem: string; isGoLiveBlocker: boolean; }
interface BackupStatus { lastBackup?: { performedAt: string; backupType: string; status: string; }; lastRestoreTest?: { testedAt: string; result: string; durationSeconds: number; }; }
interface UATSummary { roles: { role: string; coverage: string }[]; }
interface ConnectionProfile { id: number; profileName: string; systemType: string; connectionStatus: string; lastTestedAt?: string; lastTestedByNameEn?: string | null; lastTestedByNameAr?: string | null; }
interface Device { id: number; name: string; deviceCode: string; status: string; lastHeartbeat?: string; }

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
  const [form, setForm] = useState({ titleEn: '', module: '', severity: 'medium', descriptionEn: '', isGoLiveBlocker: false });
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await createPilotDefect(form as any);
      toast({ title: t('Defect raised', 'تم رفع العيب') });
      onCreated();
      onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setSaving(false); }
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
          <Textarea placeholder={t('Description', 'الوصف')} className="bg-slate-700 border-slate-600 text-white" value={form.descriptionEn} onChange={e => setForm(f => ({ ...f, descriptionEn: e.target.value }))} />
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
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!gate) return;
    setSaving(true);
    try {
      await overrideGoLiveGate(gate.gateKey, { reason });
      toast({ title: t('Gate overridden', 'تم تجاوز البوابة') });
      onDone();
      onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader><DialogTitle>{t('Override Gate', 'تجاوز البوابة')}: {localName(gate?.titleEn, gate?.titleAr, lang)}</DialogTitle></DialogHeader>
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
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [summary, setSummary] = useState<GoLiveSummary | null>(null);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [gates, setGates] = useState<GoLiveGate[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [backup, setBackup] = useState<BackupStatus>({});
  const [uatSummary, setUatSummary] = useState<UATSummary | null>(null);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [runningRestore, setRunningRestore] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);

  const [expandedGateCategories, setExpandedGateCategories] = useState<Record<string, boolean>>({});
  const [expandedGates, setExpandedGates] = useState<Record<number, boolean>>({});
  const [defectFilter, setDefectFilter] = useState({ severity: '', module: '', blockerOnly: false });
  const [showRaiseDefect, setShowRaiseDefect] = useState(false);
  const [overrideGate, setOverrideGate] = useState<GoLiveGate | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [sum, sc, g, def, mig, bk, uat, pr, dev] = await Promise.allSettled([
        getGoLiveGatesSummary(),
        listReadinessScorecard(),
        listGoLiveGates(),
        listPilotDefects({ status: 'open' }),
        listMigrationStatus(),
        Promise.all([getLatestRestoreTests(), getLatestBackup()]),
        getUatTestRunsSummary(),
        listConnectionProfiles(),
        listDevices(),
      ]);
      if (sum.status === 'fulfilled') setSummary(sum.value as any);
      if (sc.status === 'fulfilled') setScorecards(Array.isArray(sc.value) ? sc.value as any[] : (sc.value as any)?.scorecards ?? []);
      if (g.status === 'fulfilled') setGates(Array.isArray(g.value) ? g.value as any[] : (g.value as any)?.gates ?? []);
      if (def.status === 'fulfilled') setDefects(Array.isArray(def.value) ? def.value as any[] : (def.value as any)?.defects ?? []);
      if (mig.status === 'fulfilled') setMigrations(Array.isArray(mig.value) ? mig.value as any[] : (mig.value as any)?.items ?? []);
      if (bk.status === 'fulfilled') {
        const [rt, bkup] = bk.value as [any, any];
        setBackup({ lastRestoreTest: rt?.test ?? rt, lastBackup: bkup?.backup ?? bkup });
      }
      if (uat.status === 'fulfilled') setUatSummary(uat.value as any);
      if (pr.status === 'fulfilled') setProfiles(Array.isArray(pr.value) ? pr.value as any[] : (pr.value as any)?.profiles ?? []);
      if (dev.status === 'fulfilled') setDevices(Array.isArray(dev.value) ? dev.value as any[] : (dev.value as any)?.devices ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      await evaluateGoLiveGates();
      toast({ title: t('Gates re-evaluated', 'تمت إعادة تقييم البوابات') });
      loadAll();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setEvaluating(false); }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      await recalculateReadinessScorecard();
      toast({ title: t('Scorecards recalculated', 'تمت إعادة حساب بطاقات الجاهزية') });
      loadAll();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setRecalculating(false); }
  }

  async function handleRunRestore() {
    setRunningRestore(true);
    try {
      const res = await runRestoreTest();
      setRestoreResult((res as any)?.result ?? 'completed');
      loadAll();
    } catch { setRestoreResult('error'); }
    finally { setRunningRestore(false); }
  }

  async function handleManualEvaluate(_gateId: number) {
    try {
      await evaluateGoLiveGates();
      toast({ title: t('Gate evaluated', 'تم تقييم البوابة') });
      loadAll();
    } catch { /* silent */ }
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
  const uatRoleMap: Record<string, string> = {};
  if (uatSummary?.roles) uatSummary.roles.forEach((r: any) => { uatRoleMap[r.role] = r.coverage; });

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
            {t('Last evaluated:', 'آخر تقييم:')} {summary?.lastEvaluated ?? t('—', '—')}
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
              : t(`⛔ NOT READY FOR GO-LIVE — ${summary.criticalBlockers} critical blockers unresolved`, `⛔ غير جاهز للإطلاق — ${summary.criticalBlockers} عوائق حرجة غير محلولة`)}
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
              {scorecards.map(sc => (
                <div key={sc.id} className="bg-slate-700/50 border border-slate-600 rounded-lg p-4 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => navigate('/go-live-checklist')}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold text-white text-sm">{t(sc.moduleName, sc.moduleNameAr)}</div>
                      <ReadinessBadge status={sc.readinessStatus} />
                    </div>
                    <CircularProgress pct={sc.readinessPercentage ?? 0} />
                  </div>
                  <div className="text-xs text-slate-400 mt-2">{sc.passingGates}/{sc.totalGates} {t('gates passing', 'بوابات ناجحة')}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(sc.coveredRoles ?? []).slice(0, 3).map(r => (
                      <span key={r} className="text-[10px] bg-slate-600 text-slate-300 rounded px-1.5 py-0.5">{r}</span>
                    ))}
                  </div>
                </div>
              ))}
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
                                {gate.isManual && (
                                  <Button size="sm" variant="outline" className="h-6 text-xs border-slate-600 text-slate-300" onClick={() => handleManualEvaluate(gate.id)}>
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
                            {gate.blockerDescription && (
                              <div className="ml-7 mt-1 text-xs text-red-400">{gate.blockerDescription}</div>
                            )}
                            {isGateExpanded && (
                              <div className="ml-7 mt-2 space-y-1">
                                {gate.evidenceJson && <pre className="text-xs text-slate-400 bg-slate-900 rounded p-2 overflow-x-auto">{gate.evidenceJson}</pre>}
                                {gate.remediationHint && <div className="text-xs text-amber-400 bg-amber-900/20 rounded p-2">{t('Remediation:', 'الإصلاح:')} {gate.remediationHint}</div>}
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
                    <TableCell className="text-white text-sm">{localName(d.titleEn, d.titleAr, lang)}</TableCell>
                    <TableCell>{d.isGoLiveBlocker && <Badge className="bg-red-900 text-red-300 text-xs">⛔ {t('Blocker', 'عائق')}</Badge>}</TableCell>
                    <TableCell className="text-slate-300">{d.daysOpen}</TableCell>
                    <TableCell><Badge className="bg-amber-900 text-amber-300 text-xs">{d.status}</Badge></TableCell>
                    <TableCell className="text-slate-400 text-sm">{d.assignee ?? '—'}</TableCell>
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
                    <TableCell className="text-white text-sm">{m.itemName}</TableCell>
                    <TableCell><Badge className={`text-xs ${m.priority === 'critical' ? 'bg-red-900 text-red-300' : 'bg-amber-900 text-amber-300'}`}>{m.priority}</Badge></TableCell>
                    <TableCell><Badge className={`text-xs ${m.status === 'complete' ? 'bg-emerald-900 text-emerald-300' : m.status === 'in_progress' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>{m.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-slate-600 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${m.progressPct ?? 0}%` }} /></div>
                        <span className="text-xs text-slate-400">{m.progressPct ?? 0}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">{m.recordsMigrated ?? 0}/{m.totalRecords ?? 0}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{m.sourceSystem}</TableCell>
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
              {backup.lastBackup ? (
                <>
                  <div className="text-white font-semibold">{new Date(backup.lastBackup.performedAt).toLocaleString()}</div>
                  <div className="flex gap-2 mt-1">
                    <Badge className="bg-blue-900 text-blue-300 text-xs">{backup.lastBackup.backupType}</Badge>
                    <Badge className={`text-xs ${backup.lastBackup.status === 'success' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{backup.lastBackup.status}</Badge>
                  </div>
                </>
              ) : <div className="text-slate-500 text-sm">{t('No backup data', 'لا توجد بيانات نسخ احتياطي')}</div>}
            </div>
            <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
              <div className="text-slate-400 text-xs mb-1">{t('Last Restore Test', 'آخر اختبار استعادة')}</div>
              {backup.lastRestoreTest ? (
                <>
                  <div className="text-white font-semibold">{new Date(backup.lastRestoreTest.testedAt).toLocaleString()}</div>
                  <div className="flex gap-2 mt-1">
                    <Badge className={`text-xs ${backup.lastRestoreTest.result === 'success' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{backup.lastRestoreTest.result}</Badge>
                    <span className="text-xs text-slate-400">{backup.lastRestoreTest.durationSeconds}s</span>
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
              const cov = uatRoleMap[role];
              const color = cov === 'complete' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : cov === 'partial' ? 'bg-amber-900 text-amber-300 border-amber-700' : 'bg-slate-700 text-slate-400 border-slate-600';
              return <Badge key={role} className={`text-sm px-3 py-1 border ${color}`}>{role}</Badge>;
            })}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            {Object.values(uatRoleMap).filter(v => v === 'complete').length} / {UAT_ROLES.length} {t('roles have complete UAT coverage', 'أدوار لديها تغطية UAT كاملة')}
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
                    <TableCell className="text-white text-xs">{localName(p.profileName, (p as any).profileNameAr, lang)}</TableCell>
                    <TableCell className="text-slate-400 text-xs">{p.systemType}</TableCell>
                    <TableCell><Badge className={`text-xs ${p.connectionStatus === 'connected' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{p.connectionStatus}</Badge></TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {p.lastTestedAt ? (
                        <div>
                          <span>{new Date(p.lastTestedAt).toLocaleDateString()}</span>
                          <p className="text-[11px] text-slate-500">
                            {(p.lastTestedByNameEn || p.lastTestedByNameAr)
                              ? `${t('Tested by', 'اختبرها')} ${localName(p.lastTestedByNameEn, p.lastTestedByNameAr, lang)}`
                              : t('Automated health check', 'فحص صحة تلقائي')}
                          </p>
                        </div>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {profiles.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-500 text-xs py-4">{t('No profiles', 'لا توجد ملفات')}</TableCell></TableRow>}
              </TableBody>
            </Table>
            {profiles.length > 5 && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-400" data-testid="text-profiles-count">
                  {t(`Showing 5 of ${profiles.length} profiles`, `عرض 5 من ${profiles.length} ملفات`)}
                </span>
                <Button variant="link" size="sm" className="text-indigo-400 h-auto p-0 text-xs" onClick={() => navigate('/integration-governance')} data-testid="link-all-profiles">
                  {t('View all profiles', 'عرض جميع الملفات')}
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}
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
                    <TableCell className="text-slate-400 text-xs">{d.deviceCode}</TableCell>
                    <TableCell><Badge className={`text-xs ${d.status === 'online' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>{d.status}</Badge></TableCell>
                    <TableCell className="text-slate-400 text-xs">{d.lastHeartbeat ? new Date(d.lastHeartbeat).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
                {devices.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-500 text-xs py-4">{t('No devices', 'لا توجد أجهزة')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <RaiseDefectDialog open={showRaiseDefect} onClose={() => setShowRaiseDefect(false)} onCreated={loadAll} />
      <OverrideGateDialog gate={overrideGate} open={!!overrideGate} onClose={() => setOverrideGate(null)} onDone={loadAll} />
    </AnimatedPage>
  );
}
