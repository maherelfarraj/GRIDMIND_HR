import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName, localFullName } from '@/lib/localise';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListLeaveTypes, useCreateLeaveType, useUpdateLeaveType, useDeleteLeaveType,
  useListPublicHolidays, useCreatePublicHoliday, useUpdatePublicHoliday, useDeletePublicHoliday,
  useListLeaveDelegations, useCreateLeaveDelegation, useUpdateLeaveDelegation, useDeleteLeaveDelegation,
  useListEmployees,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2, Settings, CalendarRange, Users2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { LeaveType, LeaveTypeInput, PublicHoliday, PublicHolidayInput, LeaveDelegation } from '@workspace/api-client-react';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Leave Types Tab ───────────────────────────────────────────────────────────

const defaultLeaveTypeForm: LeaveTypeInput = {
  codeEn: '',
  nameEn: '',
  nameAr: '',
  descriptionEn: null,
  descriptionAr: null,
  category: 'annual',
  defaultDaysPerYear: 21,
  accrualFrequency: 'monthly',
  accrualAmount: '1.75',
  maxCarryoverDays: 0,
  requiresApproval: true,
  requiresAttachment: false,
  minAdvanceNoticeDays: 1,
  maxConsecutiveDays: null,
  applicableToGender: null,
  isActive: true,
  color: '#3b82f6',
};

interface LeaveTypeDialogProps {
  open: boolean;
  editing: LeaveType | null;
  onClose: () => void;
}

