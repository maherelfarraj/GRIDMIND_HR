import { useCallback, useEffect, useState } from 'react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Plus, UserMinus } from 'lucide-react';

interface OffboardingRecord {
  id: number;
  employeeId: number;
  employeeNameEn?: string | null;
  employeeNameAr?: string | null;
  separationType: string;
  lastWorkingDate: string;
  status: string;
  completionPct: number;
}

interface OffboardingTask {
  id: number;
  titleEn: string;
  titleAr: string;
  ownerRole: string;
  controlArea: string;
  status: string;
  isRequired: boolean;
}

const separationTypes = ['resignation', 'termination', 'retirement', 'contract_end', 'transfer', 'death', 'other'];

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function NewOffboardingDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employeeId: '', separationType: 'resignation', noticeDate: '', lastWorkingDate: '', reason: '' });

  async function submit() {
    const employeeId = Number(form.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !form.lastWorkingDate) {
      toast({ title: t('Employee and last working date are required', 'الموظف وتاريخ آخر يوم عمل مطلوبان'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch('/api/employee-offboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          separationType: form.separationType,
          noticeDate: form.noticeDate || null,
          lastWorkingDate: form.lastWorkingDate,
          reason: form.reason || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t('Unable to start offboarding', 'تعذر بدء إنهاء الخدمة'));
      }
      toast({ title: t('Offboarding started', 'تم بدء إنهاء الخدمة') });
      setForm({ employeeId: '', separationType: 'resignation', noticeDate: '', lastWorkingDate: '', reason: '' });
      onCreated();
      onClose();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : t('Unable to start offboarding', 'تعذر بدء إنهاء الخدمة'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('Start Employee Offboarding', 'بدء إنهاء خدمة الموظف')}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1"><Label>{t('Employee ID', 'رقم الموظف')}</Label><Input type="number" min="1" value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} /></div>
          <div className="space-y-1">
            <Label>{t('Separation type', 'نوع إنهاء الخدمة')}</Label>
            <Select value={form.separationType} onValueChange={(value) => setForm({ ...form, separationType: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{separationTypes.map((type) => <SelectItem key={type} value={type}>{label(type)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>{t('Notice date', 'تاريخ الإشعار')}</Label><Input type="date" value={form.noticeDate} onChange={(event) => setForm({ ...form, noticeDate: event.target.value })} /></div>
            <div className="space-y-1"><Label>{t('Last working date', 'تاريخ آخر يوم عمل')}</Label><Input type="date" value={form.lastWorkingDate} onChange={(event) => setForm({ ...form, lastWorkingDate: event.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label>{t('Reason / notes', 'السبب / الملاحظات')}</Label><Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t('Starting…', 'جارٍ البدء…') : t('Start offboarding', 'بدء إنهاء الخدمة')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OffboardingCard({ record, refresh }: { record: OffboardingRecord; refresh: () => void }) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [tasks, setTasks] = useState<OffboardingTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const response = await apiFetch(`/api/employee-offboarding/${record.id}/tasks`);
      if (!response.ok) throw new Error();
      const body = await response.json();
      setTasks(body.data ?? []);
    } catch {
      toast({ title: lang === 'ar' ? 'تعذر تحميل مهام المخالصة' : 'Unable to load clearance tasks', variant: 'destructive' });
    } finally {
      setLoadingTasks(false);
    }
  }, [lang, record.id, toast]);

  useEffect(() => { if (expanded) void loadTasks(); }, [expanded, loadTasks]);

  async function toggleTask(task: OffboardingTask) {
    const response = await apiFetch(`/api/employee-offboarding/${record.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: task.status === 'completed' ? 'pending' : 'completed' }),
    });
    if (!response.ok) {
      toast({ title: t('Unable to update task', 'تعذر تحديث المهمة'), variant: 'destructive' });
      return;
    }
    await loadTasks();
    refresh();
  }

  const employeeName = lang === 'ar' && record.employeeNameAr ? record.employeeNameAr : record.employeeNameEn;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-primary/20 text-sm font-bold">{record.completionPct}%</div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{employeeName || `${t('Employee', 'الموظف')} #${record.employeeId}`}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('Last working day', 'آخر يوم عمل')}: {record.lastWorkingDate}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{label(record.separationType)}</Badge>
              <Badge variant="outline" className={cn(record.status === 'completed' && 'border-emerald-500 text-emerald-600', record.status === 'blocked' && 'border-red-500 text-red-600')}>{label(record.status)}</Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setExpanded((value) => !value)} aria-label={t('Toggle clearance tasks', 'إظهار أو إخفاء مهام المخالصة')}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
        {expanded && (
          <div className="mt-4 space-y-2 border-t pt-4">
            {loadingTasks ? <p className="text-sm text-muted-foreground">{t('Loading…', 'جارٍ التحميل…')}</p> : tasks.map((task) => (
              <button key={task.id} className="flex w-full items-center gap-3 rounded-md p-2 text-start hover:bg-muted/50" onClick={() => void toggleTask(task)}>
                {task.status === 'completed' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn('flex-1 text-sm', task.status === 'completed' && 'text-muted-foreground line-through')}>{lang === 'ar' ? task.titleAr : task.titleEn}</span>
                <Badge variant="secondary" className="text-xs">{label(task.ownerRole)}</Badge>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Offboarding() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [records, setRecords] = useState<OffboardingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/employee-offboarding?limit=100');
      if (!response.ok) throw new Error();
      const body = await response.json();
      setRecords(body.data ?? []);
    } catch {
      toast({ title: lang === 'ar' ? 'تعذر تحميل سجلات إنهاء الخدمة' : 'Unable to load offboarding records', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => { void load(); }, [load]);

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><UserMinus className="h-6 w-6 text-amber-500" />{t('Offboarding & Final Clearance', 'إنهاء الخدمة والمخالصة النهائية')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('Coordinate handover, asset return, access revocation and final settlement', 'تنسيق التسليم وإعادة الأصول وإلغاء الصلاحيات والتسوية النهائية')}</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}><Plus className="me-2 h-4 w-4" />{t('Start Offboarding', 'بدء إنهاء الخدمة')}</Button>
        </div>
        {loading ? <p className="py-12 text-center text-muted-foreground">{t('Loading…', 'جارٍ التحميل…')}</p> : records.length === 0 ? (
          <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">{t('No offboarding records', 'لا توجد سجلات إنهاء خدمة')}</div>
        ) : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => <OffboardingCard key={record.id} record={record} refresh={() => void load()} />)}</div>}
      </div>
      <NewOffboardingDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={() => void load()} />
    </AnimatedPage>
  );
}
