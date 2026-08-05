import { useLanguage } from '@/hooks/use-language';
import {
  useGetAnalyticsExecutiveSummary,
  useGetAnalyticsHeadcount,
  useGetAnalyticsPayrollVariance,
  useGetAnalyticsAttendanceAnomalies,
  useGetAnalyticsLeaveExposure,
  useGetAnalyticsTrainingCompliance,
  useGetAnalyticsDocumentExpiry,
} from '@workspace/api-client-react';
import type {
  GetAnalyticsAttendanceAnomalies200AnomaliesItem,
  GetAnalyticsDocumentExpiry200DocumentsItem,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
  PieChart, Pie,
} from 'recharts';
import {
  Users, UserPlus, Briefcase, Banknote, CalendarOff, Clock,
} from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtNum(n: number | string | undefined | null, decimals = 0) {
  if (n == null) return '—';
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return '—';
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(s: string | undefined | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RiskBadge({ rate }: { rate: number }) {
  if (rate > 25) return <Badge className="bg-red-100 text-red-700 border-red-200">High</Badge>;
  if (rate >= 15) return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Medium</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Low</Badge>;
}

function DaysChip({ days }: { days: number }) {
  if (days < 7) return <span className="text-red-400 font-semibold">{days}d</span>;
  if (days < 30) return <span className="text-amber-400 font-semibold">{days}d</span>;
  return <span className="text-slate-300">{days}d</span>;
}

// ─── KPI Strip ───────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  labelEn: string;
  labelAr: string;
  value: string | number | undefined;
  loading: boolean;
  color: string;
}

function KpiCard({ icon: Icon, labelEn, labelAr, value, loading, color }: KpiCardProps) {
  const { t } = useLanguage();
  return (
    <Card className="bg-slate-800 border-slate-700 flex-1 min-w-[140px]">
      <CardContent className="p-4">
        <div className={`w-8 h-8 rounded flex items-center justify-center mb-3 ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        {loading ? (
          <>
            <Skeleton className="h-7 w-20 bg-slate-700 mb-1" />
            <Skeleton className="h-3 w-28 bg-slate-700" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
            <div className="text-xs text-slate-400 mt-1">{t(labelEn, labelAr)}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function WorkforceAnalytics() {
  const { t } = useLanguage();

  const { data: summary, isLoading: summaryLoading } = useGetAnalyticsExecutiveSummary();
  const { data: headcount = [], isLoading: headcountLoading } = useGetAnalyticsHeadcount({ months: 12 });
  const { data: payrollVar = [], isLoading: payrollVarLoading } = useGetAnalyticsPayrollVariance({ periods: 6 });
  const { data: anomaliesData, isLoading: anomaliesLoading } = useGetAnalyticsAttendanceAnomalies({ threshold: 15 });
  const { data: leaveExposure = [], isLoading: leaveExposureLoading } = useGetAnalyticsLeaveExposure();
  const { data: training = [], isLoading: trainingLoading } = useGetAnalyticsTrainingCompliance();
  const { data: docExpiryData, isLoading: docExpiryLoading } = useGetAnalyticsDocumentExpiry({ days: 30 });

  const anomalies: GetAnalyticsAttendanceAnomalies200AnomaliesItem[] = anomaliesData?.anomalies ?? [];
  const docExpiry: GetAnalyticsDocumentExpiry200DocumentsItem[] = docExpiryData?.documents ?? [];

  const trainingChartData = training.map(tr => ({
    name: tr.departmentNameEn ?? String(tr.departmentId ?? ''),
    value: tr.complianceRate ?? 0,
  }));

  const kpis: KpiCardProps[] = [
    {
      icon: Users, labelEn: 'Total Headcount', labelAr: 'إجمالي القوى العاملة',
      value: fmtNum(summary?.headcount), loading: summaryLoading,
      color: 'bg-[#1e3a5f]',
    },
    {
      icon: UserPlus, labelEn: 'New Hires This Month', labelAr: 'موظفون جدد هذا الشهر',
      value: fmtNum(summary?.newHiresThisMonth), loading: summaryLoading,
      color: 'bg-emerald-600',
    },
    {
      icon: Briefcase, labelEn: 'Open Vacancies', labelAr: 'الوظائف الشاغرة',
      value: fmtNum(summary?.openVacancies), loading: summaryLoading,
      color: 'bg-amber-600',
    },
    {
      icon: Banknote, labelEn: 'Average Salary', labelAr: 'متوسط الراتب',
      value: summary?.avgSalary != null ? `$${fmtNum(summary.avgSalary)}` : undefined,
      loading: summaryLoading,
      color: 'bg-violet-600',
    },
    {
      icon: CalendarOff, labelEn: 'Absence Rate %', labelAr: 'معدل الغياب %',
      value: summary?.absenceRateToday != null ? `${fmtNum(summary.absenceRateToday, 1)}%` : undefined,
      loading: summaryLoading,
      color: 'bg-rose-600',
    },
    {
      icon: Clock, labelEn: 'OT Hours This Month', labelAr: 'ساعات إضافية هذا الشهر',
      value: fmtNum(summary?.overtimeHoursThisMonth), loading: summaryLoading,
      color: 'bg-sky-600',
    },
  ];

  return (
    <AnimatedPage>
      <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {t('Workforce Analytics', 'تحليلات القوى العاملة')}
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              {t('Executive dashboard — live data from all HR modules', 'لوحة القيادة التنفيذية — بيانات مباشرة من جميع وحدات الموارد البشرية')}
            </p>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="flex flex-wrap gap-4">
          {kpis.map(k => <KpiCard key={k.labelEn} {...k} />)}
        </div>

        {/* Row: Headcount Trend + Payroll Variance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Headcount Trend */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">
                {t('Headcount Trend (12 Months)', 'اتجاه القوى العاملة (12 شهراً)')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {headcountLoading ? (
                <Skeleton className="h-48 w-full bg-slate-700" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={headcount} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <defs>
                      <linearGradient id="hcGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="hiresGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="period" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                    <Legend />
                    <Area type="monotone" dataKey="headcount" stroke="#3b82f6" fill="url(#hcGrad)" name={t('Headcount', 'القوى العاملة')} />
                    <Area type="monotone" dataKey="newHires" stroke="#f59e0b" fill="url(#hiresGrad)" name={t('New Hires', 'موظفون جدد')} />
                    <Area type="monotone" dataKey="departures" stroke="#ef4444" fill="none" strokeDasharray="4 2" name={t('Departures', 'المغادرون')} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Payroll Variance */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">
                {t('Payroll Variance (6 Periods)', 'تباين الرواتب (6 فترات)')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payrollVarLoading ? (
                <Skeleton className="h-48 w-full bg-slate-700" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={payrollVar} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="periodCode" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                    <Legend />
                    <Bar dataKey="totalGross" name={t('Total Gross', 'الراتب الإجمالي')} radius={[4, 4, 0, 0]}>
                      {payrollVar.map((entry, i) => (
                        <Cell key={i} fill={Number(entry.variance ?? 0) >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row: Leave Exposure + Training Compliance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leave Exposure */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">
                {t('Leave Exposure by Department', 'مخاطر الإجازات حسب الإدارة')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {leaveExposureLoading ? (
                <Skeleton className="h-48 w-full bg-slate-700" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={leaveExposure} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis dataKey="departmentNameEn" type="category" tick={{ fill: '#94a3b8', fontSize: 11 }} width={70} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                    <Bar dataKey="totalPending" fill="#f59e0b" name={t('Exposure Days', 'أيام المخاطر')} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Training Compliance */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">
                {t('Training Compliance', 'الامتثال للتدريب')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trainingLoading ? (
                <Skeleton className="h-48 w-full bg-slate-700" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={trainingChartData.length > 0 ? trainingChartData : [
                        { name: t('Compliant', 'ملتزم'), value: 0 },
                        { name: t('Non-Compliant', 'غير ملتزم'), value: 0 },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {(trainingChartData.length > 0 ? trainingChartData : []).map((_, i) => (
                        <Cell key={i} fill={['#10b981', '#ef4444', '#f59e0b', '#3b82f6'][i % 4]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Attendance Anomalies Table */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">
              {t('Attendance Anomalies', 'شذوذات الحضور')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">{t('Employee', 'الموظف')}</TableHead>
                  <TableHead className="text-slate-400">{t('Department', 'الإدارة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Absent Days', 'أيام الغياب')}</TableHead>
                  <TableHead className="text-slate-400">{t('Rate %', 'معدل %')}</TableHead>
                  <TableHead className="text-slate-400">{t('Risk', 'المخاطرة')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomaliesLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                  : anomalies.length === 0
                    ? (
                      <TableRow className="border-slate-700">
                        <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                          {t('No anomalies found', 'لا توجد شذوذات')}
                        </TableCell>
                      </TableRow>
                    )
                    : anomalies.map((a, i) => (
                      <TableRow key={i} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="text-white font-medium">{a.employeeName ?? '—'}</TableCell>
                        <TableCell className="text-slate-300">{a.departmentId ?? '—'}</TableCell>
                        <TableCell className="text-slate-300">{fmtNum(a.absentDays)}</TableCell>
                        <TableCell className="text-slate-300">{a.rate != null ? `${fmtNum(a.rate, 1)}%` : '—'}</TableCell>
                        <TableCell><RiskBadge rate={a.rate ?? 0} /></TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Document Expiry Risk Table */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">
              {t('Document Expiry Risk (Next 30 Days)', 'مخاطر انتهاء صلاحية المستندات (30 يوماً)')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">{t('Document', 'المستند')}</TableHead>
                  <TableHead className="text-slate-400">{t('Category', 'الفئة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Expiry Date', 'تاريخ الانتهاء')}</TableHead>
                  <TableHead className="text-slate-400">{t('Days Remaining', 'الأيام المتبقية')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docExpiryLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                  : docExpiry.length === 0
                    ? (
                      <TableRow className="border-slate-700">
                        <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                          {t('No expiring documents', 'لا توجد مستندات منتهية الصلاحية')}
                        </TableCell>
                      </TableRow>
                    )
                    : docExpiry.map((d, i) => {
                      const doc = d as Record<string, unknown>;
                      const daysRemaining = Number(doc.daysRemaining ?? 0);
                      return (
                        <TableRow key={i} className="border-slate-700 hover:bg-slate-700/40">
                          <TableCell className="text-white font-medium">{String(doc.documentName ?? doc.name ?? '—')}</TableCell>
                          <TableCell className="text-slate-300">{String(doc.category ?? '—')}</TableCell>
                          <TableCell className="text-slate-300">{fmtDate(doc.expiryDate as string | undefined)}</TableCell>
                          <TableCell><DaysChip days={Number.isNaN(daysRemaining) ? 0 : daysRemaining} /></TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AnimatedPage>
  );
}
