import { useState } from 'react';
import { useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import {
  useGetEmployee,
  getGetEmployeeQueryKey,
  useListLeaveRequests,
  getListLeaveRequestsQueryKey,
  useListLeaveBalances,
  getListLeaveBalancesQueryKey,
  useListPayrollRuns,
  useListEmployeeRequests,
  getListEmployeeRequestsQueryKey,
  useCreateEmployeeRequest,
  useListAnnouncements,
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
import { User, CalendarOff, Receipt, FileText, Bell, FileDown } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── New Request Dialog ────────────────────────────────────────────────────────
function NewRequestDialog({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId: number }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutate, isPending } = useCreateEmployeeRequest();
  const [form, setForm] = useState({ requestType: '', subject: '', description: '', priority: 'normal' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit() {
    if (!form.requestType || !form.subject) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        employeeId,
        requestType: form.requestType,
        titleEn: form.subject,
        descriptionEn: form.description || null,
        urgency: form.priority,
        status: 'open',
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/employee-requests'] });
        toast({ title: t('Request submitted', 'تم تقديم الطلب') });
        onClose();
        setForm({ requestType: '', subject: '', description: '', priority: 'normal' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Request', 'طلب جديد')}</DialogTitle>
          <DialogDescription>{t('Submit a request to HR', 'تقديم طلب إلى الموارد البشرية')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={form.requestType} onValueChange={v => set('requestType', v)}>
            <SelectTrigger><SelectValue placeholder={t('Request Type', 'نوع الطلب')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="document">{t('Document Request', 'طلب وثيقة')}</SelectItem>
              <SelectItem value="clarification">{t('Clarification', 'استفسار')}</SelectItem>
              <SelectItem value="complaint">{t('Complaint', 'شكوى')}</SelectItem>
              <SelectItem value="other">{t('Other', 'أخرى')}</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={t('Subject', 'الموضوع')} value={form.subject} onChange={e => set('subject', e.target.value)} />
          <Textarea placeholder={t('Description', 'الوصف')} value={form.description} onChange={e => set('description', e.target.value)} rows={4} />
          <Select value={form.priority} onValueChange={v => set('priority', v)}>
            <SelectTrigger><SelectValue placeholder={t('Priority', 'الأولوية')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">{t('Low', 'منخفض')}</SelectItem>
              <SelectItem value="normal">{t('Normal', 'عادي')}</SelectItem>
              <SelectItem value="high">{t('High', 'عالي')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Submit', 'تقديم')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function MyPortal() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const employeeId = user?.employeeId ?? 0;
  const [showNewRequest, setShowNewRequest] = useState(false);

  const { data: employeeData } = useGetEmployee(employeeId, { query: { enabled: employeeId > 0, queryKey: getGetEmployeeQueryKey(employeeId) } });
  const { data: leaveData } = useListLeaveRequests({ employeeId: employeeId || undefined } as any, { query: { enabled: employeeId > 0, queryKey: getListLeaveRequestsQueryKey({ employeeId: employeeId || undefined }) } });
  const { data: balancesData } = useListLeaveBalances({ employeeId: employeeId || undefined } as any, { query: { enabled: employeeId > 0, queryKey: getListLeaveBalancesQueryKey({ employeeId: employeeId || undefined }) } });
  const { data: payrollRunsData } = useListPayrollRuns({ limit: 12 } as any);
  const { data: requestsData } = useListEmployeeRequests({ employeeId: employeeId || undefined, limit: 20 } as any, { query: { enabled: employeeId > 0, queryKey: getListEmployeeRequestsQueryKey({ employeeId: employeeId || undefined }) } });
  const { data: announcementsData } = useListAnnouncements({ status: 'published', limit: 10 } as any);

  const employee = employeeData;
  // leaveRequests returns LeaveRequestSummary[] directly (array not paginated)
  const leaveRequests = Array.isArray(leaveData) ? leaveData : [];
  // balances returns LeaveBalance[] directly
  const balances = Array.isArray(balancesData) ? balancesData : [];
  const payrollRuns = payrollRunsData ?? [];
  const requests = requestsData?.data ?? [];
  const announcements = announcementsData?.data ?? [];

  if (!employeeId) {
    return (
      <AnimatedPage>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          {t('No employee profile linked to your account', 'لا يوجد ملف موظف مرتبط بحسابك')}
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <User className="w-6 h-6 text-amber-500" />
            {t('My Portal', 'بوابتي')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('Welcome back,', 'مرحباً،')} {localName(user?.fullNameEn, user?.fullNameAr, lang)}
          </p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="flex-wrap">
            <TabsTrigger value="profile">{t('My Profile', 'ملفي')}</TabsTrigger>
            <TabsTrigger value="leave">{t('My Leave', 'إجازاتي')}</TabsTrigger>
            <TabsTrigger value="payslips">{t('My Payslips', 'كشوف راتبي')}</TabsTrigger>
            <TabsTrigger value="requests">{t('My Requests', 'طلباتي')}</TabsTrigger>
            <TabsTrigger value="announcements">{t('Announcements', 'الإعلانات')}</TabsTrigger>
          </TabsList>

          {/* Profile */}
          <TabsContent value="profile" className="mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{t('Personal Information', 'المعلومات الشخصية')}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Full Name (EN)', 'الاسم الكامل (إنجليزي)')}</span><span className="font-medium">{employee ? `${employee.firstNameEn} ${employee.lastNameEn}` : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Full Name (AR)', 'الاسم الكامل (عربي)')}</span><span className="font-medium">{employee ? `${employee.firstNameAr} ${employee.lastNameAr}` : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Employee No.', 'رقم الموظف')}</span><span>{employee?.employeeNumber ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Status', 'الحالة')}</span>
                    <Badge variant="outline" className={cn('capitalize text-xs', employee?.status === 'active' ? 'border-emerald-400 text-emerald-600' : '')}>{employee?.status ?? '—'}</Badge>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{t('Leave Balances', 'أرصدة الإجازات')}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {balances.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('No balance data', 'لا توجد بيانات رصيد')}</p>
                  ) : balances.map(b => (
                    <div key={b.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('Type', 'النوع')} #{b.leaveTypeId}</span>
                      <span className="font-bold text-amber-500">{b.available ?? b.openingBalance} {t('days', 'أيام')}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Leave */}
          <TabsContent value="leave" className="mt-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Start', 'البداية')}</TableHead>
                    <TableHead>{t('End', 'النهاية')}</TableHead>
                    <TableHead>{t('Days', 'الأيام')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveRequests.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('No leave requests', 'لا توجد طلبات إجازة')}</TableCell></TableRow>
                  ) : leaveRequests.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>#{r.leaveTypeId}</TableCell>
                      <TableCell>{fmtDate(r.startDate)}</TableCell>
                      <TableCell>{fmtDate(r.endDate)}</TableCell>
                      <TableCell>{r.totalDays}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Payslips */}
          <TabsContent value="payslips" className="mt-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Run ID', 'رقم التشغيل')}</TableHead>
                    <TableHead>{t('Period ID', 'رقم الفترة')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Calculated At', 'تاريخ الاحتساب')}</TableHead>
                    <TableHead className="text-right">{t('Actions', 'الإجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollRuns.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('No payroll runs found', 'لا توجد دورات رواتب')}</TableCell></TableRow>
                  ) : payrollRuns.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>#{p.id}</TableCell>
                      <TableCell>#{p.periodId}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{p.status}</Badge>
                      </TableCell>
                      <TableCell>{fmtDate(p.calculatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/payroll/payslip/${p.id}`)}
                          disabled={p.status !== 'calculated' && p.status !== 'approved' && p.status !== 'paid'}
                        >
                          <FileDown className="h-3.5 w-3.5 mr-1" />
                          {t('View PDF', 'عرض PDF')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Requests */}
          <TabsContent value="requests" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowNewRequest(true)}>
                <FileText className="w-4 h-4 mr-1" />{t('New Request', 'طلب جديد')}
              </Button>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Subject', 'الموضوع')}</TableHead>
                    <TableHead>{t('Priority', 'الأولوية')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Date', 'التاريخ')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('No requests', 'لا توجد طلبات')}</TableCell></TableRow>
                  ) : requests.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="capitalize">{r.requestType}</TableCell>
                      <TableCell className="max-w-48 truncate">{localName(r.titleEn, (r as any).titleAr, lang)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          r.urgency === 'high' ? 'border-red-400 text-red-600' :
                            r.urgency === 'normal' ? 'border-blue-400 text-blue-600' :
                              'border-gray-400 text-gray-500'
                        )}>
                          {r.urgency ?? 'normal'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          r.status === 'resolved' ? 'border-emerald-400 text-emerald-600' :
                            r.status === 'open' ? 'border-amber-400 text-amber-600' :
                              'border-gray-400 text-gray-500'
                        )}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Announcements */}
          <TabsContent value="announcements" className="mt-4 space-y-3">
            {announcements.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No announcements', 'لا توجد إعلانات')}</div>
            ) : announcements.map(a => (
              <Card key={a.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Bell className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <h3 className="font-semibold">{localName(a.titleEn, a.titleAr, lang)}</h3>
                        {a.category && <Badge variant="outline" className="text-xs">{a.category}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{a.bodyEn}</p>
                      <p className="text-xs text-muted-foreground mt-2">{fmtDate(a.publishedAt)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>

      <NewRequestDialog open={showNewRequest} onClose={() => setShowNewRequest(false)} employeeId={employeeId} />
    </AnimatedPage>
  );
}
