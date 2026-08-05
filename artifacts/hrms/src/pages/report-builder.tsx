import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import {
  useGetReportBuilderConfigs, usePostReportBuilderConfigs,
  usePostReportBuilderConfigsIdRun, usePostReportBuilderConfigsIdExport,
  useDeleteReportBuilderConfigsId, getGetReportBuilderConfigsQueryKey,
  useGetExportJobs, usePostExportJobsIdRetry, getGetExportJobsQueryKey,
} from '@workspace/api-client-react';
import type {
  ReportBuilderConfig, ExportJob,
  PostReportBuilderConfigsIdRun200RowsItem,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
  Play, Download, Edit, Trash2, Plus, RefreshCw, FileBarChart, AlertTriangle,
} from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    processing: 'bg-blue-100 text-blue-700 border-blue-200',
    completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    failed: 'bg-red-100 text-red-700 border-red-200',
    queued: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${map[status] ?? 'border-slate-300 text-slate-600'}`}>
      {status}
    </Badge>
  );
}

const DATA_SOURCES = ['employees', 'attendance', 'payroll', 'leave', 'training', 'documents'];

// ─── Run Results Dialog ───────────────────────────────────────────────────────

function RunResultsDialog({ open, onClose, results, loading }: {
  open: boolean; onClose: () => void; results: PostReportBuilderConfigsIdRun200RowsItem[]; loading: boolean;
}) {
  const { t } = useLanguage();
  const cols = results.length > 0 ? Object.keys(results[0]) : [];
  const preview = results.slice(0, 20);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('Report Results (Preview)', 'نتائج التقرير (معاينة)')}</DialogTitle>
          <DialogDescription>
            {t('Showing first 20 rows', 'عرض أول 20 صف')}
            {' '}
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs ms-1">⚠ Simulated</Badge>
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : preview.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t('No data returned', 'لا توجد بيانات')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.map(c => <TableHead key={c} className="text-xs">{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((row, i) => (
                  <TableRow key={i}>
                    {cols.map(c => (
                      <TableCell key={c} className="text-xs">{String(row[c] ?? '—')}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Close', 'إغلاق')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── My Reports Tab ───────────────────────────────────────────────────────────

function MyReportsTab() {
  const { t } = useLanguage();
  const { toast } = useToast();

  const { data: configs = [], isLoading: loading } = useGetReportBuilderConfigs();

  const runMut = usePostReportBuilderConfigsIdRun();
  const exportMut = usePostReportBuilderConfigsIdExport();
  const deleteMut = useDeleteReportBuilderConfigsId();
  const queryClient = useQueryClient();

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runResults, setRunResults] = useState<PostReportBuilderConfigsIdRun200RowsItem[]>([]);

  async function handleRun(id: number) {
    setRunDialogOpen(true);
    setRunResults([]);
    try {
      const data = await runMut.mutateAsync({ id });
      setRunResults(data.rows ?? []);
    } catch {
      toast({ title: t('Error running report', 'خطأ في تشغيل التقرير'), variant: 'destructive' });
      setRunDialogOpen(false);
    }
  }

  async function handleExport(id: number) {
    try {
      const data = await exportMut.mutateAsync({ id });
      const jobId = data.jobId ?? 'N';
      toast({ title: t('Export queued', 'تم قائمة التصدير'), description: `Job #${jobId}` });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMut.mutateAsync({ id });
      toast({ title: t('Deleted', 'تم الحذف') });
      queryClient.invalidateQueries({ queryKey: getGetReportBuilderConfigsQueryKey() });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4 bg-slate-700" />
                <Skeleton className="h-4 w-1/3 bg-slate-700" />
                <Skeleton className="h-10 w-full bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : configs.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <FileBarChart className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{t('No saved reports yet. Create one in the New Report tab.', 'لا توجد تقارير محفوظة. أنشئ واحداً في تبويب تقرير جديد.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {configs.map((cfg: ReportBuilderConfig) => (
            <Card key={cfg.id} className="bg-slate-800 border-slate-700 flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base text-white">{cfg.nameEn ?? 'Untitled'}</CardTitle>
                  <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 capitalize shrink-0">
                    {cfg.dataSource ?? '—'}
                  </Badge>
                </div>
                {cfg.nameAr && <p className="text-sm text-slate-400" dir="rtl">{cfg.nameAr}</p>}
              </CardHeader>
              <CardContent className="flex-1 pb-2">
                <p className="text-xs text-slate-400">{cfg.descriptionEn ?? t('No description', 'لا يوجد وصف')}</p>
                <p className="text-xs text-slate-500 mt-2">{t('Last run:', 'آخر تشغيل:')} {fmtDate(cfg.updatedAt)}</p>
              </CardContent>
              <div className="px-6 pb-4 flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold gap-1"
                  onClick={() => cfg.id != null && handleRun(cfg.id)}
                >
                  <Play className="w-3 h-3" />
                  {t('Run', 'تشغيل')}
                  <span className="text-[10px] bg-amber-600/30 text-amber-900 px-1 rounded border border-amber-700/30 ms-1">⚠ Simulated</span>
                </Button>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 gap-1" onClick={() => cfg.id != null && handleExport(cfg.id)}>
                  <Download className="w-3 h-3" />
                  {t('Export', 'تصدير')}
                </Button>
                <Button size="sm" variant="ghost" className="text-slate-400 gap-1">
                  <Edit className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="text-red-400 gap-1" onClick={() => cfg.id != null && handleDelete(cfg.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <RunResultsDialog
        open={runDialogOpen}
        onClose={() => setRunDialogOpen(false)}
        results={runResults}
        loading={runMut.isPending}
      />
    </div>
  );
}

