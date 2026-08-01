import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/hooks/use-auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPayrollPeriods,
  useGetPayrollPeriod,
  useGetPayrollPeriodOtSummary,
  useCreatePayrollPeriod,
  useCalculatePayrollPeriod,
  useApprovePayrollPeriod,
  useClosePayrollPeriod,
  useListPayrollRuns,
  useListPayrollPeriodNoShows,
  useExcusePayrollAbsence,
  useUnexcusePayrollAbsence,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  DollarSign,
  Users,
  TrendingDown,
  TrendingUp,
  Lock,
  Plus,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  CalendarDays,
  Receipt,
  UserX,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtMoney(val: string | number | undefined, currency = 'SAR'): string {
  const num = parseFloat(String(val ?? '0'));
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoneyShort(val: string | number | undefined): string {
  const num = parseFloat(String(val ?? '0'));
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type PeriodStatus =
  | 'draft'
  | 'calculating'
  | 'under_review'
  | 'first_approved'
  | 'second_approved'
  | 'closed';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: [string, string]; cls: string; icon?: React.ReactNode }> = {
    draft: { label: ['Draft', 'مسودة'], cls: 'bg-slate-500/10 text-slate-500 border-transparent' },
    calculating: { label: ['Calculating', 'يحسب'], cls: 'bg-blue-500/10 text-blue-500 border-transparent' },
    under_review: { label: ['Under Review', 'قيد المراجعة'], cls: 'bg-amber-500/10 text-amber-600 border-transparent' },
    first_approved: { label: ['1st Approved', 'موافقة أولى'], cls: 'bg-indigo-500/10 text-indigo-600 border-transparent' },
    second_approved: { label: ['2nd Approved', 'موافقة ثانية'], cls: 'bg-violet-500/10 text-violet-600 border-transparent' },
    closed: {
      label: ['Closed', 'مغلق'],
      cls: 'bg-emerald-500/10 text-emerald-600 border-transparent',
      icon: <Lock className="h-3 w-3 inline-block mr-1" />,
    },
  };
  const { lang } = useLanguage();
  const cfg = map[status] ?? { label: [status, status], cls: 'bg-slate-500/10 text-slate-500 border-transparent' };
  return (
    <Badge className={cn('shadow-none text-xs font-medium', cfg.cls)}>
      {cfg.icon}
      {lang === 'ar' ? cfg.label[1] : cfg.label[0]}
    </Badge>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const { lang } = useLanguage();
  const map: Record<string, { label: [string, string]; cls: string }> = {
    draft: { label: ['Draft', 'مسودة'], cls: 'bg-slate-500/10 text-slate-500 border-transparent' },
    calculated: { label: ['Calculated', 'محسوب'], cls: 'bg-blue-500/10 text-blue-600 border-transparent' },
    exception: { label: ['Exception', 'استثناء'], cls: 'bg-red-500/10 text-red-600 border-transparent' },
    approved: { label: ['Approved', 'معتمد'], cls: 'bg-green-500/10 text-green-600 border-transparent' },
  };
  const cfg = map[status] ?? { label: [status, status], cls: 'bg-slate-500/10 text-slate-500 border-transparent' };
  return (
    <Badge className={cn('shadow-none text-xs font-medium', cfg.cls)}>
      {lang === 'ar' ? cfg.label[1] : cfg.label[0]}
    </Badge>
  );
}

// ─── New Period Dialog ───────────────────────────────────────────────────────

const defaultPeriodForm = {
  periodCode: '',
  nameEn: '',
  nameAr: '',
  startDate: '',
  endDate: '',
  payDate: '',
  notes: '',
};

function NewPeriodDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(defaultPeriodForm);

  const createPeriod = useCreatePayrollPeriod({
    mutation: {
      onSuccess: () => {
        toast({ title: t('Period created', 'تم إنشاء الفترة') });
        queryClient.invalidateQueries({ queryKey: ['/api/payroll-periods'] });
        setForm(defaultPeriodForm);
        onClose();
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.message ?? t('Failed', 'فشل'), variant: 'destructive' });
      },
    },
  });

  const field = (key: keyof typeof form, label: string, labelAr: string, type = 'text') => (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-muted-foreground">{t(label, labelAr)}</label>
      <Input
        type={type}
        value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        placeholder={t(label, labelAr)}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New Payroll Period', 'فترة رواتب جديدة')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          {field('periodCode', 'Period Code', 'رمز الفترة')}
          {field('nameEn', 'Name (EN)', 'الاسم (إنجليزي)')}
          {field('nameAr', 'Name (AR)', 'الاسم (عربي)')}
          <div />
          {field('startDate', 'Start Date', 'تاريخ البداية', 'date')}
          {field('endDate', 'End Date', 'تاريخ النهاية', 'date')}
          {field('payDate', 'Pay Date', 'تاريخ الصرف', 'date')}
          <div />
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('Notes', 'ملاحظات')}</label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder={t('Optional notes', 'ملاحظات اختيارية')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            disabled={createPeriod.isPending || !form.periodCode || !form.nameEn || !form.startDate || !form.endDate || !form.payDate}
            onClick={() =>
              createPeriod.mutate({
                data: {
                  periodCode: form.periodCode,
                  nameEn: form.nameEn,
                  nameAr: form.nameAr,
                  startDate: form.startDate,
                  endDate: form.endDate,
                  payDate: form.payDate,
                  notes: form.notes || null,
                },
              })
            }
          >
            {createPeriod.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('Create Period', 'إنشاء الفترة')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Approval Dialog ─────────────────────────────────────────────────────────

function ApprovalDialog({
  open,
  title,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (approverName: string, note: string) => void;
  loading: boolean;
}) {
  const { t } = useLanguage();
  const [approverName, setApproverName] = useState('');
  const [note, setNote] = useState('');

  const reset = () => { setApproverName(''); setNote(''); };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('Approver Name', 'اسم المعتمد')}</label>
            <Input value={approverName} onChange={e => setApproverName(e.target.value)} placeholder={t('Full name', 'الاسم الكامل')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('Note', 'ملاحظة')}</label>
            <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Optional approval note', 'ملاحظة اعتماد اختيارية')} />
          </div>
        </div>
        <DialogFooter className="flex-col items-start gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500 flex-1">{t("This action is audit-logged.", "هذا الإجراء مُسجَّل في سجل التدقيق.")}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>{t('Cancel', 'إلغاء')}</Button>
            <Button disabled={loading || !approverName} onClick={() => onConfirm(approverName, note)}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('Confirm', 'تأكيد')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Close Confirmation Dialog ────────────────────────────────────────────────

function CloseConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-destructive">{t('Close Period', 'إغلاق الفترة')}</DialogTitle>
          <DialogDescription>
            {t(
              'This action is IRREVERSIBLE. The period will be permanently locked and no further changes can be made.',
              'هذا الإجراء لا رجعة فيه. سيتم قفل الفترة بشكل دائم ولن يمكن إجراء أي تغييرات إضافية.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col items-start gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500 flex-1">{t("This action is audit-logged.", "هذا الإجراء مُسجَّل في سجل التدقيق.")}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
            <Button variant="destructive" disabled={loading} onClick={onConfirm}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('Close Period Permanently', 'إغلاق الفترة نهائياً')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── No-Show Review Card ──────────────────────────────────────────────────────

function NoShowsCard({ periodId, isClosed }: { periodId: number; isClosed: boolean }) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: report, isLoading } = useListPayrollPeriodNoShows(periodId);

  const [excuseTarget, setExcuseTarget] = useState<null | { employeeId: number; employeeName: string; date: string }>(null);
  const [reason, setReason] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/payroll-periods/${periodId}/no-shows`] });
  };

  const excuseMutation = useExcusePayrollAbsence({
    mutation: {
      onSuccess: () => {
        toast({
          title: t('Day excused', 'تم إعفاء اليوم'),
          description: t('Recalculate the period to update deductions.', 'أعد حساب الفترة لتحديث الاستقطاعات.'),
        });
        invalidate();
        setExcuseTarget(null);
        setReason('');
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.response?.data?.error ?? err?.message, variant: 'destructive' });
      },
    },
  });

  const unexcuseMutation = useUnexcusePayrollAbsence({
    mutation: {
      onSuccess: () => {
        toast({ title: t('Excusal removed', 'تمت إزالة الإعفاء') });
        invalidate();
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.response?.data?.error ?? err?.message, variant: 'destructive' });
      },
    },
  });

  const employees = report?.employees ?? [];

  if (!isLoading && employees.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserX className="h-4 w-4 text-amber-500" />
          {t('No-Show Days (Unexcused Absences)', 'أيام الغياب بدون إذن')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(
            'Workdays with no punch activity, no attendance record and no approved leave. Excused days are skipped from the absence deduction on recalculation.',
            'أيام عمل بدون بصمة أو سجل حضور أو إجازة معتمدة. الأيام المعفاة تُستثنى من خصم الغياب عند إعادة الحساب.'
          )}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Employee', 'الموظف')}</TableHead>
                  <TableHead>{t('No-Show Days', 'أيام الغياب')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map(emp => (
                  <TableRow key={emp.employeeId}>
                    <TableCell className="align-top">
                      <div className="font-medium text-sm">
                        {lang === 'ar' ? emp.employeeNameAr : emp.employeeNameEn}
                      </div>
                      <div className="text-xs text-muted-foreground">{emp.employeeNumber}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {emp.days.map(day => (
                          <span
                            key={day.date}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono',
                              day.excused
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                                : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                            )}
                            title={day.excused && day.reason ? `${t('Excused', 'معفى')}: ${day.reason}` : undefined}
                          >
                            {day.excused && <ShieldCheck className="h-3 w-3" />}
                            {day.date}
                            {!isClosed && !day.excused && (
                              <button
                                className="ml-1 underline decoration-dotted hover:text-foreground font-sans"
                                onClick={() =>
                                  setExcuseTarget({
                                    employeeId: emp.employeeId,
                                    employeeName: lang === 'ar' ? emp.employeeNameAr : emp.employeeNameEn,
                                    date: day.date,
                                  })
                                }
                              >
                                {t('Excuse', 'إعفاء')}
                              </button>
                            )}
                            {!isClosed && day.excused && day.excusedId != null && (
                              <button
                                className="ml-1 hover:text-foreground"
                                title={t('Undo excusal', 'تراجع عن الإعفاء')}
                                onClick={() => unexcuseMutation.mutate({ id: periodId, excusedId: day.excusedId! })}
                                disabled={unexcuseMutation.isPending}
                              >
                                <Undo2 className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Excuse dialog */}
      <Dialog open={excuseTarget !== null} onOpenChange={v => { if (!v) { setExcuseTarget(null); setReason(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Excuse No-Show Day', 'إعفاء يوم غياب')}</DialogTitle>
            <DialogDescription>
              {excuseTarget && (
                <>
                  {excuseTarget.employeeName} · <span className="font-mono">{excuseTarget.date}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 py-2">
            <label className="text-sm font-medium text-muted-foreground">{t('Reason', 'السبب')}</label>
            <Textarea
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('e.g. biometric device outage, off-site assignment…', 'مثال: عطل جهاز البصمة، مهمة خارجية…')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExcuseTarget(null); setReason(''); }}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button
              disabled={excuseMutation.isPending || !reason.trim() || !excuseTarget}
              onClick={() =>
                excuseTarget &&
                excuseMutation.mutate({
                  id: periodId,
                  data: { employeeId: excuseTarget.employeeId, date: excuseTarget.date, reason: reason.trim() },
                })
              }
            >
              {excuseMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('Excuse Day', 'إعفاء اليوم')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Period Detail Panel ──────────────────────────────────────────────────────

function PeriodDetail({
  periodId,
  onBack,
}: {
  periodId: number;
  onBack: () => void;
}) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // TODO: replace with proper role-name lookup once role names are exposed by useAuth
  // Role IDs: 1=super_admin, 2=hr_manager, 3=payroll_admin
  const isPayrollAdmin = user ? user.roleId <= 3 : false;

  const { data: period, isLoading: loadingPeriod } = useGetPayrollPeriod(periodId);
  const { data: runs, isLoading: loadingRuns } = useListPayrollRuns({ periodId });
  const { data: otSummary } = useGetPayrollPeriodOtSummary(periodId);

  const [approvalDialog, setApprovalDialog] = useState<null | 'first' | 'second'>(null);
  const [closeDialog, setCloseDialog] = useState(false);

  const calcMutation = useCalculatePayrollPeriod({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: t('Calculation complete', 'اكتمل الحساب'),
          description: t(
            `${result.runsCreated} runs created, ${result.exceptionCount} exceptions`,
            `${result.runsCreated} تشغيل، ${result.exceptionCount} استثناء`
          ),
        });
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-periods/${periodId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-periods/${periodId}/ot-summary`] });
        queryClient.invalidateQueries({ queryKey: ['/api/payroll-runs'] });
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.message, variant: 'destructive' });
      },
    },
  });

  const approveMutation = useApprovePayrollPeriod({
    mutation: {
      onSuccess: () => {
        toast({ title: t('Approved', 'تمت الموافقة') });
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-periods/${periodId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/payroll-periods'] });
        setApprovalDialog(null);
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.message, variant: 'destructive' });
      },
    },
  });

  const closeMutation = useClosePayrollPeriod({
    mutation: {
      onSuccess: () => {
        toast({ title: t('Period closed', 'تم إغلاق الفترة') });
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-periods/${periodId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/payroll-periods'] });
        setCloseDialog(false);
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.message, variant: 'destructive' });
      },
    },
  });

  // Department chart data
  const deptMap: Record<string, { dept: string; gross: number; net: number }> = {};
  (runs ?? []).forEach(r => {
    const dept = r.departmentNameEn ?? 'Unknown';
    if (!deptMap[dept]) deptMap[dept] = { dept, gross: 0, net: 0 };
    deptMap[dept].gross += parseFloat(r.grossSalary);
    deptMap[dept].net += parseFloat(r.netSalary);
  });
  const deptChartData = Object.values(deptMap);

  const totalGross = (runs ?? []).reduce((s, r) => s + parseFloat(r.grossSalary), 0);
  const totalDeds = (runs ?? []).reduce((s, r) => s + parseFloat(r.totalDeductions), 0);
  const totalNet = (runs ?? []).reduce((s, r) => s + parseFloat(r.netSalary), 0);
  const totalOTPay = (runs ?? []).reduce((s, r) => s + parseFloat(r.overtimePay ?? '0'), 0);

  if (loadingPeriod) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!period) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t('Period not found', 'الفترة غير موجودة')}
      </div>
    );
  }

  const isClosed = period.isClosed || period.status === 'closed';
  const approvalTitle =
    approvalDialog === 'first'
      ? t('First Approval', 'الموافقة الأولى')
      : t('Second Approval', 'الموافقة الثانية');

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Mobile back */}
      <div className="flex items-center gap-2 p-4 border-b md:hidden">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('Back', 'رجوع')}
        </Button>
      </div>

      {/* Header */}
      <div className="p-6 border-b flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">
              {lang === 'ar' ? period.nameAr : period.nameEn}
            </h2>
            <StatusBadge status={period.status} />
            <span className="text-sm text-muted-foreground">{period.currency}</span>
          </div>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {period.startDate} → {period.endDate}
            <span className="mx-1">·</span>
            {t('Pay date:', 'تاريخ الصرف:')} {period.payDate}
          </p>
          <p className="text-xs text-muted-foreground font-mono">{period.periodCode}</p>
        </div>

        {/* Action bar — payroll_admin only */}
        {!isClosed && isPayrollAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            {period.status === 'draft' && (
              <Button
                size="sm"
                onClick={() => calcMutation.mutate({ id: period.id })}
                disabled={calcMutation.isPending}
              >
                {calcMutation.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Receipt className="h-4 w-4 mr-2" />}
                {t('Calculate Payroll', 'حساب الرواتب')}
              </Button>
            )}
            {period.status === 'under_review' && (
              <Button size="sm" variant="outline" onClick={() => setApprovalDialog('first')}>
                <CheckCircle2 className="h-4 w-4 mr-2 text-indigo-500" />
                {t('First Approval', 'الموافقة الأولى')}
              </Button>
            )}
            {period.status === 'first_approved' && (
              <Button size="sm" variant="outline" onClick={() => setApprovalDialog('second')}>
                <CheckCircle2 className="h-4 w-4 mr-2 text-violet-500" />
                {t('Second Approval', 'الموافقة الثانية')}
              </Button>
            )}
            {period.status === 'second_approved' && (
              <Button size="sm" variant="destructive" onClick={() => setCloseDialog(true)}>
                <Lock className="h-4 w-4 mr-2" />
                {t('Close Period', 'إغلاق الفترة')}
              </Button>
            )}
          </div>
        )}
        {isClosed && period.closedAt && (
          <div className="flex items-center gap-1.5 text-sm text-emerald-600">
            <Lock className="h-4 w-4" />
            {t('Closed', 'مغلق')} {new Date(period.closedAt).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Exception banner */}
        {period.exceptionCount > 0 && (
          <Alert className="border-amber-400/40 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-amber-700 dark:text-amber-400">
              {t(
                `${period.exceptionCount} employee(s) have exceptions requiring review`,
                `${period.exceptionCount} موظف لديهم استثناءات تتطلب مراجعة`
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('Employees', 'الموظفون')}</p>
                <p className="text-xl font-bold">{period.totalEmployees}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('Gross Salary', 'الراتب الإجمالي')}</p>
                <p className="text-base font-bold leading-tight">{fmtMoney(period.totalGrossSalary, period.currency)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <TrendingDown className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('Deductions', 'الاستقطاعات')}</p>
                <p className="text-base font-bold leading-tight">{fmtMoney(period.totalDeductions, period.currency)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <TrendingUp className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('Net Salary', 'صافي الراتب')}</p>
                <p className="text-base font-bold leading-tight">{fmtMoney(period.totalNetSalary, period.currency)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* No-show review */}
        <NoShowsCard periodId={period.id} isClosed={isClosed} />

        {/* Employee runs table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('Employee Payroll Runs', 'تشغيلات رواتب الموظفين')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingRuns ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : !runs || runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
                <Receipt className="h-8 w-8 opacity-30" />
                <p className="text-sm">{t('No runs yet. Calculate payroll to generate runs.', 'لا تشغيلات بعد. احسب الرواتب لإنشاء تشغيلات.')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>{t('Employee', 'الموظف')}</TableHead>
                      <TableHead>{t('Grade', 'الدرجة')}</TableHead>
                      <TableHead className="text-right">{t('Gross', 'الإجمالي')}</TableHead>
                      <TableHead className="text-right">{t('Deductions', 'الاستقطاعات')}</TableHead>
                      <TableHead className="text-right">{t('Net', 'الصافي')}</TableHead>
                      <TableHead className="text-right">{t('OT Hrs', 'س.إضافية')}</TableHead>
                      <TableHead>{t('Status', 'الحالة')}</TableHead>
                      <TableHead className="text-right">{t('Actions', 'الإجراءات')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run, idx) => (
                      <TableRow
                        key={run.id}
                        className={cn(run.hasException && 'bg-amber-50/60 dark:bg-amber-950/20')}
                      >
                        <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {lang === 'ar' ? (run.employeeNameAr || run.employeeNameEn) : run.employeeNameEn}
                          </div>
                          {run.employeeNumber && (
                            <div className="text-xs text-muted-foreground">{run.employeeNumber}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{run.grade ?? '—'}</TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {fmtMoneyShort(run.grossSalary)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono text-red-600">
                          {fmtMoneyShort(run.totalDeductions)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono font-semibold">
                          {fmtMoneyShort(run.netSalary)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {run.overtimeHours ?? '0'}
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm" className="text-xs h-7">
                            <Link href={`/payroll/payslip/${run.id}`}>
                              {t('Payslip', 'قسيمة الراتب')}
                              <ChevronRight className="h-3 w-3 ml-1" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Finance Summary */}
        {runs && runs.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Bar Chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t('Gross vs Net by Department', 'الإجمالي مقابل الصافي حسب الإدارة')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={deptChartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <XAxis dataKey="dept" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [`SAR ${v.toLocaleString()}`, '']} />
                    <Bar dataKey="gross" fill="#6366f1" name={t('Gross', 'الإجمالي')} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="net" fill="#10b981" name={t('Net', 'الصافي')} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Totals */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t('Finance Summary', 'الملخص المالي')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: [t('Total Gross', 'إجمالي الرواتب')], val: totalGross, cls: 'text-indigo-600' },
                  { label: [t('Total Deductions', 'إجمالي الاستقطاعات')], val: totalDeds, cls: 'text-red-600' },
                  { label: [t('Total Net', 'إجمالي الصافي')], val: totalNet, cls: 'text-emerald-600 font-bold' },
                  { label: [t('Total OT Pay', 'إجمالي الإضافي')], val: totalOTPay, cls: 'text-amber-600' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">{item.label[0]}</span>
                    <span className={cn('text-sm font-mono', item.cls)}>
                      SAR {item.val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
                {otSummary && (
                  <div className="pl-3 border-l-2 border-amber-200 space-y-1.5" data-testid="ot-breakdown">
                    {[
                      { label: t('Weekday OT', 'إضافي أيام الأسبوع'), val: parseFloat(otSummary.weekday) },
                      { label: t('Weekend OT', 'إضافي عطلة نهاية الأسبوع'), val: parseFloat(otSummary.weekend) },
                      { label: t('Holiday OT', 'إضافي العطلات الرسمية'), val: parseFloat(otSummary.holiday) },
                    ].map((item, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <span className="text-xs font-mono text-amber-600/90">
                          SAR {item.val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ApprovalDialog
        open={approvalDialog !== null}
        title={approvalTitle}
        loading={approveMutation.isPending}
        onClose={() => setApprovalDialog(null)}
        onConfirm={(name, note) =>
          approveMutation.mutate({ id: period.id, data: { approverId: null, note: `${name}: ${note}` } })
        }
      />
      <CloseConfirmDialog
        open={closeDialog}
        loading={closeMutation.isPending}
        onClose={() => setCloseDialog(false)}
        onConfirm={() => closeMutation.mutate({ id: period.id })}
      />
    </div>
  );
}

// ─── Period List ──────────────────────────────────────────────────────────────

type StatusTab = 'all' | 'draft' | 'under_review' | 'first_approved' | 'second_approved' | 'closed';

const STATUS_TABS: { value: StatusTab; label: [string, string] }[] = [
  { value: 'all', label: ['All', 'الكل'] },
  { value: 'draft', label: ['Draft', 'مسودة'] },
  { value: 'under_review', label: ['Under Review', 'قيد المراجعة'] },
  { value: 'first_approved', label: ['1st Approved', 'موافقة أولى'] },
  { value: 'second_approved', label: ['2nd Approved', 'موافقة ثانية'] },
  { value: 'closed', label: ['Closed', 'مغلق'] },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Payroll() {
  const { t, lang } = useLanguage();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [newPeriodOpen, setNewPeriodOpen] = useState(false);

  const { data: periods, isLoading } = useListPayrollPeriods();

  const filtered = (periods ?? []).filter(p => {
    if (statusTab === 'all') return true;
    if (statusTab === 'draft') return p.status === 'draft' || p.status === 'calculating';
    return p.status === statusTab;
  });

  // On mobile, when a period is selected, show detail only
  const showDetail = selectedId !== null;

  return (
    <AnimatedPage>
      <div className="h-full flex flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h1 className="text-2xl font-bold">{t('Payroll', 'الرواتب')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('Manage payroll periods and employee runs', 'إدارة فترات الرواتب وتشغيلات الموظفين')}
            </p>
          </div>
          <Button size="sm" onClick={() => setNewPeriodOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('New Period', 'فترة جديدة')}
          </Button>
        </div>

        {/* Split layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Period List — hidden on mobile when detail is open */}
          <div
            className={cn(
              'flex flex-col border-r w-full md:w-80 lg:w-96 shrink-0',
              showDetail && 'hidden md:flex'
            )}
          >
            <div className="p-3 border-b overflow-x-auto">
              <Tabs value={statusTab} onValueChange={v => setStatusTab(v as StatusTab)}>
                <TabsList className="flex gap-1 h-auto p-1 flex-wrap">
                  {STATUS_TABS.map(tab => (
                    <TabsTrigger key={tab.value} value={tab.value} className="text-xs px-2 py-1 h-7">
                      {lang === 'ar' ? tab.label[1] : tab.label[0]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 overflow-y-auto divide-y">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <CalendarDays className="h-8 w-8 opacity-30" />
                  <p className="text-sm">{t('No periods found', 'لا توجد فترات')}</p>
                </div>
              ) : (
                filtered.map(period => {
                  const isClosed = period.isClosed || period.status === 'closed';
                  return (
                    <button
                      key={period.id}
                      onClick={() => setSelectedId(period.id)}
                      className={cn(
                        'w-full text-left p-4 hover:bg-muted/50 transition-colors flex flex-col gap-1.5',
                        selectedId === period.id && 'bg-muted'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">
                          {lang === 'ar' ? period.nameAr : period.nameEn}
                        </span>
                        <StatusBadge status={period.status} />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono">{period.periodCode}</span>
                        <span>·</span>
                        <span>{period.startDate} → {period.endDate}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {period.totalEmployees} {t('emp', 'موظف')}
                        </span>
                        <span className="flex items-center gap-1 font-mono">
                          {isClosed && <Lock className="h-3 w-3 text-emerald-500" />}
                          {fmtMoney(period.totalNetSalary, period.currency)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Period Detail */}
          <div className={cn('flex-1 overflow-y-auto', !showDetail && 'hidden md:flex md:items-center md:justify-center')}>
            {selectedId ? (
              <PeriodDetail
                key={selectedId}
                periodId={selectedId}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="hidden md:flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <div className="p-5 rounded-full bg-muted">
                  <CalendarDays className="h-10 w-10 opacity-40" />
                </div>
                <p className="text-sm">{t('Select a period to view details', 'اختر فترة لعرض التفاصيل')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <NewPeriodDialog open={newPeriodOpen} onClose={() => setNewPeriodOpen(false)} />
    </AnimatedPage>
  );
}
