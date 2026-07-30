import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListSuccessionPools,
  useListSuccessionCandidates,
  getListSuccessionCandidatesQueryKey,
  useListDevelopmentPlans,
  useListDevelopmentActivities,
  getListDevelopmentActivitiesQueryKey,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { TrendingUp, ChevronDown, ChevronRight, Star, AlertTriangle } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ReadinessBadge({ level }: { level: string }) {
  const cls =
    level === 'ready_now' ? 'border-emerald-400 text-emerald-600' :
      level === 'ready_1_2_years' ? 'border-blue-400 text-blue-600' :
        level === 'ready_3_5_years' ? 'border-amber-400 text-amber-600' :
          'border-gray-400 text-gray-500';
  const label = level.replace(/_/g, ' ');
  return <Badge variant="outline" className={cn('capitalize text-xs', cls)}>{label}</Badge>;
}

function TalentStars({ score }: { score?: number | null }) {
  if (!score) return <span className="text-muted-foreground text-xs">—</span>;
  const stars = Math.round((score / 100) * 5);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={cn('w-3 h-3', i <= stars ? 'text-amber-400 fill-amber-400' : 'text-muted')} />
      ))}
    </div>
  );
}

// ─── Pool Panel ────────────────────────────────────────────────────────────────
function PoolPanel({ pool }: { pool: any }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const candParams = { poolId: pool.id } as any;
  const { data: candidatesData } = useListSuccessionCandidates(candParams, { query: { enabled: expanded, queryKey: getListSuccessionCandidatesQueryKey(candParams) } });
  const candidates = candidatesData?.data ?? [];

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div>
            <h3 className="font-semibold">{pool.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{pool.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={cn('text-xs',
              pool.isActive ? 'border-emerald-400 text-emerald-600' : 'border-gray-400 text-gray-500'
            )}>
              {pool.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
            </Badge>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 border-t pt-3">
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('No candidates', 'لا يوجد مرشحون')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground text-xs border-b">
                    <th className="pb-2">{t('Employee', 'الموظف')}</th>
                    <th className="pb-2">{t('Readiness', 'الاستعداد')}</th>
                    <th className="pb-2">{t('Score', 'الدرجة')}</th>
                    <th className="pb-2">{t('Target', 'الهدف')}</th>
                    <th className="pb-2">{t('Status', 'الحالة')}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2">#{c.employeeId}</td>
                      <td className="py-2"><ReadinessBadge level={c.readinessLevel} /></td>
                      <td className="py-2"><TalentStars score={c.assessmentScore} /></td>
                      <td className="py-2 text-xs text-muted-foreground">{fmtDate(c.targetDate)}</td>
                      <td className="py-2">
                        <Badge variant="outline" className="capitalize text-xs">{c.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Dev Plan Panel ────────────────────────────────────────────────────────────
function DevPlanPanel({ plan }: { plan: any }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const { data: activitiesData } = useListDevelopmentActivities(plan.id, { query: { enabled: expanded, queryKey: getListDevelopmentActivitiesQueryKey(plan.id) } });
  const activities = activitiesData?.data ?? [];

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div>
            <h3 className="font-semibold">{plan.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Employee', 'الموظف')} #{plan.employeeId} · {fmtDate(plan.startDate)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t('Progress', 'التقدم')}</p>
              <p className="text-sm font-bold text-amber-500">{plan.completionPercentage ?? 0}%</p>
            </div>
            <Badge variant="outline" className={cn('text-xs capitalize',
              plan.status === 'completed' ? 'border-emerald-400 text-emerald-600' :
                plan.status === 'in_progress' ? 'border-blue-400 text-blue-600' :
                  'border-amber-400 text-amber-600'
            )}>
              {plan.status?.replace('_', ' ')}
            </Badge>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 border-t pt-3 space-y-2">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('No activities', 'لا توجد أنشطة')}</p>
            ) : activities.map(a => (
              <div key={a.id} className="flex items-center gap-3 p-2 rounded bg-muted/30">
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                  a.status === 'completed' ? 'bg-emerald-500' :
                    a.status === 'in_progress' ? 'bg-blue-500' :
                      'bg-muted-foreground'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.activityName}</p>
                  {a.activityType && <p className="text-xs text-muted-foreground capitalize">{a.activityType}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <Badge variant="outline" className="capitalize text-xs">{a.status}</Badge>
                  {a.dueDate && <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(a.dueDate)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function Succession() {
  const { t } = useLanguage();

  const { data: poolsData, isLoading: poolsLoading } = useListSuccessionPools({ limit: 50 } as any);
  const { data: plansData, isLoading: plansLoading } = useListDevelopmentPlans({ limit: 100 } as any);

  const pools = poolsData?.data ?? [];
  const plans = plansData?.data ?? [];

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-amber-500" />
            {t('Succession Planning', 'التخطيط الوظيفي')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Talent pools and individual development plans', 'مجموعات المواهب وخطط التطوير الفردية')}</p>
        </div>

        <Tabs defaultValue="pools">
          <TabsList>
            <TabsTrigger value="pools">{t('Talent Pools', 'مجموعات المواهب')} ({pools.length})</TabsTrigger>
            <TabsTrigger value="plans">{t('Development Plans', 'خطط التطوير')} ({plans.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pools" className="mt-4 space-y-3">
            {poolsLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : pools.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No talent pools found', 'لا توجد مجموعات مواهب')}</div>
            ) : pools.map(p => <PoolPanel key={p.id} pool={p} />)}
          </TabsContent>

          <TabsContent value="plans" className="mt-4 space-y-3">
            {plansLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : plans.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No development plans found', 'لا توجد خطط تطوير')}</div>
            ) : plans.map(p => <DevPlanPanel key={p.id} plan={p} />)}
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
