import { useParams, useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { useGetPayslip } from '@workspace/api-client-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { cn } from '@/lib/utils';
import {
  Shield,
  Printer,
  ArrowLeft,
  AlertTriangle,
  Calendar,
  User,
  Building2,
  BadgeCheck,
  Clock,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(val: string | number | undefined | null, currency = 'SAR'): string {
  const num = parseFloat(String(val ?? '0'));
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(val: string | number | undefined | null): string {
  const num = parseFloat(String(val ?? '0'));
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {icon && <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>}
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium break-words">{value ?? '—'}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollPayslip() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { t, lang } = useLanguage();

  const runId = Number(params.id);
  const { data: payslip, isLoading, isError } = useGetPayslip(runId);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <AnimatedPage>
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AnimatedPage>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (isError || !payslip) {
    return (
      <AnimatedPage>
        <div className="max-w-3xl mx-auto p-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t('Payslip not found or failed to load.', 'قسيمة الراتب غير موجودة أو فشل التحميل.')}
            </AlertDescription>
          </Alert>
          <Button variant="ghost" className="mt-4" onClick={() => navigate('/payroll')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('Back to Payroll', 'العودة إلى الرواتب')}
          </Button>
        </div>
      </AnimatedPage>
    );
  }

  const { employee, period, summary, earnings, deductions, hasException, exceptionNote, calculatedAt } = payslip;
  const currency = summary.currency || 'SAR';

  const totalEarnings = parseFloat(summary.totalEarnings ?? summary.grossSalary);
  const totalDeductions = parseFloat(summary.totalDeductions);
  const netSalary = parseFloat(summary.netSalary);

  return (
    <AnimatedPage>
      {/* ── Print styles injected via a style tag in JSX ── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #payslip-printable, #payslip-printable * { visibility: visible !important; }
          #payslip-printable { position: absolute !important; inset: 0 !important; }
          .no-print { display: none !important; }
          @page { margin: 1cm; }
        }
      `}</style>

      {/* ── Action bar (hidden on print) ── */}
      <div className="no-print flex items-center justify-between px-6 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <Button variant="ghost" size="sm" onClick={() => navigate('/payroll')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('Back to Payroll', 'العودة إلى الرواتب')}
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          {t('Print', 'طباعة')}
        </Button>
      </div>

      {/* ── Printable card ── */}
      <div id="payslip-printable" className="max-w-3xl mx-auto p-4 sm:p-6 pb-12">
        <div className="border rounded-xl overflow-hidden shadow-sm bg-white dark:bg-card print:shadow-none print:border-gray-300">

          {/* ══ HEADER ══════════════════════════════════════════════════════ */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-5 print:bg-slate-800">
            <div className="flex items-center justify-between flex-wrap gap-4">
              {/* Company */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-lg">
                  <Shield className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-bold text-lg leading-tight">HRMS Enterprise</p>
                  <p className="text-slate-300 text-sm">Human Resources Management System</p>
                </div>
              </div>
              {/* Title */}
              <div className="text-right">
                <p className="text-2xl font-black tracking-widest">PAYSLIP</p>
                <p className="text-slate-300 text-base font-semibold tracking-wide">قسيمة الراتب</p>
              </div>
            </div>
          </div>

          {/* ══ EMPLOYEE + PERIOD INFO ═══════════════════════════════════════ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x border-b">
            {/* Employee info */}
            <div className="p-5 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {t('Employee Information', 'بيانات الموظف')}
              </p>
              <InfoRow label={t('Full Name (EN)', 'الاسم الكامل (إنجليزي)')} value={employee.fullNameEn} />
              <InfoRow label={t('الاسم الكامل (AR)', 'Full Name (AR)')} value={employee.fullNameAr} />
              <InfoRow
                icon={<BadgeCheck className="h-3.5 w-3.5" />}
                label={t('Employee #', 'رقم الموظف')}
                value={employee.employeeNumber}
              />
              <InfoRow
                label={t('Job Title', 'المسمى الوظيفي')}
                value={lang === 'ar' ? employee.jobTitleAr : employee.jobTitleEn}
              />
              <InfoRow
                icon={<Building2 className="h-3.5 w-3.5" />}
                label={t('Department', 'الإدارة')}
                value={lang === 'ar' ? employee.departmentNameAr : employee.departmentNameEn}
              />
              <InfoRow label={t('National ID', 'الهوية الوطنية')} value={employee.nationalId} />
              {employee.grade && (
                <InfoRow label={t('Grade', 'الدرجة')} value={employee.grade} />
              )}
            </div>

            {/* Period info */}
            <div className="p-5 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {t('Period Information', 'بيانات الفترة')}
              </p>
              <InfoRow label={t('Period Name', 'اسم الفترة')} value={lang === 'ar' ? period.nameAr : period.nameEn} />
              <InfoRow label={t('Period Code', 'رمز الفترة')} value={period.periodCode} />
              <InfoRow
                label={t('Pay Period', 'فترة الصرف')}
                value={`${period.startDate} → ${period.endDate}`}
              />
              <InfoRow label={t('Pay Date', 'تاريخ الصرف')} value={period.payDate} />
              {calculatedAt && (
                <InfoRow
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label={t('Calculated At', 'تاريخ الحساب')}
                  value={new Date(calculatedAt).toLocaleString()}
                />
              )}
              <InfoRow label={t('Currency', 'العملة')} value={currency} />
            </div>
          </div>

          {/* ══ EARNINGS ════════════════════════════════════════════════════ */}
          <div className="p-5 border-b">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-4 bg-emerald-500 rounded-sm" />
              {t('Earnings', 'المستحقات')}
              <span className="text-muted-foreground font-normal"> / المستحقات</span>
            </h3>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">{t('Component (EN)', 'المكوّن (إنجليزي)')}</TableHead>
                  <TableHead className="text-xs">{t('Component (AR)', 'المكوّن (عربي)')}</TableHead>
                  <TableHead className="text-xs text-right">{t('Amount', 'المبلغ')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {earnings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-4">
                      {t('No earnings items', 'لا توجد مستحقات')}
                    </TableCell>
                  </TableRow>
                ) : (
                  earnings.map(line => (
                    <TableRow key={line.id}>
                      <TableCell className="text-sm">{line.nameEn}</TableCell>
                      <TableCell className="text-sm text-right" dir="rtl">{line.nameAr}</TableCell>
                      <TableCell className="text-sm text-right font-mono">
                        {fmtNum(line.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {/* Subtotal */}
                <TableRow className="border-t-2 bg-emerald-50/60 dark:bg-emerald-950/20 font-bold">
                  <TableCell className="text-sm font-bold">{t('Total Earnings', 'إجمالي المستحقات')}</TableCell>
                  <TableCell className="text-sm text-right" dir="rtl">إجمالي المستحقات</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {fmtNum(totalEarnings)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* ══ DEDUCTIONS ══════════════════════════════════════════════════ */}
          <div className="p-5 border-b">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-4 bg-red-500 rounded-sm" />
              {t('Deductions', 'الاستقطاعات')}
              <span className="text-muted-foreground font-normal"> / الاستقطاعات</span>
            </h3>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">{t('Component (EN)', 'المكوّن (إنجليزي)')}</TableHead>
                  <TableHead className="text-xs">{t('Component (AR)', 'المكوّن (عربي)')}</TableHead>
                  <TableHead className="text-xs text-right">{t('Amount', 'المبلغ')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deductions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-4">
                      {t('No deductions', 'لا توجد استقطاعات')}
                    </TableCell>
                  </TableRow>
                ) : (
                  deductions.map(line => (
                    <TableRow key={line.id}>
                      <TableCell className="text-sm">{line.nameEn}</TableCell>
                      <TableCell className="text-sm text-right" dir="rtl">{line.nameAr}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-red-600">
                        {fmtNum(line.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {/* Subtotal */}
                <TableRow className="border-t-2 bg-red-50/60 dark:bg-red-950/20 font-bold">
                  <TableCell className="text-sm font-bold">{t('Total Deductions', 'إجمالي الاستقطاعات')}</TableCell>
                  <TableCell className="text-sm text-right" dir="rtl">إجمالي الاستقطاعات</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold text-red-700 dark:text-red-400">
                    {fmtNum(totalDeductions)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* ══ NET SALARY BOX ══════════════════════════════════════════════ */}
          <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-b print:bg-white">
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                <Separator className="w-8" />
                <span>NET SALARY</span>
                <span className="text-muted-foreground">·</span>
                <span>صافي الراتب</span>
                <Separator className="w-8" />
              </div>
              <p className="text-4xl font-black tracking-tight mt-2 text-slate-900 dark:text-slate-50">
                {currency}{' '}
                <span>
                  {netSalary.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </p>
              <Badge className="mt-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent text-xs">
                {t('Net after deductions', 'الصافي بعد الاستقطاعات')}
              </Badge>
            </div>
          </div>

          {/* ══ ATTENDANCE FOOTER ═══════════════════════════════════════════ */}
          <div className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {t('Attendance Summary', 'ملخص الحضور')}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: t('Working Days', 'أيام العمل'),
                  value: summary.workingDays,
                  unit: t('days', 'يوم'),
                  cls: 'text-slate-700 dark:text-slate-300',
                },
                {
                  label: t('Present Days', 'أيام الحضور'),
                  value: summary.presentDays,
                  unit: t('days', 'يوم'),
                  cls: 'text-emerald-700 dark:text-emerald-400',
                },
                {
                  label: t('OT Hours', 'ساعات إضافية'),
                  value: parseFloat(summary.overtimeHours ?? '0').toFixed(1),
                  unit: t('hrs', 'ساعة'),
                  cls: 'text-amber-700 dark:text-amber-400',
                },
                {
                  label: t('OT Pay', 'أجر إضافي'),
                  value: `${currency} ${fmtNum(summary.overtimePay)}`,
                  unit: '',
                  cls: 'text-violet-700 dark:text-violet-400',
                },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                  <p className={cn('text-lg font-bold leading-tight', item.cls)}>
                    {item.value}
                    {item.unit && <span className="text-xs font-normal ml-1 text-muted-foreground">{item.unit}</span>}
                  </p>
                </div>
              ))}
            </div>

            {/* Exception warning */}
            {hasException && (
              <Alert className="mt-4 border-amber-400/40 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-amber-700 dark:text-amber-400">
                  <span className="font-semibold">{t('Exception: ', 'استثناء: ')}</span>
                  {exceptionNote ?? t('This payslip has a flagged exception requiring review.', 'تحتوي قسيمة الراتب هذه على استثناء يتطلب مراجعة.')}
                </AlertDescription>
              </Alert>
            )}

            {/* Print/Back buttons — hidden on print */}
            <div className="no-print flex items-center justify-end gap-3 mt-6 pt-4 border-t">
              <Button variant="outline" onClick={() => navigate('/payroll')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('Back', 'رجوع')}
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-2" />
                {t('Print', 'طباعة')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AnimatedPage>
  );
}
