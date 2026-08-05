import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListReportDefinitions,
  useRunReport,
  useListReportSchedules,
  useCreateReportSchedule,
  useUpdateReportSchedule,
  useListReportOutputs,
  useDownloadReportOutput,
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
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  BarChart2, Play, Clock, CheckCircle, AlertTriangle,
  Download, Plus, FileText, Calendar,
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:    'bg-amber-100 text-amber-700 border-amber-200',
    running:    'bg-blue-100 text-blue-700 border-blue-200',
    ready:      'bg-emerald-100 text-emerald-700 border-emerald-200',
    failed:     'bg-red-100 text-red-700 border-red-200',
    processing: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-xs', map[status] ?? 'border-slate-300 text-slate-600')}>
      {status}
    </Badge>
  );
}

function FrequencyBadge({ freq }: { freq: string }) {
  const map: Record<string, string> = {
    daily:   'bg-blue-100 text-blue-700 border-blue-200',
    weekly:  'bg-violet-100 text-violet-700 border-violet-200',
    monthly: 'bg-amber-100 text-amber-700 border-amber-200',
    yearly:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-xs', map[freq] ?? '')}>
      {freq}
    </Badge>
  );
}

// ── Run Reports Tab ───────────────────────────────────────────────────────────

interface RunReportDialogProps {
  open: boolean;
  reportId: number | null;
  reportName: string;
  onClose: () => void;
  onSuccess: () => void;
}

