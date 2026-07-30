import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListAppraisalCycles,
  useListAppraisalRecords,
  getListAppraisalRecordsQueryKey,
  useListGoalCycles,
  useListEmployeeGoals,
  useListCalibrationSessions,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Target, ChevronDown, ChevronRight, Users, BarChart2 } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RatingBadge({ rating }: { rating?: number | null }) {
  if (!rating) return <span className="text-muted-foreground text-xs">—</span>;
  let label = '';
  let cls = '';
  if (rating >= 4.5) { label = 'A'; cls = 'bg-yellow-400 text-yellow-900'; }
  else if (rating >= 4.0) { label = 'B+'; cls = 'bg-emerald-500 text-white'; }
  else if (rating >= 3.0) { label = 'B'; cls = 'bg-blue-500 text-white'; }
  else if (rating >= 2.0) { label = 'C'; cls = 'bg-amber-500 text-white'; }
  else { label = 'D'; cls = 'bg-red-500 text-white'; }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold', cls)}>
      {label} <span className="opacity-80">({rating.toFixed(1)})</span>
    </span>
  );
}

// ─── Cycle Panel ───────────────────────────────────────────────────────────────
function CyclePanel({ cycle }: { cycle: any }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const cycleParams = { cycleId: cycle.id } as any;
  const { data: recordsData } = useListAppraisalRecords(cycleParams, { query: { enabled: expanded, queryKey: getListAppraisalRecordsQueryKey(cycleParams) } });
  const records = recordsData?.data ?? [];

  return (
    <Card>
      <CardContent className="pt-4">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div>
            <h3 className="font-semibold">{cycle.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(cycle.reviewPeriodStart)} → {fmtDate(cycle.reviewPeriodEnd)}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={cn('capitalize text-xs',
              cycle.status === 'active' ? 'border-emerald-400 text-emerald-600' :
                cycle.status === 'closed' ? 'border-gray-400 text-gray-500' :
                  'border-amber-400 text-amber-600'
            )}>
              {cycle.status}
            </Badge>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 border-t pt-3">
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('No records in this cycle', 'لا توجد سجلات في هذه الدورة')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Self Rating', 'تقييم ذاتي')}</TableHead>
                    <TableHead>{t('Manager Rating', 'تقييم المدير')}</TableHead>
                    <TableHead>{t('Final Rating', 'التقييم النهائي')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>#{r.employeeId}</TableCell>
                      <TableCell><RatingBadge rating={r.selfRating} /></TableCell>
                      <TableCell><RatingBadge rating={r.managerRating} /></TableCell>
                      <TableCell><RatingBadge rating={r.finalRating} /></TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function Performance() {
  const { t } = useLanguage();
  const [selectedGoalCycle, setSelectedGoalCycle] = useState('');

  const { data: cyclesData, isLoading: cyclesLoading } = useListAppraisalCycles({ limit: 50 } as any);
  const { data: goalCyclesData } = useListGoalCycles({ limit: 50 } as any);
  const { data: goalsData } = useListEmployeeGoals({ cycleId: selectedGoalCycle ? parseInt(selectedGoalCycle) : undefined, limit: 100 } as any);
  const { data: calibData, isLoading: calibLoading } = useListCalibrationSessions({ limit: 50 } as any);

  const cycles = cyclesData?.data ?? [];
  const goalCycles = goalCyclesData?.data ?? [];
  const goals = goalsData?.data ?? [];
  const calibSessions = calibData?.data ?? [];

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-amber-500" />
            {t('Performance', 'الأداء')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Appraisals, goals, and calibration sessions', 'التقييمات والأهداف وجلسات المعايرة')}</p>
        </div>

        <Tabs defaultValue="appraisals">
          <TabsList>
            <TabsTrigger value="appraisals">{t('Appraisal Cycles', 'دورات التقييم')}</TabsTrigger>
            <TabsTrigger value="goals">{t('Goal Cycles', 'دورات الأهداف')}</TabsTrigger>
            <TabsTrigger value="calibration">{t('Calibration', 'المعايرة')}</TabsTrigger>
          </TabsList>

          {/* Appraisals */}
          <TabsContent value="appraisals" className="mt-4 space-y-3">
            {cyclesLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : cycles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No appraisal cycles found', 'لا توجد دورات تقييم')}</div>
            ) : cycles.map(c => <CyclePanel key={c.id} cycle={c} />)}
          </TabsContent>

          {/* Goals */}
          <TabsContent value="goals" className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <Select value={selectedGoalCycle} onValueChange={setSelectedGoalCycle}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder={t('Select Goal Cycle', 'اختر دورة الأهداف')} />
                </SelectTrigger>
                <SelectContent>
                  {goalCycles.map(gc => (
                    <SelectItem key={gc.id} value={String(gc.id)}>{gc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="outline">{goals.length} {t('goals', 'أهداف')}</Badge>
            </div>

            {goals.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                {selectedGoalCycle ? t('No goals in this cycle', 'لا توجد أهداف في هذه الدورة') : t('Select a cycle to view goals', 'اختر دورة لعرض الأهداف')}
              </CardContent></Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Title', 'العنوان')}</TableHead>
                      <TableHead>{t('Employee', 'الموظف')}</TableHead>
                      <TableHead>{t('Weight', 'الوزن')}</TableHead>
                      <TableHead>{t('Target', 'الهدف')}</TableHead>
                      <TableHead>{t('Actual', 'الفعلي')}</TableHead>
                      <TableHead>{t('Status', 'الحالة')}</TableHead>
                      <TableHead>{t('Due', 'الموعد')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goals.map(g => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.title}</TableCell>
                        <TableCell>#{g.employeeId}</TableCell>
                        <TableCell>{g.weight != null ? `${g.weight}%` : '—'}</TableCell>
                        <TableCell>{g.targetValue ?? '—'}</TableCell>
                        <TableCell>{g.actualValue ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('capitalize text-xs',
                            g.status === 'completed' ? 'border-emerald-400 text-emerald-600' :
                              g.status === 'in_progress' ? 'border-blue-400 text-blue-600' :
                                'border-amber-400 text-amber-600'
                          )}>
                            {g.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>{fmtDate(g.dueDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* Calibration */}
          <TabsContent value="calibration" className="mt-4">
            {calibLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : calibSessions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No calibration sessions found', 'لا توجد جلسات معايرة')}</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {calibSessions.map(s => (
                  <Card key={s.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <BarChart2 className="w-4 h-4 text-amber-500" />
                          {t('Calibration Session', 'جلسة المعايرة')} #{s.id}
                        </CardTitle>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          s.status === 'completed' ? 'border-emerald-400 text-emerald-600' :
                            s.status === 'in_progress' ? 'border-blue-400 text-blue-600' :
                              'border-amber-400 text-amber-600'
                        )}>
                          {s.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t('Cycle', 'الدورة')}</span><span>#{s.cycleId}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t('Facilitator', 'الميسر')}</span><span>{s.facilitatorId ? `#${s.facilitatorId}` : '—'}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t('Date', 'التاريخ')}</span><span>{fmtDate(s.sessionDate)}</span>
                      </div>
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