function LeaveTypeDialog({ open, editing, onClose }: LeaveTypeDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMut = useCreateLeaveType();
  const updateMut = useUpdateLeaveType();

  const initial: LeaveTypeInput = editing
    ? {
        codeEn: editing.codeEn,
        nameEn: editing.nameEn,
        nameAr: editing.nameAr,
        descriptionEn: editing.descriptionEn ?? null,
        descriptionAr: editing.descriptionAr ?? null,
        category: editing.category,
        defaultDaysPerYear: editing.defaultDaysPerYear,
        accrualFrequency: editing.accrualFrequency,
        accrualAmount: editing.accrualAmount,
        maxCarryoverDays: editing.maxCarryoverDays,
        requiresApproval: editing.requiresApproval,
        requiresAttachment: editing.requiresAttachment,
        minAdvanceNoticeDays: editing.minAdvanceNoticeDays,
        maxConsecutiveDays: editing.maxConsecutiveDays ?? null,
        applicableToGender: editing.applicableToGender ?? null,
        isActive: editing.isActive,
        color: editing.color,
      }
    : defaultLeaveTypeForm;

  const [form, setForm] = useState<LeaveTypeInput>(initial);
  const [saving, setSaving] = useState(false);

  useMemo(() => { setForm(initial); }, [editing?.id]);

  function field<K extends keyof LeaveTypeInput>(key: K, val: LeaveTypeInput[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    if (!form.codeEn || !form.nameEn || !form.nameAr) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: form });
      } else {
        await createMut.mutateAsync({ data: form });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/leave-types'] });
      toast({ title: editing ? t('Leave type updated', 'تم تحديث نوع الإجازة') : t('Leave type created', 'تم إنشاء نوع الإجازة') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('Edit Leave Type', 'تعديل نوع الإجازة') : t('Add Leave Type', 'إضافة نوع إجازة')}
          </DialogTitle>
          <DialogDescription>{t('Configure leave type details', 'إعداد تفاصيل نوع الإجازة')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Code', 'الرمز')} *</label>
            <Input value={form.codeEn} onChange={e => field('codeEn', e.target.value)} placeholder="ANNUAL" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Color', 'اللون')}</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={form.color ?? '#3b82f6'} onChange={e => field('color', e.target.value)}
                className="w-9 h-9 cursor-pointer rounded border" />
              <Input value={form.color ?? '#3b82f6'} onChange={e => field('color', e.target.value)} className="flex-1" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Name (EN)', 'الاسم (إنجليزي)')} *</label>
            <Input value={form.nameEn} onChange={e => field('nameEn', e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Name (AR)', 'الاسم (عربي)')} *</label>
            <Input value={form.nameAr} onChange={e => field('nameAr', e.target.value)} dir="rtl" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Category', 'الفئة')}</label>
            <Select value={form.category ?? 'annual'} onValueChange={v => field('category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['annual', 'sick', 'maternity', 'paternity', 'emergency', 'unpaid', 'other'].map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Days / Year', 'أيام / سنة')}</label>
            <Input type="number" value={form.defaultDaysPerYear ?? 21}
              onChange={e => field('defaultDaysPerYear', Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Accrual Frequency', 'تكرار الاستحقاق')}</label>
            <Select value={form.accrualFrequency ?? 'monthly'} onValueChange={v => field('accrualFrequency', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['monthly', 'quarterly', 'annually', 'none'].map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Accrual Amount', 'مقدار الاستحقاق')}</label>
            <Input type="number" step="0.01" value={form.accrualAmount ?? '1.75'}
              onChange={e => field('accrualAmount', e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Max Carryover Days', 'أقصى أيام مرحّلة')}</label>
            <Input type="number" value={form.maxCarryoverDays ?? 0}
              onChange={e => field('maxCarryoverDays', Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Min Notice Days', 'أيام الإشعار المسبق')}</label>
            <Input type="number" value={form.minAdvanceNoticeDays ?? 1}
              onChange={e => field('minAdvanceNoticeDays', Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Max Consecutive Days', 'أقصى أيام متتالية')}</label>
            <Input type="number" value={form.maxConsecutiveDays ?? ''}
              placeholder={t('Unlimited', 'غير محدود')}
              onChange={e => field('maxConsecutiveDays', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Applicable To Gender', 'يطبق على الجنس')}</label>
            <Select value={form.applicableToGender ?? 'all'} onValueChange={v => field('applicableToGender', v === 'all' ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All', 'الكل')}</SelectItem>
                <SelectItem value="male">{t('Male', 'ذكر')}</SelectItem>
                <SelectItem value="female">{t('Female', 'أنثى')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1 block">{t('Description (EN)', 'الوصف (إنجليزي)')}</label>
            <Textarea value={form.descriptionEn ?? ''} onChange={e => field('descriptionEn', e.target.value || null)} rows={2} />
          </div>
          <div className="col-span-2 flex gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!!form.requiresApproval} onCheckedChange={v => field('requiresApproval', !!v)} />
              <span className="text-sm">{t('Requires Approval', 'يتطلب موافقة')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!!form.requiresAttachment} onCheckedChange={v => field('requiresAttachment', !!v)} />
              <span className="text-sm">{t('Requires Attachment', 'يتطلب مرفق')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!!form.isActive} onCheckedChange={v => field('isActive', !!v)} />
              <span className="text-sm">{t('Active', 'نشط')}</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Save', 'حفظ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTypesTab() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const deleteMut = useDeleteLeaveType();

  const { data: leaveTypes, isLoading } = useListLeaveTypes();

  async function handleDelete(id: number) {
    if (!confirm(t('Delete this leave type?', 'حذف نوع الإجازة؟'))) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-types'] });
      toast({ title: t('Deleted', 'تم الحذف') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setDialog(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          {t('Add Leave Type', 'إضافة نوع إجازة')}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(leaveTypes ?? []).map(lt => (
            <Card
              key={lt.id}
              className={cn('relative overflow-hidden border-l-4 transition-shadow hover:shadow-md', !lt.isActive && 'opacity-60')}
              style={{ borderLeftColor: lt.color }}
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className="font-mono text-xs" style={{ color: lt.color, borderColor: lt.color }}>
                        {lt.codeEn}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">{lt.category}</Badge>
                      <Badge
                        variant="outline"
                        className={cn('text-xs', lt.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}
                      >
                        {lt.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                      </Badge>
                    </div>
                    <CardTitle className="text-base leading-tight">
                      {localName(lt.nameEn, lt.nameAr, lang)}
                    </CardTitle>
                    {lang !== 'ar' && lt.nameAr && (
                      <p className="text-xs text-muted-foreground mt-0.5" dir="rtl">{lt.nameAr}</p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">{t('Days/Year', 'أيام/سنة')}</span>
                  <span className="font-medium">{lt.defaultDaysPerYear}</span>
                  <span className="text-muted-foreground">{t('Accrual', 'الاستحقاق')}</span>
                  <span className="font-medium">{lt.accrualFrequency} × {parseFloat(lt.accrualAmount).toFixed(2)}</span>
                  <span className="text-muted-foreground">{t('Max Carryover', 'أقصى مرحّل')}</span>
                  <span className="font-medium">{lt.maxCarryoverDays} {t('days', 'أيام')}</span>
                  <span className="text-muted-foreground">{t('Min Notice', 'إشعار مسبق')}</span>
                  <span className="font-medium">{lt.minAdvanceNoticeDays} {t('days', 'أيام')}</span>
                </div>
                <div className="flex gap-1.5 flex-wrap pt-1">
                  {lt.requiresAttachment && (
                    <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                      {t('Attachment Required', 'مرفق مطلوب')}
                    </Badge>
                  )}
                  {lt.applicableToGender && lt.applicableToGender !== 'all' && (
                    <Badge variant="outline" className="text-xs text-violet-700 border-violet-300 bg-violet-50">
                      {lt.applicableToGender}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="flex-1"
                    onClick={() => { setEditing(lt); setDialog(true); }}>
                    <Pencil className="w-3 h-3 mr-1" />
                    {t('Edit', 'تعديل')}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                    onClick={() => handleDelete(lt.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LeaveTypeDialog
        open={dialog}
        editing={editing}
        onClose={() => { setDialog(false); setEditing(null); }}
      />
    </div>
  );
}

// ─── Public Holidays Tab ───────────────────────────────────────────────────────

const defaultHolidayForm: PublicHolidayInput = {
  nameEn: '',
  nameAr: '',
  date: '',
  year: new Date().getFullYear(),
  isRecurring: false,
  applicableTo: 'all',
  notes: null,
};

interface HolidayDialogProps {
  open: boolean;
  editing: PublicHoliday | null;
  year: number;
  onClose: () => void;
}

function HolidayDialog({ open, editing, year, onClose }: HolidayDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMut = useCreatePublicHoliday();
  const updateMut = useUpdatePublicHoliday();

  const initial: PublicHolidayInput = editing
    ? {
        nameEn: editing.nameEn,
        nameAr: editing.nameAr,
        date: editing.date,
        year: editing.year,
        isRecurring: editing.isRecurring,
        applicableTo: editing.applicableTo,
        notes: editing.notes ?? null,
      }
    : { ...defaultHolidayForm, year };

  const [form, setForm] = useState<PublicHolidayInput>(initial);
  const [saving, setSaving] = useState(false);

  useMemo(() => { setForm(editing ? {
    nameEn: editing.nameEn, nameAr: editing.nameAr, date: editing.date,
    year: editing.year, isRecurring: editing.isRecurring, applicableTo: editing.applicableTo,
    notes: editing.notes ?? null,
  } : { ...defaultHolidayForm, year }); }, [editing?.id, year]);

  function field<K extends keyof PublicHolidayInput>(key: K, val: PublicHolidayInput[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    if (!form.nameEn || !form.date) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: form });
      } else {
        await createMut.mutateAsync({ data: form });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/public-holidays'] });
      toast({ title: editing ? t('Holiday updated', 'تم تحديث العطلة') : t('Holiday created', 'تم إنشاء العطلة') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('Edit Holiday', 'تعديل العطلة') : t('Add Holiday', 'إضافة عطلة')}
          </DialogTitle>
          <DialogDescription>{t('Configure public holiday', 'إعداد العطلة الرسمية')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Name (EN)', 'الاسم (إنجليزي)')} *</label>
            <Input value={form.nameEn} onChange={e => field('nameEn', e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Name (AR)', 'الاسم (عربي)')}</label>
            <Input value={form.nameAr} onChange={e => field('nameAr', e.target.value)} dir="rtl" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Date', 'التاريخ')} *</label>
            <Input type="date" value={form.date} onChange={e => {
              field('date', e.target.value);
              if (e.target.value) field('year', new Date(e.target.value).getFullYear());
            }} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Applicable To', 'ينطبق على')}</label>
            <Select value={form.applicableTo ?? 'all'} onValueChange={v => field('applicableTo', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All', 'الكل')}</SelectItem>
                <SelectItem value="civilian">{t('Civilian', 'مدني')}</SelectItem>
                <SelectItem value="military">{t('Military', 'عسكري')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Notes', 'ملاحظات')}</label>
            <Textarea value={form.notes ?? ''} onChange={e => field('notes', e.target.value || null)} rows={2} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={!!form.isRecurring} onCheckedChange={v => field('isRecurring', !!v)} />
            <span className="text-sm">{t('Recurring Annually', 'متكرر سنوياً')}</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Save', 'حفظ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublicHolidaysTab() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [yearFilter, setYearFilter] = useState(2026);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<PublicHoliday | null>(null);
  const deleteMut = useDeletePublicHoliday();

  const { data: holidays, isLoading } = useListPublicHolidays({ year: yearFilter });

  async function handleDelete(id: number) {
    if (!confirm(t('Delete this holiday?', 'حذف هذه العطلة؟'))) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/public-holidays'] });
      toast({ title: t('Deleted', 'تم الحذف') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Select value={String(yearFilter)} onValueChange={v => setYearFilter(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[2024, 2025, 2026, 2027].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditing(null); setDialog(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          {t('Add Holiday', 'إضافة عطلة')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Date', 'التاريخ')}</TableHead>
                <TableHead>{t('Name (EN)', 'الاسم (إنجليزي)')}</TableHead>
                <TableHead>{t('Name (AR)', 'الاسم (عربي)')}</TableHead>
                <TableHead>{t('Recurring', 'متكرر')}</TableHead>
                <TableHead>{t('Applicable To', 'ينطبق على')}</TableHead>
                <TableHead>{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : (holidays ?? []).map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{fmtDate(h.date)}</TableCell>
                      <TableCell>{h.nameEn}</TableCell>
                      <TableCell dir="rtl">{h.nameAr}</TableCell>
                      <TableCell>
                        {h.isRecurring
                          ? <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">{t('Recurring', 'متكرر')}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{h.applicableTo}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setEditing(h); setDialog(true); }}>
                            <Pencil className="w-3 h-3 mr-1" />
                            {t('Edit', 'تعديل')}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(h.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
              }
              {!isLoading && (holidays ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t('No holidays for this year', 'لا توجد عطل لهذا العام')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <HolidayDialog
        open={dialog}
        editing={editing}
        year={yearFilter}
        onClose={() => { setDialog(false); setEditing(null); }}
      />
    </div>
  );
}

// ─── Delegations Tab ───────────────────────────────────────────────────────────

interface DelegationDialogProps {
  open: boolean;
  onClose: () => void;
}

function DelegationDialog({ open, onClose }: DelegationDialogProps) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMut = useCreateLeaveDelegation();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const employees = empData?.data ?? [];

  const [delegatorId, setDelegatorId] = useState('');
  const [delegateeId, setDelegateeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!delegatorId || !delegateeId || !startDate || !endDate) {
      toast({ title: t('Missing fields', 'حقول مفقودة'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createMut.mutateAsync({
        data: {
          delegatorEmployeeId: Number(delegatorId),
          delegateeEmployeeId: Number(delegateeId),
          startDate,
          endDate,
          reason: reason || null,
          isActive: true,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-delegations'] });
      toast({ title: t('Delegation created', 'تم إنشاء التفويض') });
      setDelegatorId(''); setDelegateeId(''); setStartDate(''); setEndDate(''); setReason('');
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add Delegation', 'إضافة تفويض')}</DialogTitle>
          <DialogDescription>{t('Delegate leave approval authority', 'تفويض صلاحية الموافقة على الإجازات')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Delegator', 'المفوِّض')}</label>
            <Select value={delegatorId} onValueChange={setDelegatorId}>
              <SelectTrigger><SelectValue placeholder={t('Select employee', 'اختر موظفاً')} /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>{localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Delegatee', 'المفوَّض إليه')}</label>
            <Select value={delegateeId} onValueChange={setDelegateeId}>
              <SelectTrigger><SelectValue placeholder={t('Select employee', 'اختر موظفاً')} /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>{localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Start Date', 'تاريخ البداية')}</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('End Date', 'تاريخ النهاية')}</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Reason', 'السبب')}</label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder={t('Optional reason…', 'السبب (اختياري)…')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DelegationsTab() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const updateMut = useUpdateLeaveDelegation();
  const deleteMut = useDeleteLeaveDelegation();

  const { data: delegations, isLoading } = useListLeaveDelegations();

  async function handleToggle(d: LeaveDelegation) {
    try {
      await updateMut.mutateAsync({
        id: d.id,
        data: {
          delegatorEmployeeId: d.delegatorEmployeeId,
          delegateeEmployeeId: d.delegateeEmployeeId,
          startDate: d.startDate,
          endDate: d.endDate,
          reason: d.reason ?? null,
          isActive: !d.isActive,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-delegations'] });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t('Delete this delegation?', 'حذف هذا التفويض؟'))) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-delegations'] });
      toast({ title: t('Deleted', 'تم الحذف') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialog(true)}>
          <Plus className="w-4 h-4 mr-1" />
          {t('Add Delegation', 'إضافة تفويض')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Delegator', 'المفوِّض')}</TableHead>
                <TableHead>{t('Delegatee', 'المفوَّض إليه')}</TableHead>
                <TableHead>{t('Period', 'الفترة')}</TableHead>
                <TableHead>{t('Reason', 'السبب')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead>{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : (delegations ?? []).map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.delegatorNameEn ?? `#${d.delegatorEmployeeId}`}</TableCell>
                      <TableCell>{d.delegateeNameEn ?? `#${d.delegateeEmployeeId}`}</TableCell>
                      <TableCell className="text-sm">
                        {fmtDate(d.startDate)} – {fmtDate(d.endDate)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                        {d.reason ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('text-xs', d.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-gray-100 text-gray-500 border-gray-200')}
                        >
                          {d.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleToggle(d)}>
                            {d.isActive
                              ? <><ToggleRight className="w-3 h-3 mr-1 text-emerald-600" />{t('Deactivate', 'تعطيل')}</>
                              : <><ToggleLeft className="w-3 h-3 mr-1" />{t('Activate', 'تفعيل')}</>
                            }
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(d.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
              }
              {!isLoading && (delegations ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t('No delegations found', 'لا توجد تفويضات')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DelegationDialog open={dialog} onClose={() => setDialog(false)} />
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LeaveConfigPage() {
  const { t } = useLanguage();

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
        <div className="flex items-center gap-3">
          <Settings className="w-7 h-7 text-slate-600" />
          <div>
            <h1 className="text-2xl font-bold">{t('Leave Configuration', 'إعدادات الإجازات')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('Manage leave types, public holidays, and delegations', 'إدارة أنواع الإجازات والعطل الرسمية والتفويضات')}
            </p>
          </div>
        </div>

        <Tabs defaultValue="types">
          <TabsList>
            <TabsTrigger value="types">
              <Settings className="w-4 h-4 mr-1.5" />
              {t('Leave Types', 'أنواع الإجازات')}
            </TabsTrigger>
            <TabsTrigger value="holidays">
              <CalendarRange className="w-4 h-4 mr-1.5" />
              {t('Public Holidays', 'العطل الرسمية')}
            </TabsTrigger>
            <TabsTrigger value="delegations">
              <Users2 className="w-4 h-4 mr-1.5" />
              {t('Delegations', 'التفويضات')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="types" className="mt-4">
            <LeaveTypesTab />
          </TabsContent>
          <TabsContent value="holidays" className="mt-4">
            <PublicHolidaysTab />
          </TabsContent>
          <TabsContent value="delegations" className="mt-4">
            <DelegationsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
