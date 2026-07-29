import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Plus, Timer, Moon, Sun, GitFork, Zap, Clock, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Shift {
  id: number;
  nameEn: string;
  nameAr: string;
  shiftCode: string;
  shiftType: 'day' | 'night' | 'split' | 'flexible';
  startTime: string;
  endTime: string;
  breakMinutes: number;
  gracePeriodMinutes: number;
  maxOvertimeMinutes: number;
  color: string;
  isActive: boolean;
}

const SHIFT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#6366F1', '#EF4444', '#8B5CF6'];

const defaultForm = {
  nameEn: '',
  nameAr: '',
  shiftCode: '',
  shiftType: 'day' as Shift['shiftType'],
  startTime: '08:00',
  endTime: '16:00',
  breakMinutes: 60,
  gracePeriodMinutes: 10,
  maxOvertimeMinutes: 120,
  color: '#3B82F6',
  isActive: true,
};

export default function Shifts() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...defaultForm });

  const { data: shifts, isLoading } = useQuery<Shift[]>({
    queryKey: ['shifts'],
    queryFn: () => fetch('/api/shifts', { credentials: 'include' }).then(r => r.json()),
  });

  const createShift = useMutation({
    mutationFn: (data: typeof defaultForm) =>
      fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: t('Success', 'نجاح'), description: t('Shift created successfully.', 'تم إنشاء الوردية بنجاح.') });
      setDialogOpen(false);
      setForm({ ...defaultForm });
    },
    onError: (err: any) => {
      toast({ title: t('Error', 'خطأ'), description: err.message, variant: 'destructive' });
    },
  });

  const totalShifts = shifts?.length ?? 0;
  const activeShifts = shifts?.filter(s => s.isActive).length ?? 0;
  const nightShifts = shifts?.filter(s => s.shiftType === 'night').length ?? 0;
  const flexibleShifts = shifts?.filter(s => s.shiftType === 'flexible').length ?? 0;

  const getShiftTypeIcon = (type: Shift['shiftType']) => {
    switch (type) {
      case 'night': return <Moon className="w-3 h-3" />;
      case 'split': return <GitFork className="w-3 h-3" />;
      case 'flexible': return <Zap className="w-3 h-3" />;
      default: return <Sun className="w-3 h-3" />;
    }
  };

  const getShiftTypeLabel = (type: Shift['shiftType']) => {
    switch (type) {
      case 'day': return t('Day', 'نهاري');
      case 'night': return t('Night', 'ليلي');
      case 'split': return t('Split', 'مقسم');
      case 'flexible': return t('Flexible', 'مرن');
    }
  };

  const formatMinutes = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Shift Management', 'إدارة الورديات')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Configure and manage work shift schedules.', 'تكوين وإدارة جداول ورديات العمل.')}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 me-2" />
          {t('New Shift', 'وردية جديدة')}
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Timer className="w-8 h-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">{t('Total Shifts', 'إجمالي الورديات')}</p>
                <p className="text-3xl font-bold">{isLoading ? '—' : totalShifts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-sm text-muted-foreground">{t('Active', 'نشطة')}</p>
                <p className="text-3xl font-bold text-emerald-500">{isLoading ? '—' : activeShifts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Moon className="w-8 h-8 text-indigo-400" />
              <div>
                <p className="text-sm text-muted-foreground">{t('Night Shifts', 'ورديات ليلية')}</p>
                <p className="text-3xl font-bold text-indigo-400">{isLoading ? '—' : nightShifts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Zap className="w-8 h-8 text-amber-500" />
              <div>
                <p className="text-sm text-muted-foreground">{t('Flexible', 'مرنة')}</p>
                <p className="text-3xl font-bold text-amber-500">{isLoading ? '—' : flexibleShifts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shift Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-6 w-3/4 mb-3" />
                <Skeleton className="h-4 w-1/2 mb-2" />
                <Skeleton className="h-10 w-full mb-3" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))
        ) : !shifts || shifts.length === 0 ? (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            <Timer className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg">{t('No shifts configured yet.', 'لم يتم تكوين أي ورديات بعد.')}</p>
            <Button variant="outline" className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 me-2" />
              {t('Create First Shift', 'إنشاء أول وردية')}
            </Button>
          </div>
        ) : (
          shifts.map((shift) => (
            <Card
              key={shift.id}
              className="overflow-hidden border-s-4 hover:shadow-md transition-shadow"
              style={{ borderLeftColor: shift.color, borderLeftWidth: '4px' }}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-base">
                      {lang === 'en' ? shift.nameEn : shift.nameAr}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs"
                        style={{ borderColor: shift.color, color: shift.color }}
                      >
                        {shift.shiftCode}
                      </Badge>
                      <Badge variant="secondary" className="text-xs flex items-center gap-1">
                        {getShiftTypeIcon(shift.shiftType)}
                        {getShiftTypeLabel(shift.shiftType)}
                      </Badge>
                    </div>
                  </div>
                  {shift.isActive && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      {t('Active', 'نشط')}
                    </div>
                  )}
                </div>

                {/* Time Range */}
                <div
                  className="flex items-center justify-center gap-3 py-3 px-4 rounded-md mb-3 font-mono text-lg font-bold"
                  style={{ backgroundColor: `${shift.color}15` }}
                >
                  <span style={{ color: shift.color }}>{shift.startTime}</span>
                  <span className="text-muted-foreground text-sm">→</span>
                  <span style={{ color: shift.color }}>{shift.endTime}</span>
                </div>

                {/* Details */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {t('Break', 'راحة')}
                    </p>
                    <p className="text-sm font-semibold mt-0.5">{formatMinutes(shift.breakMinutes)}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {t('Grace', 'سماح')}
                    </p>
                    <p className="text-sm font-semibold mt-0.5">{formatMinutes(shift.gracePeriodMinutes)}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {t('Max OT', 'حد أضافي')}
                    </p>
                    <p className="text-sm font-semibold mt-0.5">{formatMinutes(shift.maxOvertimeMinutes)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* New Shift Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Create New Shift', 'إنشاء وردية جديدة')}</DialogTitle>
            <DialogDescription>
              {t('Define a new work shift with its schedule and rules.', 'حدد وردية عمل جديدة بجدولها وقواعدها.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Name (English)', 'الاسم (إنجليزي)')}</label>
                <Input
                  value={form.nameEn}
                  onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))}
                  placeholder="Morning Shift"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Name (Arabic)', 'الاسم (عربي)')}</label>
                <Input
                  value={form.nameAr}
                  onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))}
                  placeholder="وردية الصباح"
                  dir="rtl"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Shift Code', 'رمز الوردية')}</label>
                <Input
                  value={form.shiftCode}
                  onChange={e => setForm(f => ({ ...f, shiftCode: e.target.value.toUpperCase() }))}
                  placeholder="MORN"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Shift Type', 'نوع الوردية')}</label>
                <Select
                  value={form.shiftType}
                  onValueChange={v => setForm(f => ({ ...f, shiftType: v as Shift['shiftType'] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">{t('Day', 'نهاري')}</SelectItem>
                    <SelectItem value="night">{t('Night', 'ليلي')}</SelectItem>
                    <SelectItem value="split">{t('Split', 'مقسم')}</SelectItem>
                    <SelectItem value="flexible">{t('Flexible', 'مرن')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Start Time', 'وقت البدء')}</label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('End Time', 'وقت الانتهاء')}</label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Break (min)', 'راحة (دقيقة)')}</label>
                <Input
                  type="number"
                  min={0}
                  value={form.breakMinutes}
                  onChange={e => setForm(f => ({ ...f, breakMinutes: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Grace (min)', 'سماح (دقيقة)')}</label>
                <Input
                  type="number"
                  min={0}
                  value={form.gracePeriodMinutes}
                  onChange={e => setForm(f => ({ ...f, gracePeriodMinutes: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('Max OT (min)', 'حد أضافي (دقيقة)')}</label>
                <Input
                  type="number"
                  min={0}
                  value={form.maxOvertimeMinutes}
                  onChange={e => setForm(f => ({ ...f, maxOvertimeMinutes: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('Color', 'اللون')}</label>
              <div className="flex gap-2">
                {SHIFT_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color }))}
                    className="w-8 h-8 rounded-full transition-transform hover:scale-110 focus:outline-none"
                    style={{
                      backgroundColor: color,
                      boxShadow: form.color === color ? `0 0 0 3px white, 0 0 0 5px ${color}` : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="isActive"
                checked={form.isActive}
                onCheckedChange={checked => setForm(f => ({ ...f, isActive: !!checked }))}
              />
              <label htmlFor="isActive" className="text-sm font-medium cursor-pointer">
                {t('Active Shift', 'وردية نشطة')}
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setForm({ ...defaultForm }); }}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button
              onClick={() => createShift.mutate(form)}
              disabled={createShift.isPending || !form.nameEn || !form.shiftCode}
            >
              {createShift.isPending ? t('Creating...', 'جارٍ الإنشاء...') : t('Create Shift', 'إنشاء الوردية')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
