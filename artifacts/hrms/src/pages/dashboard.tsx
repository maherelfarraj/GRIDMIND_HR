import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import {
  useGetDashboardSummary,
  useGetDashboardActivity,
  useGetDashboardExecutive,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users, CheckCircle2, AlertOctagon, Clock,
  ShieldAlert, Activity, UserPlus, Server, MonitorPlay, Timer, TrendingUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { AnimatedPage } from '@/components/layout/AnimatedPage';

const REFRESH_MS = 60_000;

function heatColor(pct: number): string {
  if (pct >= 90) return 'bg-emerald-500/80 text-white';
  if (pct >= 75) return 'bg-emerald-500/40';
  if (pct >= 50) return 'bg-amber-500/40';
  if (pct > 0) return 'bg-red-500/40';
  return 'bg-muted text-muted-foreground';
}

export default function Dashboard() {
  const { t, lang } = useLanguage();
  const [, navigate] = useLocation();
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';

  const drillToAttendance = (departmentId: number, date: string) =>
    navigate(`/attendance?departmentId=${departmentId}&date=${date}`);
  const drillToOvertime = (departmentId: number) =>
    navigate(`/overtime?departmentId=${departmentId}`);

  const refetch = { query: { refetchInterval: REFRESH_MS } } as any;
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary(refetch);
  const { data: activity, isLoading: loadingActivity } = useGetDashboardActivity(refetch);
  const { data: exec, isLoading: loadingExec } = useGetDashboardExecutive(refetch);

  const dayLabel = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const weekdayLabel = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short' });

  const trendData = useMemo(
    () => (exec?.attendanceTrend ?? []).map((d) => ({ ...d, label: dayLabel(d.date) })),
    [exec, lang]
  );

  const otData = useMemo(
    () => (exec?.otCostByDepartment ?? []).map((d) => ({
      ...d,
      name: lang === 'ar' ? d.departmentNameAr : d.departmentNameEn,
    })),
    [exec, lang]
  );

  const heatDays: string[] = exec?.departmentHeatmap?.[0]?.days.map((d) => d.date) ?? [];

  const coverageData = [{ name: 'coverage', value: exec?.todayCoveragePct ?? 0 }];

  // Today's worst coverage gaps
  const todayGaps = useMemo(() => {
    if (!exec) return [];
    const lastDate = exec.coverageGaps.reduce((m, g) => (g.date > m ? g.date : m), '');
    return exec.coverageGaps.filter((g) => g.date === lastDate).sort((a, b) => b.gap - a.gap);
  }, [exec]);

  const StatCard = ({ title, value, icon: Icon, description, loading, alert = false }: any) => (
    <Card className={alert ? 'border-destructive/50 bg-destructive/5' : 'bg-card'}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Icon className={`w-5 h-5 ${alert ? 'text-destructive' : 'text-muted-foreground'}`} />
        </div>
        <div className="flex flex-col">
          {loading ? (
            <Skeleton className="h-8 w-20 mt-1" />
          ) : (
            <span className={`text-3xl font-bold ${alert ? 'text-destructive' : 'text-foreground'}`}>
              {value}
            </span>
          )}
          {description && <span className="text-xs text-muted-foreground mt-1">{description}</span>}
        </div>
      </CardContent>
    </Card>
  );

  const chartTooltipStyle = {
    backgroundColor: 'hsl(var(--card))',
    borderColor: 'hsl(var(--border))',
    borderRadius: 8,
  };

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {t('Command Center', 'مركز القيادة')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('Live workforce analytics for executive decision-making.', 'تحليلات القوى العاملة المباشرة لدعم القرار التنفيذي.')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-md border border-border w-fit">
          <Activity className="w-4 h-4 text-primary" />
          {t('Auto-refresh: 60s', 'التحديث التلقائي: ٦٠ ثانية')}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('Total Headcount', 'إجمالي الموظفين')}
          value={summary?.totalEmployees}
          icon={Users}
          description={summary && `${summary.activeEmployees} ${t('Active', 'نشط')}`}
          loading={loadingSummary}
        />
        <StatCard
          title={t('Present Today', 'الحاضرون اليوم')}
          value={summary?.presentToday}
          icon={CheckCircle2}
          description={summary && `${summary.absentToday} ${t('Absent', 'غائب')}, ${summary.onLeaveToday} ${t('On Leave', 'في إجازة')}`}
          loading={loadingSummary}
        />
        <StatCard
          title={t('Pending Approvals', 'الموافقات المعلقة')}
          value={summary?.pendingApprovals}
          icon={Clock}
          description={t('Requires executive review', 'يتطلب مراجعة تنفيذية')}
          loading={loadingSummary}
          alert={summary?.pendingApprovals ? summary.pendingApprovals > 5 : false}
        />
        <StatCard
          title={t('Security Alerts', 'التنبيهات الأمنية')}
          value={summary?.openAlerts}
          icon={AlertOctagon}
          description={t('Unacknowledged incidents', 'حوادث غير معترف بها')}
          loading={loadingSummary}
          alert={summary?.openAlerts ? summary.openAlerts > 0 : false}
        />
      </div>

      {/* Attendance trend + today's coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              {t('30-Day Attendance Rate', 'معدل الحضور خلال ٣٠ يومًا')}
            </CardTitle>
            <CardDescription>
              {t('Daily attendance percentage across the organization', 'نسبة الحضور اليومية على مستوى المنظمة')}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {loadingExec ? (
              <Skeleton className="w-full h-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis domain={[0, 100]} unit="%" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(v: any) => [`${v}%`, t('Attendance rate', 'معدل الحضور')]}
                  />
                  <Area type="monotone" dataKey="ratePct" name={t('Attendance rate', 'معدل الحضور')} stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#attGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Today's Shift Coverage", 'تغطية الورديات اليوم')}</CardTitle>
            <CardDescription>{t('Present vs. rostered staff', 'الحاضرون مقابل المجدولين')}</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex flex-col items-center justify-center">
            {loadingExec ? (
              <Skeleton className="w-full h-full" />
            ) : (
              <>
                <div className="relative w-full h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                      cx="50%" cy="50%" innerRadius="70%" outerRadius="100%"
                      data={coverageData} startAngle={90} endAngle={-270}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                      <RadialBar
                        dataKey="value"
                        cornerRadius={10}
                        fill={
                          (exec?.todayCoveragePct ?? 0) >= 85
                            ? 'hsl(var(--primary))'
                            : (exec?.todayCoveragePct ?? 0) >= 60
                              ? '#f59e0b'
                              : '#ef4444'
                        }
                        background={{ fill: 'hsl(var(--secondary))' }}
                      />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-4xl font-bold text-foreground">
                      {(exec?.todayCoveragePct ?? 0).toLocaleString(locale)}%
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">{t('Coverage', 'التغطية')}</span>
                  </div>
                </div>
                {todayGaps.length > 0 && (
                  <div className="w-full mt-2 space-y-1 text-xs">
                    {todayGaps.slice(0, 3).map((g) => (
                      <div key={`${g.date}-${g.shiftId}`} className="flex justify-between text-muted-foreground">
                        <span>{lang === 'ar' ? g.shiftNameAr : g.shiftNameEn} ({g.shiftCode})</span>
                        <span className={g.gap > 0 ? 'text-amber-500 font-medium' : 'text-emerald-500'}>
                          {g.worked}/{g.scheduled}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* OT cost + latecomers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('Overtime Cost Index by Department', 'مؤشر تكلفة العمل الإضافي حسب القسم')}</CardTitle>
            <CardDescription>
              {t('OT minutes × pay multiplier, last 30 days', 'دقائق العمل الإضافي × معامل الأجر، آخر ٣٠ يومًا')}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {loadingExec ? (
              <Skeleton className="w-full h-full" />
            ) : otData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={otData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'hsl(var(--accent))' }} contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ paddingTop: '8px' }} />
                  <Bar dataKey="otMinutes" name={t('OT minutes', 'دقائق إضافية')} fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} maxBarSize={32} className="cursor-pointer" onClick={(d: any) => d?.departmentId && drillToOvertime(d.departmentId)} />
                  <Bar dataKey="costIndex" name={t('Cost index', 'مؤشر التكلفة')} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={32} className="cursor-pointer" onClick={(d: any) => d?.departmentId && drillToOvertime(d.departmentId)} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {t('No overtime recorded', 'لا يوجد عمل إضافي مسجل')}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-500" />
              {t('Late Arrivals — This Week', 'المتأخرون — هذا الأسبوع')}
            </CardTitle>
            <CardDescription>{t('Top 5 by total late minutes', 'أعلى ٥ حسب إجمالي دقائق التأخير')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingExec ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : exec && exec.topLatecomers.length > 0 ? (
              <div className="space-y-3">
                {exec.topLatecomers.map((e, idx) => (
                  <div key={e.employeeId} className="flex items-center gap-3 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                    <div className="w-7 h-7 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center text-sm font-bold shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {lang === 'ar' ? e.nameAr : e.nameEn}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.occurrences} {t('occurrences', 'مرات')}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                      {e.totalLateMinutes} {t('min', 'د')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                {t('No late arrivals this week', 'لا يوجد متأخرون هذا الأسبوع')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Heat map */}
      <Card>
        <CardHeader>
          <CardTitle>{t('Department Attendance Heat Map', 'خريطة حرارية لحضور الأقسام')}</CardTitle>
          <CardDescription>
            {t('Present vs. rostered per department, last 7 days', 'الحاضرون مقابل المجدولين لكل قسم، آخر ٧ أيام')}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loadingExec ? (
            <Skeleton className="h-64 w-full" />
          ) : exec && exec.departmentHeatmap.length > 0 ? (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr>
                  <th className="text-start py-2 pe-3 font-medium text-muted-foreground">
                    {t('Department', 'القسم')}
                  </th>
                  <th className="text-center py-2 px-1 font-medium text-muted-foreground">
                    {t('HC', 'العدد')}
                  </th>
                  {heatDays.map((d) => (
                    <th key={d} className="text-center py-2 px-1 font-medium text-muted-foreground">
                      <div>{weekdayLabel(d)}</div>
                      <div className="text-[10px] font-normal">{dayLabel(d)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exec.departmentHeatmap.map((dept) => (
                  <tr key={dept.departmentId} className="border-t border-border">
                    <td className="py-1.5 pe-3 font-medium text-foreground whitespace-nowrap">
                      {lang === 'ar' ? dept.departmentNameAr : dept.departmentNameEn}
                    </td>
                    <td className="text-center py-1.5 px-1 text-muted-foreground">{dept.headcount}</td>
                    {dept.days.map((day) => (
                      <td key={day.date} className="py-1.5 px-1">
                        <button
                          type="button"
                          onClick={() => drillToAttendance(dept.departmentId, day.date)}
                          className={`w-full rounded-md text-center py-1.5 text-xs font-medium cursor-pointer transition-transform hover:scale-105 hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-primary outline-none ${heatColor(day.ratePct)}`}
                          title={`${day.present}/${day.rostered} ${t('present', 'حاضر')} — ${t('Click to view details', 'انقر لعرض التفاصيل')}`}
                        >
                          {day.rostered > 0 ? `${Math.round(day.ratePct)}%` : '—'}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              {t('No data available', 'لا توجد بيانات متاحة')}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity + secondary stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('Activity Stream', 'سجل النشاط')}</CardTitle>
            <CardDescription>{t('Recent system events', 'أحداث النظام الأخيرة')}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto max-h-[380px]">
            {loadingActivity ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-8 h-8 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-5">
                {activity.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0">
                      {item.type === 'alert' && <ShieldAlert className="w-4 h-4 text-destructive" />}
                      {item.type === 'approval' && <CheckCircle2 className="w-4 h-4 text-primary" />}
                      {item.type === 'employee' && <UserPlus className="w-4 h-4 text-muted-foreground" />}
                      {item.type === 'device' && <MonitorPlay className="w-4 h-4 text-muted-foreground" />}
                      {!['alert', 'approval', 'employee', 'device'].includes(item.type) && <Server className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div>
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{item.actorName}</span>{' '}
                        <span className="text-muted-foreground">
                          {lang === 'en' ? item.description : item.descriptionAr}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(item.createdAt).toLocaleString(locale, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                {t('No recent activity', 'لا يوجد نشاط أخير')}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <StatCard
            title={t('New Hires This Month', 'تعيينات جديدة هذا الشهر')}
            value={summary?.newHiresThisMonth}
            icon={UserPlus}
            loading={loadingSummary}
          />
          <StatCard
            title={t('Device Health', 'حالة الأجهزة')}
            value={summary ? `${summary.onlineDevices} / ${summary.totalDevices}` : ''}
            icon={Server}
            description={t('Online devices', 'الأجهزة المتصلة')}
            loading={loadingSummary}
            alert={summary ? summary.onlineDevices < summary.totalDevices : false}
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground text-end">
        {t('Last refreshed', 'آخر تحديث')}:{' '}
        {exec ? new Date(exec.generatedAt).toLocaleTimeString(locale) : '—'}
      </div>
    </AnimatedPage>
  );
}
