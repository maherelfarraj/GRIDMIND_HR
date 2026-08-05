import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListLeaveBalances, useListLeaveTypes, useListEmployees, useUpdateLeaveBalance,
  useAnnualLeaveReset, useProvisionLeaveYear,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Layers, TrendingUp, CalendarDays, Settings2, Info, RefreshCw, Users } from 'lucide-react';
import type { LeaveBalance } from '@workspace/api-client-react';

// ─── helpers ──────────────────────────────────────────────────────────────────

function availableColor(val: number): string {
  if (val >= 10) return 'text-emerald-600 font-bold';
  if (val >= 3) return 'text-amber-600 font-bold';
  return 'text-red-600 font-bold';
}

function numCell(v: string | undefined) {
  return parseFloat(v ?? '0').toFixed(1);
}

// ─── Adjust Balance Dialog ─────────────────────────────────────────────────────

interface AdjustDialogProps {
  balance: LeaveBalance | null;
  onClose: () => void;
}

function AdjustDialog({ balance, onClose }: AdjustDialogProps) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMut = useUpdateLeaveBalance();

  const [opening, setOpening] = useState(balance ? balance.openingBalance : '0');
  const [accrued, setAccrued] = useState(balance ? balance.accrued : '0');
  const [adjustment, setAdjustment] = useState(balance ? balance.adjustment : '0');
  const [carriedOver, setCarriedOver] = useState(balance ? balance.carriedOver : '0');
  const [saving, setSaving] = useState(false);

  // Sync when balance changes
  useMemo(() => {
    if (balance) {
      setOpening(balance.openingBalance);
      setAccrued(balance.accrued);
      setAdjustment(balance.adjustment);
      setCarriedOver(balance.carriedOver);
    }
  }, [balance?.id]);

  async function handleSave() {
    if (!balance) return;
    setSaving(true);
    try {
      await updateMut.mutateAsync({
        id: balance.id,
        data: {
          employeeId: balance.employeeId,
          leaveTypeId: balance.leaveTypeId,
          year: balance.year,
          openingBalance: opening,
          accrued,
          adjustment,
          carriedOver,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-balances'] });
      toast({ title: t('Balance updated', 'تم تحديث الرصيد') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (!balance) return null;

  return (
    <Dialog open={!!balance} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Adjust Leave Balance', 'تعديل رصيد الإجازة')}</DialogTitle>
          <DialogDescription>
            {localName(balance.employeeNameEn, balance.employeeNameAr, lang)} — {localName(balance.leaveTypeNameEn, balance.leaveTypeNameAr, lang)} ({balance.year})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Opening Balance', 'الرصيد الافتتاحي')}</label>
            <Input type="number" step="0.5" value={opening} onChange={e => setOpening(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Accrued', 'المستحق')}</label>
            <Input type="number" step="0.5" value={accrued} onChange={e => setAccrued(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Adjustment', 'التسوية')}</label>
            <Input type="number" step="0.5" value={adjustment} onChange={e => setAdjustment(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Carried Over', 'المرحّل')}</label>
            <Input type="number" step="0.5" value={carriedOver} onChange={e => setCarriedOver(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Save Changes', 'حفظ التغييرات')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LeaveBalancesPage() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [yearFilter, setYearFilter] = useState('2025');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<LeaveBalance | null>(null);
  const [resetting, setResetting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);

  const annualResetMut = useAnnualLeaveReset();
  const provisionMut = useProvisionLeaveYear();

  const { data: balances, isLoading } = useListLeaveBalances({
    year: Number(yearFilter),
    leaveTypeId: leaveTypeFilter !== 'all' ? Number(leaveTypeFilter) : undefined,
  });

  const { data: leaveTypes } = useListLeaveTypes();

  async function handleAnnualReset() {
    const nextYear = Number(yearFilter) + 1;
    if (!confirm(t(
      `This will create ${nextYear} balance records for all employees, carrying over eligible days. Continue?`,
      `سيؤدي هذا إلى إنشاء سجلات رصيد ${nextYear} لجميع الموظفين مع ترحيل الأيام المؤهلة. هل تريد الاستمرار؟`
    ))) return;
    setResetting(true);
    try {
      const result = await annualResetMut.mutateAsync({ data: { year: nextYear } });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-balances'] });
      setYearFilter(String(nextYear));
      toast({
        title: t('Annual reset complete', 'اكتمل إعادة التعيين السنوي'),
        description: t(
          `Created ${result.created} balance records for ${result.year}.`,
          `تم إنشاء ${result.created} سجل رصيد لعام ${result.year}.`
        ),
      });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  }

  async function handleProvisionYear() {
    const year = Number(yearFilter);
    if (!confirm(t(
      `This will create ${year} balance records for all active employees who don't have them yet, applying carry-over caps. Continue?`,
      `سيؤدي هذا إلى إنشاء سجلات رصيد ${year} لجميع الموظفين النشطين الذين لا يملكونها بعد، مع تطبيق حدود الترحيل. هل تريد الاستمرار؟`
    ))) return;
    setProvisioning(true);
    try {
      const result = await provisionMut.mutateAsync({ data: { year } });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-balances'] });
      toast({
        title: t('Provisioning complete', 'اكتمل التزويد'),
        description: t(
          `Created ${result.created} balance records for ${result.year} (${result.skipped} already existed).`,
          `تم إنشاء ${result.created} سجل رصيد لعام ${result.year} (${result.skipped} موجود مسبقًا).`
        ),
      });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setProvisioning(false);
    }
  }

  const filtered = useMemo(() => {
    const list = balances ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(b =>
      (b.employeeNameEn ?? '').toLowerCase().includes(q) ||
      (b.employeeNameAr ?? '').toLowerCase().includes(q)
    );
  }, [balances, search]);

  // Stats
  const totalRecords = filtered.length;
  const avgAnnual = useMemo(() => {
    if (!filtered.length) return 0;
    const sum = filtered.reduce((acc, b) => acc + parseFloat(b.openingBalance) + parseFloat(b.accrued), 0);
    return sum / filtered.length;
  }, [filtered]);
  const totalUsed = useMemo(() =>
    filtered.reduce((acc, b) => acc + parseFloat(b.used), 0),
    [filtered]
  );

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Layers className="w-7 h-7 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">{t('Leave Balances', 'أرصدة الإجازات')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('Employee leave balance overview', 'نظرة عامة على أرصدة إجازات الموظفين')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleProvisionYear}
            disabled={provisioning}
            className="gap-2"
          >
            <Users className={cn('w-4 h-4', provisioning && 'animate-pulse')} />
            {t(`Provision ${yearFilter}`, `تزويد ${yearFilter}`)}
          </Button>
          <Button
            variant="outline"
            onClick={handleAnnualReset}
            disabled={resetting}
            className="gap-2"
          >
            <RefreshCw className={cn('w-4 h-4', resetting && 'animate-spin')} />
            {t(`Reset to ${Number(yearFilter) + 1}`, `تعيين ${Number(yearFilter) + 1}`)}
          </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Layers className="w-9 h-9 text-violet-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('Total Records', 'إجمالي السجلات')}</p>
                {isLoading ? <Skeleton className="h-7 w-16 mt-1" /> : (
                  <p className="text-2xl font-bold">{totalRecords}</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <TrendingUp className="w-9 h-9 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('Avg Annual Available', 'متوسط الأيام السنوية المتاحة')}</p>
                {isLoading ? <Skeleton className="h-7 w-16 mt-1" /> : (
                  <p className="text-2xl font-bold">{avgAnnual.toFixed(1)}</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CalendarDays className="w-9 h-9 text-emerald-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('Total Days Used', 'إجمالي الأيام المستخدمة')}</p>
                {isLoading ? <Skeleton className="h-7 w-16 mt-1" /> : (
                  <p className="text-2xl font-bold">{totalUsed.toFixed(1)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['2025', '2026', '2027'].map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={leaveTypeFilter} onValueChange={setLeaveTypeFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('All Leave Types', 'كل أنواع الإجازات')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Leave Types', 'كل أنواع الإجازات')}</SelectItem>
              {(leaveTypes ?? []).map(lt => (
                <SelectItem key={lt.id} value={String(lt.id)}>
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: lt.color }} />
                    {localName(lt.nameEn, lt.nameAr, lang)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder={t('Search employee…', 'بحث موظف…')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-52"
          />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Leave Type', 'نوع الإجازة')}</TableHead>
                    <TableHead>{t('Year', 'السنة')}</TableHead>
                    <TableHead className="text-right">{t('Opening', 'افتتاحي')}</TableHead>
                    <TableHead className="text-right">{t('Accrued', 'مستحق')}</TableHead>
                    <TableHead className="text-right">{t('Used', 'مستخدم')}</TableHead>
                    <TableHead className="text-right">{t('Pending', 'معلق')}</TableHead>
                    <TableHead className="text-right">{t('Adj', 'تسوية')}</TableHead>
                    <TableHead className="text-right">{t('Carried Over', 'مرحّل')}</TableHead>
                    <TableHead className="text-right">{t('Available', 'متاح')}</TableHead>
                    <TableHead>{t('Actions', 'الإجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 11 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    : filtered.map(b => {
                        const available = parseFloat(b.available ?? '0');
                        return (
                          <TableRow key={b.id}>
                            <TableCell className="font-medium">
                              {localName(b.employeeNameEn, b.employeeNameAr, lang)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-xs"
                                style={{
                                  borderColor: b.leaveTypeColor,
                                  color: b.leaveTypeColor,
                                }}
                              >
                                <span
                                  className="w-2 h-2 rounded-full mr-1 inline-block"
                                  style={{ backgroundColor: b.leaveTypeColor }}
                                />
                                {localName(b.leaveTypeNameEn, b.leaveTypeNameAr, lang)}
                              </Badge>
                            </TableCell>
                            <TableCell>{b.year}</TableCell>
                            <TableCell className="text-right tabular-nums">{numCell(b.openingBalance)}</TableCell>
                            <TableCell className="text-right tabular-nums">{numCell(b.accrued)}</TableCell>
                            <TableCell className="text-right tabular-nums">{numCell(b.used)}</TableCell>
                            <TableCell className="text-right tabular-nums">{numCell(b.pending)}</TableCell>
                            <TableCell className="text-right tabular-nums">{numCell(b.adjustment)}</TableCell>
                            <TableCell className="text-right tabular-nums">{numCell(b.carriedOver)}</TableCell>
                            <TableCell className={cn('text-right tabular-nums', availableColor(available))}>
                              {available.toFixed(1)}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setAdjustTarget(b)}
                              >
                                <Settings2 className="w-3 h-3 mr-1" />
                                {t('Adjust', 'تعديل')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                  }
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        {t('No balance records found', 'لا توجد سجلات أرصدة')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Export note */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3 border">
          <Info className="w-4 h-4 flex-shrink-0" />
          <span>
            {t(
              'Balance data is export-ready via the finance summary report.',
              'بيانات الأرصدة جاهزة للتصدير عبر تقرير الملخص المالي.'
            )}
          </span>
        </div>

        {/* Adjust Dialog */}
        <AdjustDialog balance={adjustTarget} onClose={() => setAdjustTarget(null)} />
      </div>
    </AnimatedPage>
  );
}
