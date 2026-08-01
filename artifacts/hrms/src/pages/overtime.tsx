import { apiFetch } from '@/lib/api';
import { useMemo, useState } from 'react';
import { useSearch, useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { useListAttendance } from '@workspace/api-client-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Plus, TrendingUp, Globe, Building2, Clock, CheckCircle2, Filter, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';

interface OvertimeRule {
  id: number;
  nameEn: string;
  nameAr: string;
  scope: 'global' | 'department';
  departmentId: number | null;
  departmentNameEn: string | null;
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  multiplierWeekday: number;
  multiplierWeekend: number;
  multiplierHoliday: number;
  requiresApproval: boolean;
  effectiveFrom: string;
}

const defaultRuleForm = {
  nameEn: '',
  nameAr: '',
  maxDailyMinutes: 120,
  maxWeeklyMinutes: 600,
  multiplierWeekday: 1.25,
  multiplierWeekend: 1.5,
  multiplierHoliday: 2.0,
  requiresApproval: true,
  effectiveFrom: new Date().toISOString().split('T')[0],
};

function formatOTMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatProgress(value: number, max: number): string {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return `${pct}%`;
}

export default function Overtime() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({ ...defaultRuleForm });
  const search = useSearch();
  const [, navigate] = useLocation();
  const filterDepartmentId = (() => {
    const v = new URLSearchParams(search).get('departmentId');
    return v ? Number(v) : null;
  })();
  const clearFilter = () => navigate('/overtime', { replace: true });

  const { data: rules, isLoading: loadingRules } = useQuery<OvertimeRule[]>({
    queryKey: ['overtime-rules'],
    queryFn: () => apiFetch('/api/overtime-rules', { credentials: 'include' }).then(r => r.json()),
  });

  const { data: attendanceData, isLoading: loadingAttendance } = useListAttendance();

  const createRule = useMutation({
    mutationFn: (data: typeof defaultRuleForm) =>
      apiFetch('/api/overtime-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overtime-rules'] });
      toast({ title: t('Success', 'نجاح'), description: t('OT rule created.', 'تم إنشاء قاعدة العمل الإضافي.') });
      setDialogOpen(false);
      setRuleForm({ ...defaultRuleForm });
    },
    onError: (err: any) => {
      toast({ title: t('Error', 'خطأ'), description: err.message, variant: 'destructive' });
    },
  });

  // OT Records
  const otRecords = attendanceData?.filter(r =>
    (r.overtimeMinutes ?? 0) > 0 &&
    (filterDepartmentId == null || r.departmentId === filterDepartmentId)
  ) ?? [];

  const filterDepartmentName = useMemo(() => {
    if (filterDepartmentId == null) return null;
    return (
      attendanceData?.find(r => r.departmentId === filterDepartmentId)?.departmentNameEn ??
      rules?.find(r => r.departmentId === filterDepartmentId)?.departmentNameEn ??
      `#${filterDepartmentId}`
    );
  }, [filterDepartmentId, attendanceData, rules]);
  const totalOTMinutes = otRecords.reduce((sum, r) => sum + (r.overtimeMinutes ?? 0), 0);

  // Top 10 employees by OT
  const employeeOTMap: Record<string, { nameEn: string; nameAr: string; total: number }> = {};
  otRecords.forEach(r => {
    const key = String(r.employeeId);
    if (!employeeOTMap[key]) {
      employeeOTMap[key] = { nameEn: r.employeeNameEn, nameAr: r.employeeNameAr, total: 0 };
    }
    employeeOTMap[key].total += r.overtimeMinutes ?? 0;
  });

  const top10 = Object.values(employeeOTMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(e => ({
      name: lang === 'en' ? e.nameEn : e.nameAr,
      minutes: e.total,
      hours: parseFloat((e.total / 60).toFixed(1)),
    }));

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('Overtime', 'الوقت الإضافي')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('Manage overtime rules and review OT reports.', 'إدارة قواعد العمل الإضافي ومراجعة تقاريره.')}
        </p>
      </div>

      {filterDepartmentId != null && (
        <div className="flex items-center gap-2 flex-wrap rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <Filter className="w-4 h-4 text-primary shrink-0" />
          <span className="text-muted-foreground">{t('Filtered by', 'مصفى حسب')}:</span>
          <Badge variant="secondary">{t('Department', 'القسم')}: {filterDepartmentName}</Badge>
          <Button variant="ghost" size="sm" className="ms-auto h-7" onClick={clearFilter}>
            <X className="w-3.5 h-3.5 me-1" />
            {t('Clear filter', 'مسح التصفية')}
          </Button>
        </div>
      )}

      <Tabs defaultValue={filterDepartmentId != null ? 'report' : 'rules'} className="w-full">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="rules">{t('Rules', 'القواعد')}</TabsTrigger>
          <TabsTrigger value="report">{t('OT Report', 'تقرير الوقت الإضافي')}</TabsTrigger>
        </TabsList>

        {/* TAB 1: Rules */}
        <TabsContent value="rules" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 me-2" />
              {t('New Rule', 'قاعدة جديدة')}
            </Button>
          </div>

          {loadingRules ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="p-5"><Skeleton className="h-32 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : !rules || rules.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p>{t('No overtime rules configured.', 'لم يتم تكوين قواعد عمل إضافي.')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rules.map(rule => (
                <Card key={rule.id} className="overflow-hidden">
                  <CardHeader className="pb-3 border-b">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          {lang === 'en' ? rule.nameEn : rule.nameAr}
                        </CardTitle>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            {rule.scope === 'global' ? (
                              <><Globe className="w-3 h-3" /> {t('Global', 'عام')}</>
                            ) : (
                              <><Building2 className="w-3 h-3" /> {rule.departmentNameEn || t('Department', 'القسم')}</>
                            )}
                          </Badge>
                          <Badge
                            className={`text-xs ${rule.requiresApproval
                              ? 'bg-amber-500/10 text-amber-500 border-transparent'
                              : 'bg-emerald-500/10 text-emerald-500 border-transparent'}`}
                          >
                            {rule.requiresApproval ? t('Requires Approval', 'يتطلب موافقة') : t('Auto Approved', 'موافقة تلقائية')}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    {/* Max limits */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('Max Daily', 'أقصى يومي')}</p>
                        <p className="text-sm font-bold mt-0.5">{formatOTMinutes(rule.maxDailyMinutes)}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('Max Weekly', 'أقصى أسبوعي')}</p>
                        <p className="text-sm font-bold mt-0.5">{formatOTMinutes(rule.maxWeeklyMinutes)}</p>
                      </div>
                    </div>

                    {/* Multiplier chips */}
                    <div className="flex gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold">
                        <Clock className="w-3 h-3" />
                        {t('Weekday', 'يوم العمل')} ×{rule.multiplierWeekday.toFixed(2)}
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold">
                        <Clock className="w-3 h-3" />
                        {t('Weekend', 'عطلة نهاية الأسبوع')} ×{rule.multiplierWeekend.toFixed(2)}
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 text-xs font-semibold">
                        <Clock className="w-3 h-3" />
                        {t('Holiday', 'إجازة رسمية')} ×{rule.multiplierHoliday.toFixed(2)}
                      </div>
                    </div>

                    <p className="text-[10px] text-muted-foreground">
                      {t('Effective from', 'ساري من')}: {new Date(rule.effectiveFrom).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: OT Report */}
        <TabsContent value="report" className="space-y-6 mt-4">
          {/* Summary Card */}
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <TrendingUp className="w-12 h-12 text-amber-500" />
              <div>
                <p className="text-sm text-muted-foreground">{t('Total Overtime (all records)', 'إجمالي الوقت الإضافي (جميع السجلات)')}</p>
                <p className="text-4xl font-bold text-amber-500">{formatOTMinutes(totalOTMinutes)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {otRecords.length} {t('records with OT', 'سجلات بها وقت إضافي')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Bar Chart */}
          {top10.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t('Top 10 Employees by Overtime Hours', 'أعلى 10 موظفين من حيث ساعات العمل الإضافي')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    layout="vertical"
                    data={top10}
                    margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                    <Tooltip
                      formatter={(value: number) => [`${value}h`, t('OT Hours', 'ساعات إضافية')]}
                    />
                    <Bar dataKey="hours" fill="#F59E0B" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Overtime Records', 'سجلات الوقت الإضافي')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Date', 'التاريخ')}</TableHead>
                    <TableHead>{t('OT Minutes', 'دقائق إضافية')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAttendance ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      </TableRow>
                    ))
                  ) : otRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                        {t('No overtime records found.', 'لم يتم العثور على سجلات وقت إضافي.')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    otRecords.map(record => (
                      <TableRow key={record.id}>
                        <TableCell className="font-medium">
                          {lang === 'en' ? record.employeeNameEn : record.employeeNameAr}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {record.date}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono font-semibold text-amber-500">
                            {formatOTMinutes(record.overtimeMinutes ?? 0)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {record.status === 'present' && (
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-transparent">{t('Present', 'حاضر')}</Badge>
                          )}
                          {record.status === 'late' && (
                            <Badge className="bg-amber-500/10 text-amber-500 border-transparent">{t('Late', 'متأخر')}</Badge>
                          )}
                          {record.status === 'absent' && (
                            <Badge className="bg-rose-500/10 text-rose-500 border-transparent">{t('Absent', 'غائب')}</Badge>
                          )}
                          {!['present', 'late', 'absent'].includes(record.status) && (
                            <Badge variant="outline">{record.status}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New Rule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Create Overtime Rule', 'إنشاء قاعدة وقت إضافي')}</DialogTitle>
            <DialogDescription>
              {t('Define overtime calculation rules and limits.', 'حدد قواعد وحدود حساب الوقت الإضافي.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Name (English)', 'الاسم (إنجليزي)')}</label>
                <Input
                  value={ruleForm.nameEn}
                  onChange={e => setRuleForm(f => ({ ...f, nameEn: e.target.value }))}
                  placeholder="Standard OT Rule"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Name (Arabic)', 'الاسم (عربي)')}</label>
                <Input
                  value={ruleForm.nameAr}
                  onChange={e => setRuleForm(f => ({ ...f, nameAr: e.target.value }))}
                  placeholder="قاعدة الوقت الإضافي"
                  dir="rtl"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Max Daily (min)', 'أقصى يومي (دقيقة)')}</label>
                <Input
                  type="number"
                  min={0}
                  value={ruleForm.maxDailyMinutes}
                  onChange={e => setRuleForm(f => ({ ...f, maxDailyMinutes: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Max Weekly (min)', 'أقصى أسبوعي (دقيقة)')}</label>
                <Input
                  type="number"
                  min={0}
                  value={ruleForm.maxWeeklyMinutes}
                  onChange={e => setRuleForm(f => ({ ...f, maxWeeklyMinutes: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Weekday ×', 'يوم العمل ×')}</label>
                <Input
                  type="number"
                  step={0.01}
                  min={1}
                  value={ruleForm.multiplierWeekday}
                  onChange={e => setRuleForm(f => ({ ...f, multiplierWeekday: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Weekend ×', 'نهاية الأسبوع ×')}</label>
                <Input
                  type="number"
                  step={0.01}
                  min={1}
                  value={ruleForm.multiplierWeekend}
                  onChange={e => setRuleForm(f => ({ ...f, multiplierWeekend: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Holiday ×', 'إجازة رسمية ×')}</label>
                <Input
                  type="number"
                  step={0.01}
                  min={1}
                  value={ruleForm.multiplierHoliday}
                  onChange={e => setRuleForm(f => ({ ...f, multiplierHoliday: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('Effective From', 'ساري من')}</label>
              <Input
                type="date"
                value={ruleForm.effectiveFrom}
                onChange={e => setRuleForm(f => ({ ...f, effectiveFrom: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="requiresApproval"
                checked={ruleForm.requiresApproval}
                onCheckedChange={checked => setRuleForm(f => ({ ...f, requiresApproval: !!checked }))}
              />
              <label htmlFor="requiresApproval" className="text-sm font-medium cursor-pointer">
                {t('Requires Approval', 'يتطلب موافقة')}
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setRuleForm({ ...defaultRuleForm }); }}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button
              onClick={() => createRule.mutate(ruleForm)}
              disabled={createRule.isPending || !ruleForm.nameEn}
            >
              {createRule.isPending ? t('Creating...', 'جارٍ الإنشاء...') : t('Create Rule', 'إنشاء القاعدة')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
