import { useState } from 'react';
import { useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListJobRequisitions,
  useCreateJobRequisition,
  useListJobPostings,
  usePublishJobPosting,
  useCloseJobPosting,
  useListApplications,
  useListDepartments,
  useListEmployees,
  type Employee,
  type Department,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Briefcase, Plus, Search, Send, X, Users, CheckCircle, Clock, Filter,
} from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const REQ_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  in_review: 'bg-amber-100 text-amber-700 border-amber-200',
  filled: 'bg-blue-100 text-blue-700 border-blue-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

const APP_STATUS_COLORS: Record<string, string> = {
  applied: 'bg-blue-100 text-blue-700',
  shortlisted: 'bg-amber-100 text-amber-700',
  interview: 'bg-purple-100 text-purple-700',
  offer_sent: 'bg-teal-100 text-teal-700',
  hired: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-500',
};

// ─── New Requisition Dialog ────────────────────────────────────────────────────

function NewRequisitionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: deptData } = useListDepartments();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { mutate, isPending } = useCreateJobRequisition();

  const [form, setForm] = useState({
    title: '', departmentId: '', requestedBy: '', numberOfPositions: '1',
    justification: '', priority: 'medium',
  });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit() {
    if (!form.title || !form.departmentId || !form.requestedBy) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        title: form.title,
        departmentId: parseInt(form.departmentId),
        requestedBy: parseInt(form.requestedBy),
        numberOfPositions: parseInt(form.numberOfPositions) || 1,
        justification: form.justification || null,
        priority: form.priority,
        status: 'draft',
        budgetApproved: false,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/job-requisitions'] });
        toast({ title: t('Requisition created', 'تم إنشاء الطلب') });
        onClose();
        setForm({ title: '', departmentId: '', requestedBy: '', numberOfPositions: '1', justification: '', priority: 'medium' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  const depts: Department[] = Array.isArray(deptData) ? (deptData as Department[]) : [];
  const empList = empData as { data?: Employee[] } | undefined;
  const emps: Employee[] = empList?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New Requisition', 'طلب توظيف جديد')}</DialogTitle>
          <DialogDescription>{t('Create a new job requisition', 'إنشاء طلب توظيف جديد')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder={t('Job Title', 'المسمى الوظيفي')} value={form.title} onChange={e => set('title', e.target.value)} />
          <Select value={form.departmentId} onValueChange={v => set('departmentId', v)}>
            <SelectTrigger><SelectValue placeholder={t('Department', 'الإدارة')} /></SelectTrigger>
            <SelectContent>{depts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.nameEn}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.requestedBy} onValueChange={v => set('requestedBy', v)}>
            <SelectTrigger><SelectValue placeholder={t('Requested By', 'مقدم الطلب')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" min="1" placeholder={t('No. of Positions', 'عدد المناصب')} value={form.numberOfPositions} onChange={e => set('numberOfPositions', e.target.value)} />
          <Select value={form.priority} onValueChange={v => set('priority', v)}>
            <SelectTrigger><SelectValue placeholder={t('Priority', 'الأولوية')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">{t('Low', 'منخفض')}</SelectItem>
              <SelectItem value="medium">{t('Medium', 'متوسط')}</SelectItem>
              <SelectItem value="high">{t('High', 'عالي')}</SelectItem>
              <SelectItem value="urgent">{t('Urgent', 'عاجل')}</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder={t('Justification', 'المبرر')} value={form.justification} onChange={e => set('justification', e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? t('Creating...', 'جارٍ الإنشاء...') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function Recruitment() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [appStageFilter, setAppStageFilter] = useState('all');
  const [showNewReq, setShowNewReq] = useState(false);

  const { data: reqData, isLoading: reqLoading } = useListJobRequisitions({ limit: 200 } as any);
  const { data: postData, isLoading: postLoading } = useListJobPostings({ limit: 200 } as any);
  const { data: appData, isLoading: appLoading } = useListApplications({ limit: 200 } as any);

  const { mutate: publish } = usePublishJobPosting();
  const { mutate: close } = useCloseJobPosting();

  const requisitions = reqData?.data ?? [];
  const postings = postData?.data ?? [];
  const applications = appData?.data ?? [];

  // Stat cards
  const total = requisitions.length;
  const approved = requisitions.filter(r => r.status === 'approved').length;
  const inReview = requisitions.filter(r => r.status === 'in_review').length;
  const filled = requisitions.filter(r => r.status === 'filled').length;

  const filteredReqs = requisitions.filter(r => {
    const matchSearch = !search || (r.jobTitleEn ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const filteredApps = applications.filter(a =>
    appStageFilter === 'all' || a.status === appStageFilter
  );

  function handlePublish(id: number) {
    publish({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/job-postings'] }); toast({ title: t('Posted', 'تم النشر') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  function handleClose(id: number) {
    close({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/job-postings'] }); toast({ title: t('Closed', 'تم الإغلاق') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-amber-500" />
              {t('Recruitment', 'التوظيف')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{t('Manage requisitions, postings and applications', 'إدارة الطلبات والإعلانات والتقديمات')}</p>
          </div>
        </div>

        <Tabs defaultValue="requisitions">
          <TabsList className="mb-4">
            <TabsTrigger value="requisitions">{t('Requisitions', 'طلبات التوظيف')}</TabsTrigger>
            <TabsTrigger value="postings">{t('Job Postings', 'الإعلانات')}</TabsTrigger>
            <TabsTrigger value="applications">{t('Applications', 'التقديمات')}</TabsTrigger>
          </TabsList>

          {/* ── Requisitions Tab ── */}
          <TabsContent value="requisitions" className="space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: t('Total', 'الإجمالي'), value: total, icon: Briefcase, color: 'text-blue-500' },
                { label: t('Approved', 'معتمد'), value: approved, icon: CheckCircle, color: 'text-emerald-500' },
                { label: t('In Review', 'قيد المراجعة'), value: inReview, icon: Clock, color: 'text-amber-500' },
                { label: t('Filled', 'مكتمل'), value: filled, icon: Users, color: 'text-purple-500' },
              ].map(s => (
                <Card key={s.label}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-2xl font-bold">{s.value}</p>
                      </div>
                      <s.icon className={cn('w-8 h-8', s.color)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Filters + new button */}
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="flex gap-2 flex-wrap">
                {['all', 'draft', 'in_review', 'approved', 'filled', 'cancelled'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                      statusFilter === s
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {s === 'all' ? t('All', 'الكل') : s.replace('_', ' ')}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-8 w-52" placeholder={t('Search...', 'بحث...')} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Button onClick={() => setShowNewReq(true)} size="sm">
                  <Plus className="w-4 h-4 mr-1" />{t('New Requisition', 'طلب جديد')}
                </Button>
              </div>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Title', 'المسمى')}</TableHead>
                    <TableHead>{t('Positions', 'المناصب')}</TableHead>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Target Start', 'تاريخ البدء المستهدف')}</TableHead>
                    <TableHead>{t('Created', 'تاريخ الإنشاء')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reqLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                  ) : filteredReqs.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('No requisitions found', 'لا توجد طلبات')}</TableCell></TableRow>
                  ) : filteredReqs.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.jobTitleEn ?? '—'}</TableCell>
                      <TableCell>{r.headcount ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {r.requisitionType?.replace('_', ' ') ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs', REQ_STATUS_COLORS[r.status] ?? '')}>
                          {r.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(r.targetStartDate)}</TableCell>
                      <TableCell>{fmtDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* ── Job Postings Tab ── */}
          <TabsContent value="postings" className="space-y-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Title', 'المسمى')}</TableHead>
                    <TableHead>{t('Visibility', 'الظهور')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Posted', 'تاريخ النشر')}</TableHead>
                    <TableHead>{t('Closing', 'تاريخ الإغلاق')}</TableHead>
                    <TableHead>{t('Actions', 'إجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {postLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                  ) : postings.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('No postings found', 'لا توجد إعلانات')}</TableCell></TableRow>
                  ) : postings.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.titleEn ?? '—'}</TableCell>
                      <TableCell className="capitalize">{p.visibility ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          p.status === 'published' ? 'border-emerald-400 text-emerald-600' :
                            p.status === 'closed' ? 'border-red-400 text-red-600' :
                              'border-amber-400 text-amber-600'
                        )}>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(p.publishedAt)}</TableCell>
                      <TableCell>{fmtDate(p.closingDate)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {p.status !== 'published' && p.status !== 'closed' && (
                            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400 hover:bg-emerald-50" onClick={() => handlePublish(p.id)}>
                              <Send className="w-3 h-3 mr-1" />{t('Publish', 'نشر')}
                            </Button>
                          )}
                          {p.status === 'published' && (
                            <Button size="sm" variant="outline" className="text-red-600 border-red-400 hover:bg-red-50" onClick={() => handleClose(p.id)}>
                              <X className="w-3 h-3 mr-1" />{t('Close', 'إغلاق')}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* ── Applications Tab ── */}
          <TabsContent value="applications" className="space-y-4">
            {/* Stage filter */}
            <div className="flex gap-2 flex-wrap">
              {['all', 'applied', 'shortlisted', 'interview', 'offer_sent', 'hired', 'rejected'].map(s => (
                <button
                  key={s}
                  onClick={() => setAppStageFilter(s)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    appStageFilter === s
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {s === 'all' ? t('All', 'الكل') : s.replace('_', ' ')}
                </button>
              ))}
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Applicant ID', 'رقم المتقدم')}</TableHead>
                    <TableHead>{t('Posting ID', 'رقم الإعلان')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Applied', 'تاريخ التقديم')}</TableHead>
                    <TableHead>{t('View', 'عرض')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                  ) : filteredApps.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('No applications found', 'لا توجد تقديمات')}</TableCell></TableRow>
                  ) : filteredApps.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>#{a.applicantId}</TableCell>
                      <TableCell>#{a.jobPostingId}</TableCell>
                      <TableCell>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', APP_STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-700')}>
                          {a.status.replace('_', ' ')}
                        </span>
                      </TableCell>
                      <TableCell>{fmtDate(a.appliedAt)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => navigate(`/recruitment/applications/${a.id}`)}>
                          {t('View', 'عرض')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <NewRequisitionDialog open={showNewReq} onClose={() => setShowNewReq(false)} />
    </AnimatedPage>
  );
}
