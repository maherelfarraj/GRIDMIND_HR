import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListProbationRecords,
  useCreateProbationRecord,
  useUpdateProbationRecord,
  useListEmployees,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Clock, Plus, FileEdit } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysRemaining(endDate: string): number {
  const today = new Date();
  const end = new Date(endDate);
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
}

function DaysRemainingBadge({ endDate }: { endDate: string }) {
  const days = daysRemaining(endDate);
  return (
    <Badge className={cn(
      'text-xs font-medium',
      days < 0 ? 'bg-gray-500 text-white' :
        days <= 7 ? 'bg-red-500 text-white' :
          days <= 30 ? 'bg-amber-500 text-white' :
            'bg-emerald-500 text-white'
    )}>
      {days < 0 ? 'Ended' : `${days}d left`}
    </Badge>
  );
}

// ─── New Probation Dialog ──────────────────────────────────────────────────────
function NewProbationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { mutate, isPending } = useCreateProbationRecord();
  const [form, setForm] = useState({ employeeId: '', startDate: '', endDate: '', notes: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit() {
    if (!form.employeeId || !form.startDate || !form.endDate) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        employeeId: parseInt(form.employeeId),
        startDate: form.startDate,
        endDate: form.endDate,
        midReviewNotes: form.notes || null,
        status: 'active',
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/probation-records'] });
        toast({ title: t('Probation record created', 'تم إنشاء سجل التجربة') });
        onClose();
        setForm({ employeeId: '', startDate: '', endDate: '', notes: '' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  const emps = empData?.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Probation Record', 'سجل تجربة جديد')}</DialogTitle>
          <DialogDescription>{t('Add a probation period for an employee', 'إضافة فترة تجربة لموظف')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={form.employeeId} onValueChange={v => set('employeeId', v)}>
            <SelectTrigger><SelectValue placeholder={t('Select Employee', 'اختر الموظف')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-muted-foreground mb-1 block">{t('Start Date', 'تاريخ البدء')}</label><Input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">{t('End Date', 'تاريخ الانتهاء')}</label><Input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} /></div>
          </div>
          <Textarea placeholder={t('Notes (optional)', 'ملاحظات (اختياري)')} value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{isPending ? t('Creating...', 'جارٍ الإنشاء...') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Record Review Dialog ──────────────────────────────────────────────────────
function RecordReviewDialog({ open, onClose, record }: { open: boolean; onClose: () => void; record: any }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutate, isPending } = useUpdateProbationRecord();
  const [outcome, setOutcome] = useState(record?.outcome ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [reviewDate, setReviewDate] = useState(record?.reviewDate ?? '');

  function handleSubmit() {
    if (!record) return;
    mutate({ id: record.id, data: { ...record, outcome: outcome || null, notes: notes || null, reviewDate: reviewDate || null, status: outcome === 'passed' ? 'completed' : record.status } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/probation-records'] });
        toast({ title: t('Review recorded', 'تم تسجيل المراجعة') });
        onClose();
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Record Review', 'تسجيل المراجعة')}</DialogTitle>
          <DialogDescription>{t('Record the probation review outcome', 'تسجيل نتيجة مراجعة التجربة')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">{t('Review Date', 'تاريخ المراجعة')}</label><Input type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)} /></div>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger><SelectValue placeholder={t('Outcome', 'النتيجة')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="passed">{t('Passed', 'اجتاز')}</SelectItem>
              <SelectItem value="failed">{t('Failed', 'فشل')}</SelectItem>
              <SelectItem value="extended">{t('Extended', 'ممتد')}</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder={t('Notes', 'ملاحظات')} value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Save', 'حفظ')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function Probation() {
  const { t } = useLanguage();
  const [showNew, setShowNew] = useState(false);
  const [reviewRecord, setReviewRecord] = useState<any>(null);

  const { data: probData, isLoading } = useListProbationRecords({ limit: 200 } as any);
  const records = probData?.data ?? [];

  const active = records.filter(r => r.status === 'active').length;
  const ending7 = records.filter(r => r.status === 'active' && daysRemaining(r.endDate) <= 7 && daysRemaining(r.endDate) >= 0).length;
  const completed = records.filter(r => r.status === 'completed').length;
  const total = records.length;

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clock className="w-6 h-6 text-amber-500" />
              {t('Probation', 'فترة التجربة')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{t('Track employee probation periods and reviews', 'تتبع فترات التجربة والمراجعات')}</p>
          </div>
          <Button onClick={() => setShowNew(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />{t('New Record', 'سجل جديد')}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label={t('Total', 'الإجمالي')} value={total} />
          <StatCard label={t('Active', 'نشط')} value={active} />
          <StatCard label={t('Ending in 7 days', 'ينتهي خلال 7 أيام')} value={ending7} sub={t('Action required', 'إجراء مطلوب')} />
          <StatCard label={t('Completed', 'مكتمل')} value={completed} />
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Employee ID', 'رقم الموظف')}</TableHead>
                <TableHead>{t('Start Date', 'تاريخ البدء')}</TableHead>
                <TableHead>{t('End Date', 'تاريخ الانتهاء')}</TableHead>
                <TableHead>{t('Days Remaining', 'الأيام المتبقية')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead>{t('Outcome', 'النتيجة')}</TableHead>
                <TableHead>{t('Actions', 'إجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('No probation records', 'لا توجد سجلات')}</TableCell></TableRow>
              ) : records.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">#{r.employeeId}</TableCell>
                  <TableCell>{fmtDate(r.startDate)}</TableCell>
                  <TableCell>{fmtDate(r.endDate)}</TableCell>
                  <TableCell><DaysRemainingBadge endDate={r.endDate} /></TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('capitalize text-xs',
                      r.status === 'completed' ? 'border-emerald-400 text-emerald-600' :
                        r.status === 'active' ? 'border-blue-400 text-blue-600' :
                          'border-gray-400 text-gray-500'
                    )}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className={cn('text-xs capitalize',
                      r.outcome === 'passed' ? 'text-emerald-600' :
                        r.outcome === 'failed' ? 'text-red-600' :
                          'text-muted-foreground'
                    )}>
                      {r.outcome ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setReviewRecord(r)}>
                      <FileEdit className="w-3 h-3 mr-1" />{t('Review', 'مراجعة')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <NewProbationDialog open={showNew} onClose={() => setShowNew(false)} />
      {reviewRecord && (
        <RecordReviewDialog
          open={!!reviewRecord}
          onClose={() => setReviewRecord(null)}
          record={reviewRecord}
        />
      )}
    </AnimatedPage>
  );
}
