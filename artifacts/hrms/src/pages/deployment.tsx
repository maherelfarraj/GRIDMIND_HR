import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListHealthCheckResults,
  useRunHealthChecks,
  useListUpdatePackages,
  useCreateUpdatePackage,
  useVerifyUpdatePackage,
  useInstallUpdatePackage,
  useListDeploymentEvents,
  useListInstallationReadiness,
  useRunInstallationReadiness,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Activity, CheckCircle, AlertTriangle, XCircle, Shield,
  Package, RefreshCw, Plus, Server, Cpu, Database,
  HardDrive, Clock, Zap,
} from 'lucide-react';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtBytes(b: number | null | undefined) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'pass' || status === 'passed') return <CheckCircle className="w-5 h-5 text-emerald-400" />;
  if (status === 'warn' || status === 'warning') return <AlertTriangle className="w-5 h-5 text-amber-400" />;
  if (status === 'fail' || status === 'failed')  return <XCircle className="w-5 h-5 text-red-400" />;
  return <Clock className="w-5 h-5 text-slate-400" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pass:    'bg-emerald-100 text-emerald-700 border-emerald-200',
    passed:  'bg-emerald-100 text-emerald-700 border-emerald-200',
    warn:    'bg-amber-100 text-amber-700 border-amber-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    fail:    'bg-red-100 text-red-700 border-red-200',
    failed:  'bg-red-100 text-red-700 border-red-200',
    pending: 'bg-slate-100 text-slate-600 border-slate-200',
    installed: 'bg-blue-100 text-blue-700 border-blue-200',
    verified:  'bg-violet-100 text-violet-700 border-violet-200',
    uploading: 'bg-amber-100 text-amber-700 border-amber-200',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-xs', map[status] ?? 'border-slate-300 text-slate-500')}>
      {status}
    </Badge>
  );
}

const CHECK_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  database: Database,
  disk:     HardDrive,
  license:  Shield,
  backup:   Server,
  sync:     RefreshCw,
};

// ── Health Checks Tab ─────────────────────────────────────────────────────────

const CHECK_TYPES = ['database', 'disk', 'license', 'backup', 'sync'] as const;

function HealthChecksTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: results, isLoading } = useListHealthCheckResults(undefined as any);
  const runMut = useRunHealthChecks();

  const allResults = results ?? [];

  // Latest result per check type
  const latestPerType = useMemo(() => {
    const map: Record<string, any> = {};
    [...allResults].reverse().forEach(r => {
      const rt = r as any;
      if (!map[rt.checkType]) map[rt.checkType] = rt;
    });
    return map;
  }, [allResults]);

  async function handleRunAll() {
    setRunning(true);
    try {
      await runMut.mutateAsync({ data: { checkTypes: [...CHECK_TYPES] } as any });
      qc.invalidateQueries({ queryKey: ['/api/health-checks/results'] });
      toast({ title: t('Health checks completed', 'اكتمل فحص الصحة') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end items-center gap-2">
        <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30">⚠ Simulated</span>
        <Button
          onClick={handleRunAll}
          disabled={running}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
        >
          <RefreshCw className={cn('w-4 h-4 me-1', running && 'animate-spin')} />
          {running ? t('Running…', 'جاري التشغيل…') : t('Run All Checks', 'تشغيل جميع الفحوصات')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {CHECK_TYPES.map(ct => {
          const latest = latestPerType[ct];
          const Icon = CHECK_TYPE_ICONS[ct] ?? Cpu;
          const status = latest?.status ?? 'pending';
          const borderColor = status === 'pass' || status === 'passed' ? 'border-emerald-700'
            : status === 'warn' || status === 'warning' ? 'border-amber-700'
            : status === 'fail' || status === 'failed' ? 'border-red-700'
            : 'border-slate-700';

          return (
            <Card key={ct} className={cn('bg-slate-800 border', borderColor)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Icon className="w-5 h-5 text-slate-400" />
                  <StatusIcon status={status} />
                </div>
                <p className="text-white font-semibold capitalize text-sm">{ct}</p>
                <p className="text-xs text-slate-400 mt-1 truncate">{latest?.message ?? t('Not run yet', 'لم يتم تشغيله بعد')}</p>
                {latest?.responseTimeMs != null && (
                  <p className="text-xs text-slate-500 mt-1">{latest.responseTimeMs}ms</p>
                )}
                <p className="text-xs text-slate-600 mt-1">{fmtDate(latest?.checkedAt)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent Results Table */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-base">{t('Recent Results', 'النتائج الأخيرة')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Check Type', 'نوع الفحص')}</TableHead>
                <TableHead className="text-slate-400">{t('Check Name', 'اسم الفحص')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Message', 'الرسالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Checked At', 'وقت الفحص')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : allResults.slice(0, 20).map((r, i) => {
                    const rc = r as any;
                    return (
                      <TableRow key={i} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs border-slate-600 text-slate-300">
                            {rc.checkType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-white text-sm">{rc.checkName ?? rc.name ?? '—'}</TableCell>
                        <TableCell><StatusBadge status={rc.status ?? 'pending'} /></TableCell>
                        <TableCell className="text-slate-300 text-sm max-w-xs truncate">{rc.message ?? '—'}</TableCell>
                        <TableCell className="text-slate-400 text-sm">{fmtDate(rc.checkedAt)}</TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && allResults.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={5} className="text-center py-10 text-slate-500">
                    {t('No results yet — run checks', 'لا توجد نتائج بعد — قم بتشغيل الفحوصات')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Update Packages Tab ───────────────────────────────────────────────────────

function UpdatePackagesTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data: packages, isLoading } = useListUpdatePackages(undefined as any);
  const verifyMut  = useVerifyUpdatePackage();
  const installMut = useInstallUpdatePackage();

  const allPackages = packages ?? [];

  async function handleVerify(id: number) {
    setBusyId(id);
    try {
      await verifyMut.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ['/api/update-packages'] });
      toast({ title: t('Package verified', 'تم التحقق من الحزمة') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleInstall(id: number) {
    if (!confirm(t('Install this package? This cannot be undone.', 'تثبيت هذه الحزمة؟ لا يمكن التراجع.'))) return;
    setBusyId(id);
    try {
      await installMut.mutateAsync({ id, data: {} as any });
      qc.invalidateQueries({ queryKey: ['/api/update-packages'] });
      toast({ title: t('Package installation started', 'بدأ تثبيت الحزمة') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="w-4 h-4 me-1" />
          {t('Register Package', 'تسجيل حزمة')}
        </Button>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Version', 'الإصدار')}</TableHead>
                <TableHead className="text-slate-400">{t('Package Name', 'اسم الحزمة')}</TableHead>
                <TableHead className="text-slate-400">{t('Critical', 'حرج')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Size', 'الحجم')}</TableHead>
                <TableHead className="text-slate-400">{t('Verified', 'تم التحقق')}</TableHead>
                <TableHead className="text-slate-400">{t('Actions', 'إجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : allPackages.map(pkg => {
                    const p = pkg as any;
                    const isBusy = busyId === p.id;
                    return (
                      <TableRow key={p.id} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="font-mono text-amber-400 text-sm">{p.packageVersion ?? p.version}</TableCell>
                        <TableCell className="text-white font-medium">{p.packageName ?? p.name}</TableCell>
                        <TableCell>
                          {p.isCritical
                            ? <Badge className="text-xs bg-red-900/50 text-red-300 border border-red-700/50">{t('Critical', 'حرج')}</Badge>
                            : <span className="text-slate-600 text-xs">—</span>}
                        </TableCell>
                        <TableCell><StatusBadge status={p.status ?? 'pending'} /></TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtBytes(p.fileSize)}</TableCell>
                        <TableCell>
                          {p.isVerified
                            ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                            : <XCircle className="w-4 h-4 text-slate-600" />}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {!p.isVerified && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                className="h-7 text-xs border-slate-600 text-slate-300 hover:text-white"
                                onClick={() => handleVerify(p.id)}
                              >
                                {t('Verify', 'تحقق')}
                              </Button>
                            )}
                            {p.isVerified && p.status !== 'installed' && (
                              <Button
                                size="sm"
                                disabled={isBusy}
                                className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                                onClick={() => handleInstall(p.id)}
                              >
                                <Zap className="w-3 h-3 me-1" />
                                {t('Install', 'تثبيت')}
                                <span className="text-[9px] bg-amber-500/20 text-amber-900 px-1 rounded border border-amber-700/30 ms-1">⚠ Sim</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && allPackages.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={7} className="text-center py-10 text-slate-500">
                    {t('No packages registered', 'لا توجد حزم مسجلة')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RegisterPackageDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function RegisterPackageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createPkg = useCreateUpdatePackage();

  const [form, setForm] = useState({
    packageVersion: '', packageName: '', checksum: '', isCritical: false,
  });
  const [saving, setSaving] = useState(false);

  function setF(k: string, v: string | boolean) { setForm(p => ({ ...p, [k]: v })); }

  async function handleSave() {
    if (!form.packageVersion || !form.packageName) {
      toast({ title: t('Version and name required', 'الإصدار والاسم مطلوبان'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createPkg.mutateAsync({ data: form as any });
      qc.invalidateQueries({ queryKey: ['/api/update-packages'] });
      toast({ title: t('Package registered', 'تم تسجيل الحزمة') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Register Package', 'تسجيل حزمة')}</DialogTitle>
          <DialogDescription>{t('Register a new update package', 'تسجيل حزمة تحديث جديدة')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Version', 'الإصدار')}</label>
            <Input value={form.packageVersion} onChange={e => setF('packageVersion', e.target.value)} placeholder="1.2.3" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Package Name', 'اسم الحزمة')}</label>
            <Input value={form.packageName} onChange={e => setF('packageName', e.target.value)} placeholder="hrms-core" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Checksum', 'المجموع الاختباري')}</label>
            <Input value={form.checksum} onChange={e => setF('checksum', e.target.value)} placeholder="sha256:…" className="font-mono text-xs" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={form.isCritical} onCheckedChange={v => setF('isCritical', v)} />
            {t('Critical Update', 'تحديث حرج')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Register', 'تسجيل')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Deployment Events Tab ─────────────────────────────────────────────────────

const EVENT_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  install:   Package,
  update:    RefreshCw,
  rollback:  RefreshCw,
  restart:   Activity,
  backup:    Server,
  migration: Database,
};

function DeploymentEventsTab() {
  const { t } = useLanguage();
  const [typeFilter, setTypeFilter]       = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const { data: events, isLoading } = useListDeploymentEvents(undefined as any);
  const allEvents = events ?? [];

  const types    = useMemo(() => [...new Set(allEvents.map(e => (e as any).eventType).filter(Boolean))], [allEvents]);
  const outcomes = useMemo(() => [...new Set(allEvents.map(e => (e as any).outcome).filter(Boolean))], [allEvents]);

  const filtered = useMemo(() => allEvents.filter(ev => {
    const e = ev as any;
    if (typeFilter !== 'all' && e.eventType !== typeFilter) return false;
    if (outcomeFilter !== 'all' && e.outcome !== outcomeFilter) return false;
    return true;
  }), [allEvents, typeFilter, outcomeFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('Event Type', 'نوع الحدث')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Types', 'كل الأنواع')}</SelectItem>
            {types.map(tp => (
              <SelectItem key={tp} value={tp} className="capitalize">{tp.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('Outcome', 'النتيجة')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Outcomes', 'كل النتائج')}</SelectItem>
            {outcomes.map(o => (
              <SelectItem key={o} value={o} className="capitalize">{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-4 w-2/3 bg-slate-700" />
                  <Skeleton className="h-3 w-full bg-slate-700" />
                </CardContent>
              </Card>
            ))
          : filtered.map((ev, idx) => {
              const e = ev as any;
              const Icon = EVENT_TYPE_ICONS[e.eventType] ?? Activity;
              const outcomeGood = e.outcome === 'success' || e.outcome === 'completed';
              return (
                <Card key={e.id ?? idx} className="bg-slate-800 border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                        outcomeGood ? 'bg-emerald-900/50' : 'bg-red-900/50'
                      )}>
                        <Icon className={cn('w-4 h-4', outcomeGood ? 'text-emerald-400' : 'text-red-400')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-white font-medium text-sm">
                              {e.description ?? e.eventType?.replace(/_/g, ' ') ?? '—'}
                            </p>
                            <StatusBadge status={e.outcome ?? 'pending'} />
                            {e.eventType && (
                              <Badge variant="outline" className="text-xs border-slate-600 text-slate-400 capitalize">
                                {e.eventType.replace(/_/g, ' ')}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-slate-500 shrink-0">{fmtDate(e.occurredAt ?? e.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                          {e.performedByName && <span>{t('By', 'بواسطة')}: {e.performedByName}</span>}
                          {e.durationMs != null && <span>{t('Duration', 'المدة')}: {e.durationMs}ms</span>}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            {t('No deployment events found', 'لا توجد أحداث نشر')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Readiness Tab ─────────────────────────────────────────────────────────────

function ReadinessTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: checks, isLoading } = useListInstallationReadiness(undefined as any);
  const runMut = useRunInstallationReadiness();

  const allChecks = checks ?? [];

  async function handleRun() {
    setRunning(true);
    try {
      await runMut.mutateAsync();
      qc.invalidateQueries({ queryKey: ['/api/installation-readiness'] });
      toast({ title: t('Readiness check completed', 'اكتمل فحص الجاهزية') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  }

  const summary = useMemo(() => ({
    passed:   allChecks.filter(c => (c as any).status === 'pass' || (c as any).status === 'passed').length,
    warnings: allChecks.filter(c => (c as any).status === 'warn' || (c as any).status === 'warning').length,
    failed:   allChecks.filter(c => (c as any).status === 'fail' || (c as any).status === 'failed').length,
  }), [allChecks]);

  // Group by category
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    allChecks.forEach(c => {
      const cat = (c as any).category ?? 'General';
      if (!map[cat]) map[cat] = [];
      map[cat].push(c);
    });
    return map;
  }, [allChecks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {allChecks.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle className="w-4 h-4" />
              <span className="font-semibold">{summary.passed}</span>
              <span className="text-slate-400 text-sm">{t('passed', 'نجح')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-semibold">{summary.warnings}</span>
              <span className="text-slate-400 text-sm">{t('warnings', 'تحذيرات')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-400">
              <XCircle className="w-4 h-4" />
              <span className="font-semibold">{summary.failed}</span>
              <span className="text-slate-400 text-sm">{t('failed', 'فشل')}</span>
            </div>
          </div>
        )}
        <Button
          onClick={handleRun}
          disabled={running}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
        >
          <RefreshCw className={cn('w-4 h-4 me-1', running && 'animate-spin')} />
          {running ? t('Checking…', 'جاري الفحص…') : t('Run Readiness Check', 'تشغيل فحص الجاهزية')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-3/4 bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <Card key={category} className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm uppercase tracking-wider">{category}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-700">
                {items.map((item: any) => {
                  const st = item.status ?? 'pending';
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-6 py-3">
                      <StatusIcon status={st} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium">{item.checkItem ?? item.name ?? '—'}</p>
                          {item.isMandatory && (
                            <Badge variant="outline" className="text-xs border-red-700/50 text-red-400">
                              {t('Mandatory', 'إلزامي')}
                            </Badge>
                          )}
                        </div>
                        {item.resultMessage && (
                          <p className="text-xs text-slate-400 mt-0.5">{item.resultMessage}</p>
                        )}
                      </div>
                      <StatusBadge status={st} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {!isLoading && allChecks.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{t('No readiness data — run check', 'لا توجد بيانات جاهزية — قم بتشغيل الفحص')}</p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Deployment() {
  const { t } = useLanguage();

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 bg-slate-900 min-h-screen">
        <div className="flex items-center gap-3">
          <Activity className="w-7 h-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Deployment & Health', 'النشر والصحة')}</h1>
            <p className="text-slate-400 text-sm">{t('System health checks, update packages, deployment events, and readiness', 'فحوصات صحة النظام والحزم والأحداث والجاهزية')}</p>
          </div>
        </div>

        <Tabs defaultValue="health">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="health" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Activity className="w-4 h-4 me-1" />
              {t('Health Checks', 'فحوصات الصحة')}
            </TabsTrigger>
            <TabsTrigger value="packages" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Package className="w-4 h-4 me-1" />
              {t('Update Packages', 'حزم التحديث')}
            </TabsTrigger>
            <TabsTrigger value="events" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Clock className="w-4 h-4 me-1" />
              {t('Deployment Events', 'أحداث النشر')}
            </TabsTrigger>
            <TabsTrigger value="readiness" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <CheckCircle className="w-4 h-4 me-1" />
              {t('Readiness', 'الجاهزية')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="health" className="mt-4">
            <HealthChecksTab />
          </TabsContent>
          <TabsContent value="packages" className="mt-4">
            <UpdatePackagesTab />
          </TabsContent>
          <TabsContent value="events" className="mt-4">
            <DeploymentEventsTab />
          </TabsContent>
          <TabsContent value="readiness" className="mt-4">
            <ReadinessTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
