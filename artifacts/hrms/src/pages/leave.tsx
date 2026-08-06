import { useState, useMemo, useRef, Fragment } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName, localFullName } from '@/lib/localise';
import { useAuth } from '@/hooks/use-auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListLeaveRequests, useListLeaveTypes, useListEmployees,
  useGetLeaveCalendar, useListPublicHolidays, useListDepartments,
  useCreateLeaveRequest, useSubmitLeaveRequest, useDecideLeaveRequest,
  useCancelLeaveRequest, useReturnToDuty, useRevokeLeaveRequest,
  useAddLeaveAttachment,
  useDeleteLeaveAttachment,
  getLeaveAttachment,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Plus, ChevronDown, ChevronRight, ChevronLeft,
  Calendar, Users, Clock, CheckCircle, FileText,
  ThumbsUp, ThumbsDown, XCircle, ArrowRightCircle,
  Paperclip, ShieldAlert, Undo2, Trash2,
} from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  under_review: 'bg-amber-100 text-amber-700 border-amber-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  revoked: 'bg-rose-100 text-rose-700 border-rose-200',
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const STATUS_LABELS: Record<string, [string, string]> = {
    draft:        ['Draft',        'مسودة'],
    submitted:    ['Submitted',    'مُقدَّم'],
    under_review: ['Under Review', 'قيد المراجعة'],
    approved:     ['Approved',     'موافق عليه'],
    rejected:     ['Rejected',     'مرفوض'],
    cancelled:    ['Cancelled',    'ملغى'],
    revoked:      ['Revoked',      'مسحوب'],
  };
  const [en, ar] = STATUS_LABELS[status] ?? [status.replace('_', ' '), status.replace('_', ' ')];
  return (
    <Badge variant="outline" className={cn('capitalize text-xs font-medium', STATUS_COLORS[status] ?? '')}>
      {t(en, ar)}
    </Badge>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── New Request Dialog ────────────────────────────────────────────────────────

interface NewRequestDialogProps {
  open: boolean;
  onClose: () => void;
}

function NewRequestDialog({ open, onClose }: NewRequestDialogProps) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { data: leaveTypes } = useListLeaveTypes();

  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [coveringEmployeeId, setCoveringEmployeeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const employees = empData?.data ?? [];

  const selectedLeaveType = useMemo(
    () => (leaveTypes ?? []).find(lt => String(lt.id) === leaveTypeId),
    [leaveTypes, leaveTypeId]
  );
  const requiresAttachment = selectedLeaveType?.requiresAttachment ?? false;

  const totalDays = useMemo(() => {
    if (!startDate || !endDate) return 1;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    return Math.max(1, Math.ceil((e - s) / 86400000) + 1);
  }, [startDate, endDate]);

  const createMut = useCreateLeaveRequest();
  const submitMut = useSubmitLeaveRequest();
  const addAttachmentMut = useAddLeaveAttachment();

  function resetForm() {
    setEmployeeId(''); setLeaveTypeId(''); setStartDate(''); setEndDate('');
    setHalfDay(false); setReason(''); setCoveringEmployeeId('');
    setAttachmentFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      toast({ title: t('Missing fields', 'حقول مفقودة'), variant: 'destructive' });
      return;
    }
    if (requiresAttachment && !attachmentFile) {
      toast({
        title: t('Medical certificate required', 'شهادة طبية مطلوبة'),
        description: t(
          'A medical certificate or supporting document must be attached for this leave type.',
          'يجب إرفاق شهادة طبية أو مستند داعم لهذا النوع من الإجازة.'
        ),
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      // 1. Create draft
      const created = await createMut.mutateAsync({
        data: {
          employeeId: Number(employeeId),
          leaveTypeId: Number(leaveTypeId),
          startDate,
          endDate,
          totalDays,
          halfDay,
          reasonEn: reason || null,
          coveringEmployeeId: coveringEmployeeId ? Number(coveringEmployeeId) : null,
        },
      });

      // 2. Upload attachment if provided
      if (attachmentFile) {
        const reader = new FileReader();
        const fileUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(attachmentFile);
        });
        await addAttachmentMut.mutateAsync({
          id: created.id,
          data: {
            fileName: attachmentFile.name,
            fileType: attachmentFile.type || null,
            fileSize: attachmentFile.size,
            fileUrl,
          },
        });
      }

      // 3. Submit
      await submitMut.mutateAsync({ id: created.id });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: t('Leave request submitted', 'تم تقديم طلب الإجازة') });
      resetForm();
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New Leave Request', 'طلب إجازة جديد')}</DialogTitle>
          <DialogDescription>{t('Fill in the details below', 'أدخل التفاصيل أدناه')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pe-1">
          {/* Employee */}
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Employee', 'الموظف')}</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder={t('Select employee', 'اختر موظفاً')} /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Leave Type */}
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Leave Type', 'نوع الإجازة')}</label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger><SelectValue placeholder={t('Select type', 'اختر النوع')} /></SelectTrigger>
              <SelectContent>
                {(leaveTypes ?? []).map(lt => (
                  <SelectItem key={lt.id} value={String(lt.id)}>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: lt.color }} />
                      {localName(lt.nameEn, lt.nameAr, lang)}
                      {lt.requiresAttachment && (
                        <span className="text-amber-600 text-[10px] font-medium">
                          {t('(cert required)', '(يتطلب شهادة)')}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Start Date', 'تاريخ البداية')}</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('End Date', 'تاريخ النهاية')}</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          {/* Days */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">{t('Days', 'الأيام')}</label>
              <Input value={totalDays} readOnly className="bg-muted" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox id="half" checked={halfDay} onCheckedChange={v => setHalfDay(!!v)} />
              <label htmlFor="half" className="text-sm">{t('Half Day', 'نصف يوم')}</label>
            </div>
          </div>
          {/* Reason */}
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Reason', 'السبب')}</label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={t('Optional reason…', 'السبب (اختياري)…')} />
          </div>
          {/* Medical Certificate — shown whenever requiresAttachment */}
          {requiresAttachment && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-700">
                <Paperclip className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {t('Medical Certificate Required', 'الشهادة الطبية مطلوبة')}
                </span>
              </div>
              <p className="text-xs text-amber-600">
                {t(
                  'Please attach a medical certificate or supporting document.',
                  'يرجى إرفاق شهادة طبية أو مستند داعم.'
                )}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="text-sm w-full"
                onChange={e => setAttachmentFile(e.target.files?.[0] ?? null)}
              />
              {attachmentFile && (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  {attachmentFile.name}
                </p>
              )}
            </div>
          )}
          {/* Covering Employee */}
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Covering Employee (optional)', 'الموظف البديل (اختياري)')}</label>
            <Select value={coveringEmployeeId} onValueChange={setCoveringEmployeeId}>
              <SelectTrigger><SelectValue placeholder={t('None', 'لا يوجد')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('None', 'لا يوجد')}</SelectItem>
                {employees.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? t('Submitting…', 'جاري الإرسال…') : t('Submit Request', 'إرسال الطلب')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Requests Tab ──────────────────────────────────────────────────────────────

function RequestsTab() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Server-verified permission keys from the user's role; the API enforces
  // the same check, this only hides buttons the user can't use.
  const canDecide = user?.permissions?.includes('approvals.decide') ?? false;
  const canRevoke = canDecide;

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [actioning, setActioning] = useState<number | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: number; startDate: string; endDate: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeNewEnd, setRevokeNewEnd] = useState('');
  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null);
  const [attachTargetId, setAttachTargetId] = useState<number | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const params = statusFilter !== 'all' ? { status: statusFilter } : undefined;
  const { data: requests, isLoading } = useListLeaveRequests(params);

  const decideMut = useDecideLeaveRequest();
  const cancelMut = useCancelLeaveRequest();
  const submitMut = useSubmitLeaveRequest();
  const returnMut = useReturnToDuty();
  const revokeMut = useRevokeLeaveRequest();
  const addAttachmentMut = useAddLeaveAttachment();
  const removeAttachmentMut = useDeleteLeaveAttachment();

  const filtered = useMemo(() => {
    const list = requests ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(r =>
      (r.employeeNameEn + ' ' + (r.employeeNameAr ?? '')).toLowerCase().includes(q) ||
      r.requestNumber.toLowerCase().includes(q)
    );
  }, [requests, search]);

  // stats
  const total = filtered.length;
  const pending = filtered.filter(r => ['submitted', 'under_review'].includes(r.status)).length;
  const thisMonth = new Date().getMonth();
  const thisYear = new Date().getFullYear();
  const approvedMonth = filtered.filter(r => {
    if (r.status !== 'approved') return false;
    const d = new Date(r.startDate);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;
  const daysUsed = filtered
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + parseFloat(r.totalDays), 0);

  async function handleDecide(id: number, stepNumber: number, decision: 'approve' | 'reject') {
    setActioning(id);
    try {
      await decideMut.mutateAsync({ id, data: { stepNumber, decision } });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: decision === 'approve' ? t('Approved', 'تمت الموافقة') : t('Rejected', 'تم الرفض') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }

  async function handleCancel(id: number) {
    setActioning(id);
    try {
      await cancelMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: t('Request cancelled', 'تم إلغاء الطلب') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }

  async function handleSubmit(id: number) {
    setActioning(id);
    try {
      await submitMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: t('Submitted', 'تم التقديم') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    if (!revokeReason.trim()) {
      toast({ title: t('Reason is required', 'السبب مطلوب'), variant: 'destructive' });
      return;
    }
    setActioning(revokeTarget.id);
    try {
      await revokeMut.mutateAsync({
        id: revokeTarget.id,
        data: { reason: revokeReason.trim(), newEndDate: revokeNewEnd || null },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rosters'] });
      toast({
        title: revokeNewEnd ? t('Leave shortened', 'تم تقصير الإجازة') : t('Leave revoked', 'تم إلغاء الإجازة'),
        description: t('Balance credited back and roster restored', 'تمت إعادة الرصيد واستعادة جدول المناوبات'),
      });
      setRevokeTarget(null);
      setRevokeReason('');
      setRevokeNewEnd('');
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }

  function startAttach(id: number) {
    setAttachTargetId(id);
    if (attachInputRef.current) {
      attachInputRef.current.value = '';
      attachInputRef.current.click();
    }
  }

  async function handleAttachFile(file: File | null) {
    if (!file || attachTargetId === null) return;
    const id = attachTargetId;
    setActioning(id);
    try {
      const reader = new FileReader();
      const fileUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await addAttachmentMut.mutateAsync({
        id,
        data: {
          fileName: file.name,
          fileType: file.type || null,
          fileSize: file.size,
          fileUrl,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: t('File attached', 'تم إرفاق الملف'), description: file.name });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
      setAttachTargetId(null);
    }
  }

  async function handleRemoveAttachment(leaveRequestId: number, attachmentId: number) {
    setActioning(leaveRequestId);
    try {
      await removeAttachmentMut.mutateAsync({ id: leaveRequestId, attachmentId });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: t('Attachment removed', 'تم حذف المرفق') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }

  async function handleReturn(id: number) {
    setActioning(id);
    try {
      const today = new Date().toISOString().split('T')[0];
      await returnMut.mutateAsync({ id, data: { returnDate: today } });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: t('Return to duty recorded', 'تم تسجيل العودة للعمل') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }


  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('Total Requests', 'إجمالي الطلبات'), value: total, icon: FileText, color: 'text-blue-600' },
          { label: t('Pending', 'قيد الانتظار'), value: pending, icon: Clock, color: 'text-amber-600' },
          { label: t('Approved This Month', 'موافق عليه هذا الشهر'), value: approvedMonth, icon: CheckCircle, color: 'text-emerald-600' },
          { label: t('Days Used', 'الأيام المستخدمة'), value: daysUsed.toFixed(1), icon: Calendar, color: 'text-violet-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={cn('w-8 h-8', s.color)} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Statuses', 'كل الحالات')}</SelectItem>
              {[
                ['draft',        t('Draft',        'مسودة')],
                ['submitted',    t('Submitted',    'مُقدَّم')],
                ['under_review', t('Under Review', 'قيد المراجعة')],
                ['approved',     t('Approved',     'موافق عليه')],
                ['rejected',     t('Rejected',     'مرفوض')],
                ['cancelled',    t('Cancelled',    'ملغى')],
                ['revoked',      t('Revoked',      'مسحوب')],
              ].map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
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
        <Button onClick={() => setNewDialog(true)}>
          <Plus className="w-4 h-4 me-1" />
          {t('New Request', 'طلب جديد')}
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>#</TableHead>
                <TableHead>{t('Request No', 'رقم الطلب')}</TableHead>
                <TableHead>{t('Employee', 'الموظف')}</TableHead>
                <TableHead>{t('Leave Type', 'نوع الإجازة')}</TableHead>
                <TableHead>{t('Dates', 'التواريخ')}</TableHead>
                <TableHead>{t('Days', 'الأيام')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead>{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : filtered.map((req, idx) => {
                    const expanded = expandedRow === req.id;
                    const busy = actioning === req.id;
                    const currentStep = (req as any).currentStepNumber ?? 1;
                    return (
                      <Fragment key={req.id}>
                        <TableRow
                          className={cn('cursor-pointer hover:bg-muted/50', expanded && 'bg-muted/30')}
                        >
                          <TableCell>
                            <button onClick={() => setExpandedRow(expanded ? null : req.id)} className="p-1 rounded hover:bg-muted">
                              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                          <TableCell className="font-mono text-xs">{req.requestNumber}</TableCell>
                          <TableCell>{localName(req.employeeNameEn, req.employeeNameAr, lang)}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: req.leaveTypeColor, color: req.leaveTypeColor }}
                            >
                              <span
                                className="w-2 h-2 rounded-full me-1 inline-block"
                                style={{ backgroundColor: req.leaveTypeColor }}
                              />
                              {localName(req.leaveTypeNameEn, req.leaveTypeNameAr, lang)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {fmtDate(req.startDate)} – {fmtDate(req.endDate)}
                          </TableCell>
                          <TableCell>{parseFloat(req.totalDays).toFixed(1)}</TableCell>
                          <TableCell><StatusBadge status={req.status} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {req.status === 'draft' && (
                                <>
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSubmit(req.id)}>
                                    {t('Submit', 'إرسال')}
                                  </Button>
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => startAttach(req.id)}>
                                    <Paperclip className="w-3 h-3 me-1" />
                                    {t('Attach file', 'إرفاق ملف')}
                                  </Button>
                                </>
                              )}
                              {['submitted', 'under_review'].includes(req.status) && canDecide && (
                                <>
                                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy}
                                    onClick={() => handleDecide(req.id, currentStep, 'approve')}>
                                    <ThumbsUp className="w-3 h-3 me-1" />
                                    {t('Approve', 'موافقة')}
                                  </Button>
                                  <Button size="sm" variant="destructive" disabled={busy}
                                    onClick={() => handleDecide(req.id, currentStep, 'reject')}>
                                    <ThumbsDown className="w-3 h-3 me-1" />
                                    {t('Reject', 'رفض')}
                                  </Button>
                                </>
                              )}
                              {req.status === 'approved' && canRevoke && (
                                <Button size="sm" variant="outline" className="text-rose-600 border-rose-200 hover:bg-rose-50" disabled={busy}
                                  onClick={() => setRevokeTarget({ id: req.id, startDate: req.startDate, endDate: req.endDate })}>
                                  <Undo2 className="w-3 h-3 mr-1" />
                                  {t('Revoke', 'سحب الموافقة')}
                                </Button>
                              )}
                              {req.status === 'approved' && !req.returnedToWork && (
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => handleReturn(req.id)}>
                                  <ArrowRightCircle className="w-3 h-3 me-1" />
                                  {t('Return', 'عودة')}
                                </Button>
                              )}
                              {['submitted', 'under_review'].includes(req.status) && (
                                <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busy}
                                  onClick={() => setCancelConfirmId(req.id)}>
                                  <XCircle className="w-3 h-3 me-1" />
                                  {t('Cancel', 'إلغاء')}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={9}>
                              <ApprovalStepsInline requestId={req.id} />
                              <AttachmentsInline
                                requestId={req.id}
                                attachments={(req as any).attachments ?? []}
                                isDraft={req.status === 'draft'}
                                onRemove={(attachmentId) => handleRemoveAttachment(req.id, attachmentId)}
                                busy={busy}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
              }
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {t('No leave requests found', 'لا توجد طلبات إجازة')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Hidden file input for attaching a certificate to an existing draft */}
      <input
        ref={attachInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={e => handleAttachFile(e.target.files?.[0] ?? null)}
      />

      <NewRequestDialog open={newDialog} onClose={() => setNewDialog(false)} />

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelConfirmId !== null} onOpenChange={open => { if (!open) setCancelConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Cancel Leave Request', 'إلغاء طلب الإجازة')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Are you sure you want to cancel this leave request? This action cannot be undone.', 'هل أنت متأكد من إلغاء طلب الإجازة هذا؟ لا يمكن التراجع عن هذا الإجراء.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('No, keep it', 'لا، احتفظ به')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (cancelConfirmId !== null) { handleCancel(cancelConfirmId); setCancelConfirmId(null); } }}
            >
              {t('Yes, cancel request', 'نعم، إلغاء الطلب')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) { setRevokeTarget(null); setRevokeReason(''); setRevokeNewEnd(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Revoke Approved Leave', 'سحب الموافقة على الإجازة')}</DialogTitle>
            <DialogDescription>
              {t(
                'Days will be credited back to the balance and roster days restored. Set a new end date to shorten the leave instead of revoking it fully.',
                'ستتم إعادة الأيام إلى الرصيد واستعادة أيام جدول المناوبات. حدد تاريخ انتهاء جديدًا لتقصير الإجازة بدلاً من إلغائها بالكامل.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Reason (required)', 'السبب (مطلوب)')}</label>
              <Textarea
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                placeholder={t('e.g. Employee returned early…', 'مثال: عاد الموظف مبكرًا…')}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('New end date (optional — leave empty to revoke fully)', 'تاريخ الانتهاء الجديد (اختياري — اتركه فارغًا للإلغاء الكامل)')}</label>
              <Input
                type="date"
                value={revokeNewEnd}
                min={revokeTarget?.startDate}
                max={revokeTarget?.endDate}
                onChange={e => setRevokeNewEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex-col items-start gap-2 sm:flex-row sm:items-center">
            <p className="text-xs text-slate-500 flex-1">{t("This action is audit-logged.", "هذا الإجراء مُسجَّل في سجل التدقيق.")}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setRevokeTarget(null); setRevokeReason(''); setRevokeNewEnd(''); }}>
                {t('Cancel', 'إلغاء')}
              </Button>
              <Button
                variant="destructive"
                disabled={actioning === revokeTarget?.id || !revokeReason.trim()}
                onClick={handleRevoke}
              >
                {actioning === revokeTarget?.id
                  ? t('Revoking…', 'جارٍ السحب…')
                  : revokeNewEnd ? t('Shorten Leave', 'تقصير الإجازة') : t('Revoke Fully', 'سحب بالكامل')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalStepsInline({ requestId }: { requestId: number }) {
  const { t } = useLanguage();
  const { data: detail, isLoading } = useListLeaveRequests();
  // Use the detail from list (steps embedded) — if not, show placeholder
  const req = (detail ?? []).find(r => r.id === requestId) as any;
  const steps: any[] = req?.steps ?? [];

  if (isLoading) return <Skeleton className="h-8 w-64" />;
  if (!steps.length) return <p className="text-xs text-muted-foreground py-2">{t('No approval steps available', 'لا توجد خطوات موافقة')}</p>;

  const statusDot: Record<string, string> = {
    pending: 'bg-gray-400',
    approved: 'bg-emerald-500',
    rejected: 'bg-red-500',
    delegated: 'bg-blue-400',
  };

  return (
    <div className="flex gap-4 py-2 flex-wrap">
      {steps.map((step: any) => (
        <div key={step.id} className="flex items-center gap-2 text-xs bg-background border rounded px-3 py-1.5">
          <span className="font-semibold text-muted-foreground">#{step.stepNumber}</span>
          <span className={cn('w-2.5 h-2.5 rounded-full', statusDot[step.status] ?? 'bg-gray-300')} />
          <span>{step.roleRequired ?? t('Reviewer', 'المراجع')}</span>
          {step.decidedAt && (
            <span className="text-muted-foreground">{fmtDate(step.decidedAt)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function AttachmentLink({ requestId, attachment }: { requestId: number; attachment: any }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleOpen() {
    setLoading(true);
    try {
      const full = await getLeaveAttachment(requestId, attachment.id);
      if (!full.fileUrl) {
        toast({ title: t('No file available', 'لا يوجد ملف'), variant: 'destructive' });
        return;
      }
      if (full.fileUrl.startsWith('data:')) {
        // Create a temporary link and trigger download
        const link = document.createElement('a');
        link.href = full.fileUrl;
        link.download = attachment.fileName;
        link.click();
      } else {
        window.open(full.fileUrl, '_blank', 'noreferrer');
      }
    } catch {
      toast({ title: t('Error loading file', 'خطأ في تحميل الملف'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleOpen}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs bg-background border rounded px-2.5 py-1.5 hover:bg-muted text-blue-600 disabled:opacity-50 disabled:cursor-wait"
    >
      <Paperclip className="w-3 h-3" />
      <span>{attachment.fileName}</span>
      {attachment.fileSize != null && (
        <span className="text-muted-foreground">({(attachment.fileSize / 1024).toFixed(0)} KB)</span>
      )}
    </button>
  );
}
function AttachmentsInline({
  requestId,
  attachments,
  isDraft = false,
  onRemove,
  busy = false,
}: {
  requestId: number;
  attachments: any[];
  isDraft?: boolean;
  onRemove?: (attachmentId: number) => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  if (!attachments.length) return null;
  return (
    <div className="flex gap-2 py-2 flex-wrap items-center">
      <span className="text-xs font-medium text-muted-foreground">{t('Attachments', 'المرفقات')}:</span>
      {attachments.map((a: any) => (
        <div key={a.id} className="flex items-center gap-1">
          <AttachmentLink requestId={requestId} attachment={a} />
          {isDraft && onRemove && (
            <button
              disabled={busy}
              onClick={() => onRemove(a.id)}
              title={t('Remove attachment', 'إزالة المرفق')}
              className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
function TeamQueueTab() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [deptFilter, setDeptFilter] = useState('all');
  const [actioning, setActioning] = useState<number | null>(null);

  const { data: requests, isLoading } = useListLeaveRequests();
  const { data: depts } = useListDepartments();
  const decideMut = useDecideLeaveRequest();

  const queue = useMemo(() => {
    return (requests ?? []).filter(r =>
      ['submitted', 'under_review'].includes(r.status) &&
      (deptFilter === 'all' || String(r.departmentId) === deptFilter)
    );
  }, [requests, deptFilter]);

  async function handleDecide(id: number, stepNumber: number, decision: 'approve' | 'reject') {
    setActioning(id);
    try {
      await decideMut.mutateAsync({ id, data: { stepNumber, decision } });
      queryClient.invalidateQueries({ queryKey: ['/api/leave-requests'] });
      toast({ title: decision === 'approve' ? t('Approved', 'تمت الموافقة') : t('Rejected', 'تم الرفض') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder={t('All Departments', 'كل الأقسام')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Departments', 'كل الأقسام')}</SelectItem>
            {(depts ?? []).map(d => (
              <SelectItem key={d.id} value={String(d.id)}>
                {localName(d.nameEn, d.nameAr, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="ms-2">{queue.length} {t('pending', 'معلق')}</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Employee', 'الموظف')}</TableHead>
                <TableHead>{t('Dept', 'القسم')}</TableHead>
                <TableHead>{t('Type', 'النوع')}</TableHead>
                <TableHead>{t('Dates', 'التواريخ')}</TableHead>
                <TableHead>{t('Days', 'الأيام')}</TableHead>
                <TableHead>{t('Current Step', 'الخطوة الحالية')}</TableHead>
                <TableHead>{t('Quick Actions', 'إجراءات سريعة')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : queue.map(req => {
                    const currentStep = (req as any).currentStepNumber ?? 1;
                    const busy = actioning === req.id;
                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{localName(req.employeeNameEn, req.employeeNameAr, lang)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {(req as any).departmentId ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{ borderColor: req.leaveTypeColor, color: req.leaveTypeColor }}
                          >
                            {localName(req.leaveTypeNameEn, req.leaveTypeNameAr, lang)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {fmtDate(req.startDate)} – {fmtDate(req.endDate)}
                        </TableCell>
                        <TableCell>{parseFloat(req.totalDays).toFixed(1)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{t('Step', 'خطوة')} {currentStep}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy}
                              onClick={() => handleDecide(req.id, currentStep, 'approve')}>
                              <ThumbsUp className="w-3 h-3 me-1" />
                              {t('Approve', 'موافقة')}
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busy}
                              onClick={() => handleDecide(req.id, currentStep, 'reject')}>
                              <ThumbsDown className="w-3 h-3 me-1" />
                              {t('Reject', 'رفض')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
              }
              {!isLoading && queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t('No pending requests in queue', 'لا توجد طلبات معلقة في القائمة')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Calendar Tab ──────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

function CalendarTab() {
  const { t, lang } = useLanguage();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const startDate = new Date(year, month, 1).toISOString().split('T')[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

  const { data: calEntries } = useGetLeaveCalendar({ startDate, endDate });
  const { data: holidays } = useListPublicHolidays({ year, scope: 'mine' });

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const monthName = new Date(year, month, 1).toLocaleString('en', { month: 'long' });
  const firstDOW = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // map date → entries
  const entriesByDate = useMemo(() => {
    const map: Record<string, typeof calEntries> = {};
    (calEntries ?? []).forEach(e => {
      const s = new Date(e.startDate);
      const end = new Date(e.endDate);
      for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split('T')[0];
        if (!map[key]) map[key] = [];
        map[key]!.push(e);
      }
    });
    return map;
  }, [calEntries]);

  // map date → holiday
  const holidayByDate = useMemo(() => {
    const map: Record<string, string> = {};
    (holidays ?? []).forEach(h => { map[h.date] = localName(h.nameEn, h.nameAr, lang); });
    return map;
  }, [holidays, lang]);

  // build cells array (nulls = pre-padding)
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDOW }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="space-y-4">
      {/* Navigator */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
        <h2 className="text-lg font-semibold">{monthName} {year}</h2>
        <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {/* Grid */}
      <div className="border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-7 bg-muted">
          {(lang === 'ar' ? DAY_NAMES_AR : DAY_NAMES).map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
          ))}
        </div>
        {/* Days */}
        <div className="grid grid-cols-7 border-t">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`pad-${i}`} className="min-h-[90px] border-b border-r bg-muted/20" />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEntries = entriesByDate[dateStr] ?? [];
            const holiday = holidayByDate[dateStr];
            const isToday = dateStr === now.toISOString().split('T')[0];

            return (
              <div
                key={dateStr}
                className={cn(
                  'min-h-[90px] border-b border-r p-1.5 text-sm',
                  holiday && 'bg-amber-50',
                  isToday && 'ring-2 ring-inset ring-blue-400'
                )}
                title={holiday}
              >
                <span className={cn(
                  'inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-medium mb-1',
                  isToday && 'bg-blue-500 text-white',
                )}>
                  {day}
                </span>
                {holiday && (
                  <div className="text-[10px] text-amber-700 font-medium truncate">{holiday}</div>
                )}
                <div className="space-y-0.5">
                  {dayEntries.slice(0, 3).map((e, ei) => (
                    <div
                      key={`${e.id}-${ei}`}
                      className="text-[10px] leading-tight px-1 rounded truncate text-white"
                      style={{ backgroundColor: e.leaveTypeColor || '#6b7280' }}
                      title={`${e.employeeNameEn} — ${e.leaveTypeNameEn}`}
                    >
                      {e.employeeNameEn.split(' ')[0]}
                    </div>
                  ))}
                  {dayEntries.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{dayEntries.length - 3} {t('more', 'أكثر')}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-500 inline-block" />
          {t('Approved', 'موافق عليه')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-400 inline-block" />
          {t('Under Review', 'قيد المراجعة')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" />
          {t('Public Holiday', 'عطلة رسمية')}
        </span>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LeavePage() {
  const { t } = useLanguage();

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
        <div className="flex items-center gap-3">
          <Calendar className="w-7 h-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">{t('Leave Management', 'إدارة الإجازات')}</h1>
            <p className="text-sm text-muted-foreground">{t('Manage leave requests and approvals', 'إدارة طلبات الإجازة والموافقات')}</p>
          </div>
        </div>

        <Tabs defaultValue="requests">
          <TabsList>
            <TabsTrigger value="requests">
              <FileText className="w-4 h-4 me-1.5" />
              {t('Requests', 'الطلبات')}
            </TabsTrigger>
            <TabsTrigger value="team">
              <Users className="w-4 h-4 me-1.5" />
              {t('Team Queue', 'قائمة الفريق')}
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <Calendar className="w-4 h-4 me-1.5" />
              {t('Calendar', 'التقويم')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="mt-4">
            <RequestsTab />
          </TabsContent>
          <TabsContent value="team" className="mt-4">
            <TeamQueueTab />
          </TabsContent>
          <TabsContent value="calendar" className="mt-4">
            <CalendarTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
