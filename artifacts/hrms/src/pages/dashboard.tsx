import { useLanguage } from '@/hooks/use-language';
import { 
  useGetDashboardSummary, 
  useGetDashboardActivity, 
  useGetDashboardAttendanceOverview 
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  Legend
} from 'recharts';

import { AnimatedPage } from '@/components/layout/AnimatedPage';

export default function Dashboard() {
  const { t, lang } = useLanguage();
  
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: loadingActivity } = useGetDashboardActivity();
  const { data: attendance, isLoading: loadingAttendance } = useGetDashboardAttendanceOverview();

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
    </AnimatedPage>
  );
}
