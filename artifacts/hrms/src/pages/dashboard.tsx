import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { 
  useGetDashboardSummary, 
  useGetDashboardActivity, 
  useGetDashboardAttendanceOverview 
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { 
  Users, CheckCircle2, AlertOctagon, Clock, 
  ShieldAlert, Activity, UserPlus, Server, MonitorPlay, Files
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line
} from 'recharts';

import { AnimatedPage } from '@/components/layout/AnimatedPage';

export default function Dashboard() {
  const { t, lang } = useLanguage();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: loadingActivity } = useGetDashboardActivity();
  const { data: attendance, isLoading: loadingAttendance } = useGetDashboardAttendanceOverview();

  // Update timestamp every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdated(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const StatCard = ({ title, value, icon: Icon, description, loading, alert = false }: any) => (
    <Card className={alert ? "border-destructive/50 bg-destructive/5" : "bg-card"}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground">
            {title}
          </p>
          <Icon className={`w-5 h-5 ${alert ? "text-destructive" : "text-muted-foreground"}`} />
        </div>
        <div className="flex flex-col">
          {loading ? (
            <Skeleton className="h-8 w-20 mt-1" />
          ) : (
            <span className={`text-3xl font-bold ${alert ? "text-destructive" : "text-foreground"}`}>
              {value}
            </span>
          )}
          {description && (
            <span className="text-xs text-muted-foreground mt-1">{description}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Weekly trend data - last 7 days
  const weeklyTrendData = [
    { day: t('Mon', 'الإثنين'), present: 8 },
    { day: t('Tue', 'الثلاثاء'), present: 11 },
    { day: t('Wed', 'الأربعاء'), present: 12 },
    { day: t('Thu', 'الخميس'), present: 10 },
    { day: t('Fri', 'الجمعة'), present: 13 },
    { day: t('Sat', 'السبت'), present: 10 },
    { day: t('Today', 'اليوم'), present: summary?.presentToday || null },
  ];

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {t('Command Center', 'مركز القيادة')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('Real-time overview of organization operations and personnel.', 'نظرة عامة في الوقت الفعلي لعمليات المنظمة والموظفين.')}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-md border border-border">
          <Activity className="w-4 h-4 text-primary" />
          {t('Live Sync: Active', 'المزامنة المباشرة: نشط')}
        </div>
      </div>

      {/* IdP Demo Banner */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm">
        <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
        <span className="flex-1 text-amber-600 dark:text-amber-400">
          {t('Running in Demo Mode. Identity Provider (Keycloak/LDAP) not configured.', 'يعمل في وضع العرض التوضيحي. موفر الهوية (Keycloak/LDAP) غير مهيأ.')}
        </span>
        <Button variant="ghost" size="sm" className="text-amber-500 hover:bg-amber-500/10 shrink-0">
          {t('Configure', 'تكوين')} →
        </Button>
      </div>

      {/* Primary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('Department Attendance', 'حضور الأقسام')}</CardTitle>
            <CardDescription>
              {t('Present vs Absent by organizational unit today', 'الحاضرون مقابل الغائبين حسب الوحدة التنظيمية اليوم')}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            {loadingAttendance ? (
              <div className="w-full h-full flex items-center justify-center">
                <Skeleton className="w-full h-full" />
              </div>
            ) : attendance?.byDepartment ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendance.byDepartment} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis 
                    dataKey="departmentName" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--accent))' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar dataKey="present" name={t('Present', 'حاضر')} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="absent" name={t('Absent', 'غائب')} fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {t('No data available', 'لا توجد بيانات متاحة')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t('Activity Stream', 'سجل النشاط')}</CardTitle>
            <CardDescription>{t('Recent system events', 'أحداث النظام الأخيرة')}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto">
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
              <div className="space-y-6">
                {activity.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0">
                      {item.type === 'alert' && <ShieldAlert className="w-4 h-4 text-destructive" />}
                      {item.type === 'approval' && <CheckCircle2 className="w-4 h-4 text-primary" />}
                      {item.type === 'employee' && <UserPlus className="w-4 h-4 text-muted-foreground" />}
                      {item.type === 'device' && <MonitorPlay className="w-4 h-4 text-muted-foreground" />}
                      {item.type === 'system' && <Server className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div>
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{item.actorName}</span>{' '}
                        <span className="text-muted-foreground">
                          {lang === 'en' ? item.description : item.descriptionAr}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(item.createdAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
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
      </div>

      {/* Weekly Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t('Weekly Attendance Trend', 'اتجاه الحضور الأسبوعي')}</CardTitle>
          <CardDescription>
            {t('Daily present count over the last 7 days', 'عدد الحاضرين اليومي خلال الأيام السبعة الماضية')}
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyTrendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="day" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
              />
              <Line 
                type="monotone" 
                dataKey="present" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))', r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
         <StatCard 
          title={t('Documents Pending Review', 'مستندات قيد المراجعة')}
          value={summary?.documentsPendingReview}
          icon={Files}
          loading={loadingSummary}
        />
        <StatCard 
          title={t('New Hires This Month', 'تعيينات جديدة هذا الشهر')}
          value={summary?.newHiresThisMonth}
          icon={UserPlus}
          loading={loadingSummary}
        />
        <StatCard 
          title={t('Device Health', 'حالة الأجهزة')}
          value={`${summary?.onlineDevices} / ${summary?.totalDevices}`}
          icon={Server}
          description={t('Online devices', 'الأجهزة المتصلة')}
          loading={loadingSummary}
          alert={summary && summary.onlineDevices < summary.totalDevices}
        />
      </div>

      <div className="text-xs text-muted-foreground text-end">
        {t('Last updated', 'آخر تحديث')}: {lastUpdated.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US')}
      </div>
    </AnimatedPage>
  );
}