// ─── New Report Tab ───────────────────────────────────────────────────────────

function NewReportTab({ onCreated }: { onCreated: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const createMut = usePostReportBuilderConfigs();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    nameEn: '', nameAr: '', dataSource: '', description: '',
    roleRestriction: '', isPublic: false,
  });

  function setF(k: string, v: string | boolean) {
    setForm(p => ({ ...p, [k]: v }));
  }

  async function handleCreate() {
    if (!form.nameEn || !form.dataSource) {
      toast({ title: t('Name and Data Source are required', 'الاسم ومصدر البيانات مطلوبان'), variant: 'destructive' });
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          nameEn: form.nameEn,
          nameAr: form.nameAr || form.nameEn,
          dataSource: form.dataSource,
          descriptionEn: form.description || undefined,
          roleRestriction: form.roleRestriction || undefined,
          isPublic: form.isPublic,
        },
      });
      toast({ title: t('Report created', 'تم إنشاء التقرير') });
      setForm({ nameEn: '', nameAr: '', dataSource: '', description: '', roleRestriction: '', isPublic: false });
      queryClient.invalidateQueries({ queryKey: getGetReportBuilderConfigsQueryKey() });
      onCreated();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <Card className="bg-slate-800 border-slate-700 max-w-lg">
      <CardHeader>
        <CardTitle className="text-white">{t('New Report Configuration', 'إعداد تقرير جديد')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-slate-300">{t('Name (EN)', 'الاسم (إنجليزي)')}</Label>
          <Input
            className="bg-slate-700 border-slate-600 text-white mt-1"
            value={form.nameEn}
            onChange={e => setF('nameEn', e.target.value)}
            placeholder="Monthly Headcount Report"
          />
        </div>
        <div>
          <Label className="text-slate-300">{t('Name (AR)', 'الاسم (عربي)')}</Label>
          <Input
            className="bg-slate-700 border-slate-600 text-white mt-1"
            value={form.nameAr}
            onChange={e => setF('nameAr', e.target.value)}
            dir="rtl"
            placeholder="تقرير عدد الموظفين الشهري"
          />
        </div>
        <div>
          <Label className="text-slate-300">{t('Data Source', 'مصدر البيانات')}</Label>
          <Select value={form.dataSource} onValueChange={v => setF('dataSource', v)}>
            <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
              <SelectValue placeholder={t('Select data source', 'اختر مصدر البيانات')} />
            </SelectTrigger>
            <SelectContent>
              {DATA_SOURCES.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-300">{t('Description', 'الوصف')}</Label>
          <Input
            className="bg-slate-700 border-slate-600 text-white mt-1"
            value={form.description}
            onChange={e => setF('description', e.target.value)}
          />
        </div>
        <div>
          <Label className="text-slate-300">{t('Role Restriction', 'قيد الدور')}</Label>
          <Input
            className="bg-slate-700 border-slate-600 text-white mt-1"
            value={form.roleRestriction}
            onChange={e => setF('roleRestriction', e.target.value)}
            placeholder={t('e.g. hr_manager', 'مثال: hr_manager')}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={form.isPublic} onCheckedChange={v => setF('isPublic', v)} />
          <Label className="text-slate-300">{t('Public (visible to all users)', 'عام (مرئي لجميع المستخدمين)')}</Label>
        </div>
        <Button
          className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          onClick={handleCreate}
          disabled={createMut.isPending}
        >
          <Plus className="w-4 h-4 me-2" />
          {createMut.isPending ? t('Creating…', 'جاري الإنشاء…') : t('Create Report', 'إنشاء تقرير')}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Export Queue Tab ─────────────────────────────────────────────────────────

function ExportQueueTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading: loading, refetch } = useGetExportJobs();
  const retryMut = usePostExportJobsIdRetry();

  async function handleRetry(id: number) {
    try {
      await retryMut.mutateAsync({ id });
      toast({ title: t('Retry queued', 'تمت إعادة المحاولة') });
      queryClient.invalidateQueries({ queryKey: getGetExportJobsQueryKey() });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 me-1" />
          {t('Refresh', 'تحديث')}
        </Button>
      </div>
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Job Type', 'نوع المهمة')}</TableHead>
                <TableHead className="text-slate-400">{t('Entity Type', 'نوع الكيان')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Created', 'أنشئ')}</TableHead>
                <TableHead className="text-slate-400">{t('Completed', 'اكتمل')}</TableHead>
                <TableHead className="text-slate-400">{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-700">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : jobs.length === 0
                  ? (
                    <TableRow className="border-slate-700">
                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                        {t('No export jobs found', 'لا توجد مهام تصدير')}
                      </TableCell>
                    </TableRow>
                  )
                  : jobs.map((job: ExportJob) => (
                    <TableRow key={job.id} className="border-slate-700 hover:bg-slate-700/40">
                      <TableCell className="text-white capitalize">{job.jobType ?? '—'}</TableCell>
                      <TableCell className="text-slate-300 capitalize">{job.entityType ?? '—'}</TableCell>
                      <TableCell><StatusBadge status={job.status ?? 'pending'} /></TableCell>
                      <TableCell className="text-slate-300 text-sm">{fmtDate(job.createdAt)}</TableCell>
                      <TableCell className="text-slate-300 text-sm">{fmtDate(job.completedAt)}</TableCell>
                      <TableCell>
                        {job.status === 'failed' && job.id != null && (
                          <Button size="sm" variant="ghost" className="text-amber-400 h-7 px-2" onClick={() => handleRetry(job.id!)}>
                            <RefreshCw className="w-3 h-3 me-1" />
                            {t('Retry', 'إعادة المحاولة')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ReportBuilder() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('my-reports');

  return (
    <AnimatedPage>
      <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t('Report Builder', 'منشئ التقارير')}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {t('Create, run, and export custom reports from any HR data source', 'إنشاء وتشغيل وتصدير تقارير مخصصة من أي مصدر بيانات موارد بشرية')}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 text-amber-400 px-3 py-2 rounded-lg text-sm mb-4"><AlertTriangle className="w-4 h-4 shrink-0" />{t("Report execution is not implemented; results are placeholder data and do not reflect real records.", "تنفيذ التقارير غير مُطبَّق؛ النتائج بيانات وهمية ولا تعكس السجلات الفعلية.")}</div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="my-reports" className="data-[state=active]:bg-slate-700">
              {t('My Reports', 'تقاريري')}
            </TabsTrigger>
            <TabsTrigger value="new-report" className="data-[state=active]:bg-slate-700">
              {t('New Report', 'تقرير جديد')}
            </TabsTrigger>
            <TabsTrigger value="export-queue" className="data-[state=active]:bg-slate-700">
              {t('Export Queue', 'قائمة التصدير')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-reports" className="mt-4">
            <MyReportsTab />
          </TabsContent>

          <TabsContent value="new-report" className="mt-4">
            <NewReportTab onCreated={() => setActiveTab('my-reports')} />
          </TabsContent>

          <TabsContent value="export-queue" className="mt-4">
            <ExportQueueTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