function RunReportDialog({ open, reportId, reportName, onClose, onSuccess }: RunReportDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const runMut = useRunReport();

  const [exportFormat, setExportFormat] = useState('pdf');
  const [language, setLanguage] = useState('en');
  const [filtersJson, setFiltersJson] = useState('');
  const [running, setRunning] = useState(false);

  async function handleRun() {
    if (!reportId) return;
    setRunning(true);
    try {
      let filters: Record<string, unknown> | undefined;
      if (filtersJson.trim()) {
        try { filters = JSON.parse(filtersJson); } catch { /* ignore */ }
      }
      await runMut.mutateAsync({
        id: reportId,
        data: { exportFormat, language, filters } as any,
      });
      qc.invalidateQueries({ queryKey: ['/api/report-outputs'] });
      toast({ title: t('Report generated', 'تم إنشاء التقرير') });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Run Report', 'تشغيل التقرير')}</DialogTitle>
          <DialogDescription dir="auto">{reportName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Export Format', 'تنسيق التصدير')}</label>
            <Select value={exportFormat} onValueChange={setExportFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['pdf','excel','csv'].map(f => (
                  <SelectItem key={f} value={f} className="uppercase">{f.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Language', 'اللغة')}</label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
                <SelectItem value="both">{t('Both', 'كلاهما')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Filters (JSON, optional)', 'مرشحات (JSON، اختياري)')}</label>
            <Textarea
              value={filtersJson}
              onChange={e => setFiltersJson(e.target.value)}
              rows={3}
              placeholder={'{"departmentId": 1}'}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            onClick={handleRun}
            disabled={running}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          >
            {running ? t('Running…', 'جاري التشغيل…') : (
              <><Play className="w-4 h-4 me-1" />{t('Run', 'تشغيل')}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunReportsTab({ onRunSuccess }: { onRunSuccess: () => void }) {
  const { t } = useLanguage();
  const { data: defs, isLoading } = useListReportDefinitions(undefined as any);
  const [typeFilter, setTypeFilter] = useState('all');
  const [runDialog, setRunDialog] = useState<{ open: boolean; id: number | null; name: string }>({
    open: false, id: null, name: '',
  });

  const allDefs = defs ?? [];
  const types = useMemo(() => [...new Set(allDefs.map(d => (d as any).reportType ?? (d as any).type).filter(Boolean))], [allDefs]);
  const filtered = typeFilter === 'all' ? allDefs : allDefs.filter(d => ((d as any).reportType ?? (d as any).type) === typeFilter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('All Types', 'كل الأنواع')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Types', 'كل الأنواع')}</SelectItem>
            {types.map(tp => (
              <SelectItem key={tp} value={tp} className="capitalize">{tp}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4 bg-slate-700" />
                <Skeleton className="h-4 w-1/3 bg-slate-700" />
                <Skeleton className="h-12 w-full bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(def => {
            const d = def as any;
            return (
              <Card key={d.id} className="bg-slate-800 border-slate-700 flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base text-white">{d.nameEn ?? d.name}</CardTitle>
                    <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 capitalize shrink-0">
                      {d.reportType ?? d.type ?? 'report'}
                    </Badge>
                  </div>
                  {d.nameAr && (
                    <p className="text-sm text-slate-400" dir="rtl">{d.nameAr}</p>
                  )}
                </CardHeader>
                <CardContent className="flex-1 pb-2">
                  <p className="text-xs text-slate-400">{d.descriptionEn ?? d.description ?? t('No description', 'لا يوجد وصف')}</p>
                </CardContent>
                <div className="px-6 pb-4 space-y-2">
                  <Button
                    size="sm"
                    className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                    onClick={() => setRunDialog({ open: true, id: d.id, name: d.nameEn ?? d.name })}
                  >
                    <Play className="w-3 h-3 me-1" />
                    {t('Run Report', 'تشغيل التقرير')}
                    <span className="text-xs bg-amber-500/20 text-amber-900 px-1.5 py-0.5 rounded border border-amber-700/30 ms-2">⚠ Simulated</span>
                  </Button>
                </div>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-12 text-slate-500">
              {t('No report definitions found', 'لا توجد تعريفات تقارير')}
            </div>
          )}
        </div>
      )}

      <RunReportDialog
        open={runDialog.open}
        reportId={runDialog.id}
        reportName={runDialog.name}
        onClose={() => setRunDialog({ open: false, id: null, name: '' })}
        onSuccess={onRunSuccess}
      />
    </div>
  );
}

// ── Scheduled Tab ─────────────────────────────────────────────────────────────

function ScheduledTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);

  const { data: schedules, isLoading } = useListReportSchedules(undefined as any);
  const { data: defs } = useListReportDefinitions(undefined as any);
  const updateSched = useUpdateReportSchedule();

  const allSchedules = schedules ?? [];

  async function handleToggleActive(id: number, current: boolean) {
    try {
      await updateSched.mutateAsync({ id, data: { isActive: !current } });
      qc.invalidateQueries({ queryKey: ['/api/report-schedules'] });
      toast({ title: t('Updated', 'تم التحديث') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
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
          {t('New Schedule', 'جدولة جديدة')}
        </Button>
      </div>
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Report', 'التقرير')}</TableHead>
                <TableHead className="text-slate-400">{t('Frequency', 'التكرار')}</TableHead>
                <TableHead className="text-slate-400">{t('Day / Time', 'اليوم / الوقت')}</TableHead>
                <TableHead className="text-slate-400">{t('Format', 'التنسيق')}</TableHead>
                <TableHead className="text-slate-400">{t('Last Run', 'آخر تشغيل')}</TableHead>
                <TableHead className="text-slate-400">{t('Next Run', 'التشغيل التالي')}</TableHead>
                <TableHead className="text-slate-400">{t('Active', 'نشط')}</TableHead>
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
                : allSchedules.map(s => {
                    const sc = s as any;
                    const def = (defs ?? []).find(d => d.id === sc.reportDefinitionId) as any;
                    return (
                      <TableRow key={sc.id} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="text-white font-medium">{sc.nameEn ?? def?.nameEn ?? '—'}</TableCell>
                        <TableCell><FrequencyBadge freq={sc.frequency ?? 'daily'} /></TableCell>
                        <TableCell className="text-slate-300 text-sm">
                          {sc.dayOfMonth ? `Day ${sc.dayOfMonth}` : sc.dayOfWeek ?? '—'} {sc.timeOfDay ? `@ ${sc.timeOfDay}` : ''}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 uppercase">
                            {sc.exportFormat ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtDate(sc.lastRunAt)}</TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtDate(sc.nextRunAt)}</TableCell>
                        <TableCell>
                          <Switch checked={!!sc.isActive} onCheckedChange={() => handleToggleActive(sc.id, !!sc.isActive)} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && allSchedules.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={7} className="text-center py-10 text-slate-500">
                    {t('No schedules found', 'لا توجد جدولة')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewScheduleDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        definitions={defs ?? []}
      />
    </div>
  );
}

function NewScheduleDialog({ open, onClose, definitions }: { open: boolean; onClose: () => void; definitions: any[] }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createSched = useCreateReportSchedule();

  const [form, setForm] = useState({
    reportDefinitionId: '', nameEn: '', frequency: 'monthly',
    dayOfMonth: '', dayOfWeek: '', timeOfDay: '08:00',
    exportFormat: 'pdf', language: 'en',
  });
  const [saving, setSaving] = useState(false);

  function setF(k: string, v: string) { setForm(p => ({ ...p, [k]: v })); }

  async function handleSave() {
    if (!form.reportDefinitionId || !form.nameEn) {
      toast({ title: t('Report and name required', 'التقرير والاسم مطلوبان'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createSched.mutateAsync({
        data: {
          reportDefinitionId: Number(form.reportDefinitionId),
          nameEn: form.nameEn,
          frequency: form.frequency,
          dayOfMonth: form.dayOfMonth ? Number(form.dayOfMonth) : null,
          dayOfWeek: form.dayOfWeek ? Number(form.dayOfWeek) : null,
          timeOfDay: form.timeOfDay,
          exportFormat: form.exportFormat,
          language: form.language,
          isActive: true,
        },
      });
      qc.invalidateQueries({ queryKey: ['/api/report-schedules'] });
      toast({ title: t('Schedule created', 'تم إنشاء الجدولة') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Schedule', 'جدولة جديدة')}</DialogTitle>
          <DialogDescription>{t('Configure automatic report generation', 'تكوين إنشاء تقارير تلقائي')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Report', 'التقرير')}</label>
            <Select value={form.reportDefinitionId} onValueChange={v => setF('reportDefinitionId', v)}>
              <SelectTrigger><SelectValue placeholder={t('Select report', 'اختر التقرير')} /></SelectTrigger>
              <SelectContent>
                {definitions.map(d => (
                  <SelectItem key={d.id} value={String(d.id)}>{(d as any).nameEn ?? (d as any).name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Schedule Name', 'اسم الجدولة')}</label>
            <Input value={form.nameEn} onChange={e => setF('nameEn', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Frequency', 'التكرار')}</label>
              <Select value={form.frequency} onValueChange={v => setF('frequency', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['daily','weekly','monthly','yearly'].map(f => (
                    <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Time', 'الوقت')}</label>
              <Input type="time" value={form.timeOfDay} onChange={e => setF('timeOfDay', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Day of Month', 'يوم الشهر')}</label>
              <Input type="number" min={1} max={31} value={form.dayOfMonth} onChange={e => setF('dayOfMonth', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Day of Week', 'يوم الأسبوع')}</label>
              <Select value={form.dayOfWeek} onValueChange={v => setF('dayOfWeek', v)}>
                <SelectTrigger><SelectValue placeholder={t('Any', 'أي')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('Any', 'أي')}</SelectItem>
                  {[
                    { v: '0', l: 'Sunday' }, { v: '1', l: 'Monday' }, { v: '2', l: 'Tuesday' },
                    { v: '3', l: 'Wednesday' }, { v: '4', l: 'Thursday' }, { v: '5', l: 'Friday' },
                    { v: '6', l: 'Saturday' },
                  ].map(d => (
                    <SelectItem key={d.v} value={d.v}>{d.l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Export Format', 'تنسيق التصدير')}</label>
              <Select value={form.exportFormat} onValueChange={v => setF('exportFormat', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['pdf','excel','csv'].map(f => (
                    <SelectItem key={f} value={f} className="uppercase">{f.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Language', 'اللغة')}</label>
              <Select value={form.language} onValueChange={v => setF('language', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="both">{t('Both', 'كلاهما')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Output History Tab ────────────────────────────────────────────────────────

function OutputHistoryTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState('all');
  const [defFilter, setDefFilter] = useState('all');

  const { data: outputs, isLoading } = useListReportOutputs(undefined as any);
  const { data: defs } = useListReportDefinitions(undefined as any);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  // downloadQuery used to trigger the GET /:id/download endpoint
  const _downloadQuery = useDownloadReportOutput(downloadId ?? 0, {
    query: { enabled: downloadId != null } as any,
  });
  void _downloadQuery;

  const allOutputs = outputs ?? [];

  const filtered = useMemo(() => {
    return allOutputs.filter(o => {
      const op = o as any;
      if (statusFilter !== 'all' && op.status !== statusFilter) return false;
      if (defFilter !== 'all' && String(op.reportDefinitionId) !== defFilter) return false;
      return true;
    });
  }, [allOutputs, statusFilter, defFilter]);

  function handleDownload(id: number) {
    setDownloadId(id);
    // Show feedback; the query result will contain the download path
    toast({
      title: t('Download initiated', 'بدأ التنزيل'),
      description: `Output #${id}`,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('Status', 'الحالة')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Statuses', 'كل الحالات')}</SelectItem>
            {['pending','running','ready','failed'].map(s => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={defFilter} onValueChange={setDefFilter}>
          <SelectTrigger className="w-52 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('Report', 'التقرير')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Reports', 'كل التقارير')}</SelectItem>
            {(defs ?? []).map(d => (
              <SelectItem key={d.id} value={String(d.id)}>{(d as any).nameEn ?? (d as any).name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Report', 'التقرير')}</TableHead>
                <TableHead className="text-slate-400">{t('Generated By', 'أنشئ بواسطة')}</TableHead>
                <TableHead className="text-slate-400">{t('Format', 'التنسيق')}</TableHead>
                <TableHead className="text-slate-400">{t('Lang', 'اللغة')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-slate-400">{t('File', 'الملف')}</TableHead>
                <TableHead className="text-slate-400">{t('Size', 'الحجم')}</TableHead>
                <TableHead className="text-slate-400">{t('Rows', 'الصفوف')}</TableHead>
                <TableHead className="text-slate-400">{t('Generated At', 'أنشئ في')}</TableHead>
                <TableHead className="text-slate-400">{t('Download', 'تنزيل')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : filtered.map(out => {
                    const op = out as any;
                    const def = (defs ?? []).find(d => d.id === op.reportDefinitionId) as any;
                    return (
                      <TableRow key={op.id} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="text-white text-sm">{def?.nameEn ?? def?.name ?? '—'}</TableCell>
                        <TableCell className="text-slate-300 text-sm">{op.generatedByName ?? op.generatedBy ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 uppercase">
                            {op.outputFormat ?? op.exportFormat ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm uppercase">{op.language ?? '—'}</TableCell>
                        <TableCell><StatusBadge status={op.status ?? 'pending'} /></TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono truncate max-w-[120px]">
                          {op.fileName ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtBytes(op.fileSize)}</TableCell>
                        <TableCell className="text-slate-300 text-sm">{op.rowCount ?? '—'}</TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtDate(op.generatedAt ?? op.createdAt)}</TableCell>
                        <TableCell>
                          {op.status === 'ready' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-amber-400 hover:text-amber-300 h-7 px-2"
                              onClick={() => handleDownload(op.id)}
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && filtered.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={10} className="text-center py-10 text-slate-500">
                    {t('No report outputs found', 'لا توجد مخرجات تقارير')}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Reports() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('run');

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 bg-slate-900 min-h-screen">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-7 h-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Reports & Analytics', 'التقارير والتحليلات')}</h1>
            <p className="text-slate-400 text-sm">{t('Run reports, manage schedules, and view output history', 'تشغيل التقارير وإدارة الجداول وعرض سجل المخرجات')}</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="run" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Play className="w-4 h-4 me-1" />
              {t('Run Reports', 'تشغيل التقارير')}
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Calendar className="w-4 h-4 me-1" />
              {t('Scheduled', 'مجدول')}
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <FileText className="w-4 h-4 me-1" />
              {t('Output History', 'سجل المخرجات')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="run" className="mt-4">
            <RunReportsTab onRunSuccess={() => setActiveTab('history')} />
          </TabsContent>
          <TabsContent value="scheduled" className="mt-4">
            <ScheduledTab />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <OutputHistoryTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
