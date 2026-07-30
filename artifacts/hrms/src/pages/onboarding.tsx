import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployeeOnboarding,
  useListOnboardingTasks,
  getListOnboardingTasksQueryKey,
  useUpdateOnboardingTask,
  useListOnboardingTemplates,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ClipboardList, ChevronDown, ChevronRight, CheckCircle, Circle, Clock } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function CircularProgress({ pct }: { pct: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="70" height="70" viewBox="0 0 70 70">
      <circle cx="35" cy="35" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
      <circle
        cx="35" cy="35" r={r} fill="none" stroke="currentColor" strokeWidth="6"
        className={pct >= 80 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500'}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 35 35)"
      />
      <text x="35" y="39" textAnchor="middle" fontSize="13" fontWeight="bold" fill="currentColor" className="text-foreground">
        {pct}%
      </text>
    </svg>
  );
}

function OnboardingCard({ record }: { record: any }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { data: tasksData } = useListOnboardingTasks(record.id, { query: { enabled: expanded, queryKey: getListOnboardingTasksQueryKey(record.id) } });
  const tasks = tasksData?.data ?? [];
  const { mutate: updateTask } = useUpdateOnboardingTask();

  function toggleTask(taskId: number, currentStatus: string) {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    updateTask({ id: record.id, taskId, data: { status: newStatus, completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/onboarding-tasks'] }),
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-4">
        <div className="flex items-center gap-4">
          <CircularProgress pct={record.completionPercentage ?? 0} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{t('Employee', 'الموظف')} #{record.employeeId}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Started', 'بدأ')}: {fmtDate(record.startDate)}</p>
            <p className="text-xs text-muted-foreground">{t('Expected End', 'النهاية المتوقعة')}: {fmtDate(record.expectedEndDate)}</p>
            <Badge variant="outline" className={cn('mt-1 text-xs capitalize',
              record.status === 'completed' ? 'border-emerald-400 text-emerald-600' :
                record.status === 'in_progress' ? 'border-blue-400 text-blue-600' :
                  'border-amber-400 text-amber-600'
            )}>
              {record.status.replace('_', ' ')}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
        </div>

        {expanded && (
          <div className="mt-4 border-t pt-3 space-y-2">
            {tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">{t('No tasks', 'لا توجد مهام')}</p>
            ) : tasks.map(task => (
              <div key={task.id} className="flex items-center gap-3">
                <button onClick={() => toggleTask(task.id, task.status)}>
                  {task.status === 'completed'
                    ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                    : <Circle className="w-4 h-4 text-muted-foreground" />}
                </button>
                <div className="flex-1">
                  <p className={cn('text-sm', task.status === 'completed' && 'line-through text-muted-foreground')}>{task.taskName}</p>
                  {task.category && <p className="text-xs text-muted-foreground">{task.category}</p>}
                </div>
                {task.dueDate && <p className="text-xs text-muted-foreground">{fmtDate(task.dueDate)}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Onboarding() {
  const { t } = useLanguage();
  const { data: onboardingData, isLoading } = useListEmployeeOnboarding({ limit: 100 } as any);
  const { data: templatesData, isLoading: templatesLoading } = useListOnboardingTemplates({ limit: 50 } as any);

  const records = onboardingData?.data ?? [];
  const templates = templatesData?.data ?? [];

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-amber-500" />
            {t('Onboarding', 'الاستقطاب')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Track employee onboarding progress and templates', 'تتبع تقدم الاستقطاب والقوالب')}</p>
        </div>

        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">{t('Active Onboarding', 'الاستقطاب النشط')} ({records.length})</TabsTrigger>
            <TabsTrigger value="templates">{t('Templates', 'القوالب')} ({templates.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : records.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No active onboarding records', 'لا توجد سجلات استقطاب نشطة')}</div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {records.map(r => <OnboardingCard key={r.id} record={r} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            {templatesLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : templates.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No templates found', 'لا توجد قوالب')}</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {templates.map(tmpl => (
                  <Card key={tmpl.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{tmpl.name}</CardTitle>
                        <Badge variant="outline" className={cn('text-xs', tmpl.isActive ? 'border-emerald-400 text-emerald-600' : 'border-gray-400 text-gray-500')}>
                          {tmpl.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {tmpl.description && <p className="text-sm text-muted-foreground mb-3">{tmpl.description}</p>}
                      {tmpl.items && tmpl.items.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground mb-2">{t('Items', 'البنود')} ({tmpl.items.length})</p>
                          {tmpl.items.map(item => (
                            <div key={item.id} className="flex items-center gap-2 text-sm">
                              <Clock className="w-3 h-3 text-amber-500 flex-shrink-0" />
                              <span>{item.taskName}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {t('Day', 'اليوم')} {item.daysFromStart}
                                {item.isRequired && <span className="text-red-500 ml-1">*</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
