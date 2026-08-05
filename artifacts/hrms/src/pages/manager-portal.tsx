import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName, localFullName } from '@/lib/localise';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import {
  useListEmployees,
  useListLeaveRequests,
  useDecideLeaveRequest,
  useListApprovals,
  useDecideApproval,
  useListEmployeeGoals,
  useListAppraisalRecords,
  useListApprovalDelegations,
  useCreateApprovalDelegation,
  useUpdateApprovalDelegation,
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
import { Users, CheckCircle, XCircle, Target, ArrowRightLeft, Plus, Trash2 } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── New Delegation Dialog ─────────────────────────────────────────────────────
function NewDelegationDialog({ open, onClose, delegatorEmployeeId }: { open: boolean; onClose: () => void; delegatorEmployeeId: number }) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { mutate, isPending } = useCreateApprovalDelegation();
  const [form, setForm] = useState({ delegateEmployeeId: '', startDate: '', endDate: '', reason: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  const emps = empData?.data ?? [];

  function handleSubmit() {
    if (!form.delegateEmployeeId || !form.startDate || !form.endDate) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        delegatorEmployeeId,
        delegateEmployeeId: parseInt(form.delegateEmployeeId),
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || null,
        status: 'active',
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/approval-delegations'] });
        toast({ title: t('Delegation created', 'تم إنشاء التفويض') });
        onClose();
        setForm({ delegateEmployeeId: '', startDate: '', endDate: '', reason: '' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Delegation', 'تفويض جديد')}</DialogTitle>
          <DialogDescription>{t('Delegate your approval authority', 'تفويض صلاحية الاعتماد')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={form.delegateEmployeeId} onValueChange={v => set('delegateEmployeeId', v)}>
            <SelectTrigger><SelectValue placeholder={t('Delegate To', 'تفويض إلى')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang)}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-muted-foreground mb-1 block">{t('From', 'من')}</label><Input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">{t('Until', 'حتى')}</label><Input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} /></div>
          </div>
          <Textarea placeholder={t('Reason (optional)', 'السبب (اختياري)')} value={form.reason} onChange={e => set('reason', e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Delegate', 'تفويض')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function ManagerPortal() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const employeeId = user?.employeeId ?? 0;
  // Server enforces the same check; this only hides buttons the user can't use.
  const canDecide = user?.permissions?.includes('approvals.decide') ?? false;

  const [showNewDelegation, setShowNewDelegation] = useState(false);

  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { data: leaveData } = useListLeaveRequests({ status: 'submitted' } as any);
  const { data: approvalsData } = useListApprovals({ status: 'pending' } as any);
  const { data: goalsData } = useListEmployeeGoals({ limit: 100 } as any);
  const { data: appraisalsData } = useListAppraisalRecords({ limit: 100 } as any);
  const { data: delegationsData } = useListApprovalDelegations({ limit: 50 } as any);

  const { mutate: decideLeave } = useDecideLeaveRequest();
  const { mutate: decideApproval } = useDecideApproval();
  const { mutate: updateDelegation } = useUpdateApprovalDelegation();

  const employees = empData?.data ?? [];
  const pendingLeave = Array.isArray(leaveData) ? leaveData : [];
  const pendingApprovals = Array.isArray(approvalsData) ? approvalsData : [];
  const goals = goalsData?.data ?? [];
  const appraisals = appraisalsData?.data ?? [];
  const delegations = delegationsData?.data ?? [];

  function getEmpName(id?: number | null) {
    if (!id) return '—';
    const e = employees.find(e => e.id === id);
    return e ? localFullName(e.firstNameEn, e.lastNameEn, e.firstNameAr, e.lastNameAr, lang) : `#${id}`;
  }

  function handleLeaveDecision(id: number, decision: 'approved' | 'rejected') {
    decideLeave({ id, data: { stepNumber: 1, decision, notes: null, decidedByEmployeeId: employeeId || null } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/leave-requests'] }); toast({ title: decision === 'approved' ? t('Approved', 'تمت الموافقة') : t('Rejected', 'تم الرفض') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  function handleApprovalDecision(id: number, decision: 'approved' | 'rejected') {
    decideApproval({ id, data: { status: decision, decisionNote: null } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/approvals'] }); toast({ title: t('Done', 'تم') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  function revokeDelegate(id: number) {
    updateDelegation({ id, data: { status: 'revoked' } as any }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/approval-delegations'] }); toast({ title: t('Revoked', 'تم الإلغاء') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  // Team members (employees in same dept as manager)
  const myTeam = employees.slice(0, 20); // show first 20 as team preview

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-500" />
            {t('Manager Portal', 'بوابة المدير')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Team management, approvals, and delegations', 'إدارة الفريق والموافقات والتفويضات')}</p>
        </div>

        <Tabs defaultValue="team">
          <TabsList>
            <TabsTrigger value="team">{t('My Team', 'فريقي')}</TabsTrigger>
            <TabsTrigger value="approvals">
              {t('Pending Approvals', 'الموافقات المعلقة')}
              {(pendingLeave.length + pendingApprovals.length) > 0 && (
                <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                  {pendingLeave.length + pendingApprovals.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="goals">{t('Goals & Appraisals', 'الأهداف والتقييمات')}</TabsTrigger>
            <TabsTrigger value="delegations">{t('Delegations', 'التفويضات')}</TabsTrigger>
          </TabsList>

          {/* My Team */}
          <TabsContent value="team" className="mt-4">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {myTeam.map(emp => (
                <Card key={emp.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600 font-bold text-sm">
                        {localFullName(emp.firstNameEn, emp.lastNameEn, emp.firstNameAr, emp.lastNameAr, lang).charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{localFullName(emp.firstNameEn, emp.lastNameEn, emp.firstNameAr, emp.lastNameAr, lang)}</p>
                        <p className="text-xs text-muted-foreground">#{emp.employeeNumber}</p>
                      </div>
                      <Badge variant="outline" className={cn('text-xs capitalize',
                        emp.status === 'active' ? 'border-emerald-400 text-emerald-600' : 'border-gray-400 text-gray-500'
                      )}>
                        {emp.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Pending Approvals */}
          <TabsContent value="approvals" className="mt-4 space-y-4">
            <div className="font-medium text-sm text-muted-foreground">{t('Pending Leave Requests', 'طلبات الإجازة المعلقة')} ({pendingLeave.length})</div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('From', 'من')}</TableHead>
                    <TableHead>{t('To', 'إلى')}</TableHead>
                    <TableHead>{t('Days', 'الأيام')}</TableHead>
                    <TableHead>{t('Actions', 'إجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingLeave.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('No pending leave requests', 'لا توجد طلبات إجازة معلقة')}</TableCell></TableRow>
                  ) : pendingLeave.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{localName(r.employeeNameEn, r.employeeNameAr, lang) || `#${r.employeeId}`}</TableCell>
                      <TableCell>{localName(r.leaveTypeNameEn, r.leaveTypeNameAr, lang) || `#${r.leaveTypeId}`}</TableCell>
                      <TableCell>{fmtDate(r.startDate)}</TableCell>
                      <TableCell>{fmtDate(r.endDate)}</TableCell>
                      <TableCell>{r.totalDays}</TableCell>
                      <TableCell>
                        {canDecide && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400" onClick={() => handleLeaveDecision(r.id, 'approved')}>
                            <CheckCircle className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-400" onClick={() => handleLeaveDecision(r.id, 'rejected')}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <div className="font-medium text-sm text-muted-foreground mt-4">{t('Other Pending Approvals', 'موافقات أخرى معلقة')} ({pendingApprovals.length})</div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Actions', 'إجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingApprovals.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t('No pending approvals', 'لا توجد موافقات معلقة')}</TableCell></TableRow>
                  ) : pendingApprovals.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="capitalize">{a.type}</TableCell>
                      <TableCell className="max-w-48 truncate">{localName(a.titleEn, a.titleAr, lang)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{a.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {canDecide && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400" onClick={() => handleApprovalDecision(a.id, 'approved')}>
                            <CheckCircle className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-400" onClick={() => handleApprovalDecision(a.id, 'rejected')}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Goals & Appraisals */}
          <TabsContent value="goals" className="mt-4 space-y-4">
            <div className="font-medium text-sm text-muted-foreground">{t('Team Goals', 'أهداف الفريق')} ({goals.length})</div>
            {goals.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">{t('No goals found', 'لا توجد أهداف')}</CardContent></Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Title', 'العنوان')}</TableHead>
                      <TableHead>{t('Employee', 'الموظف')}</TableHead>
                      <TableHead>{t('Status', 'الحالة')}</TableHead>
                      <TableHead>{t('Due', 'الموعد')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goals.slice(0, 20).map(g => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{localName(g.titleEn, g.titleAr, lang)}</TableCell>
                        <TableCell>{getEmpName(g.employeeId)}</TableCell>
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

            <div className="font-medium text-sm text-muted-foreground mt-4">{t('Appraisal Records', 'سجلات التقييم')} ({appraisals.length})</div>
            {appraisals.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">{t('No appraisals found', 'لا توجد تقييمات')}</CardContent></Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Employee', 'الموظف')}</TableHead>
                      <TableHead>{t('Self Rating', 'تقييم ذاتي')}</TableHead>
                      <TableHead>{t('Manager Rating', 'تقييم المدير')}</TableHead>
                      <TableHead>{t('Status', 'الحالة')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appraisals.slice(0, 20).map(a => (
                      <TableRow key={a.id}>
                        <TableCell>{getEmpName(a.employeeId)}</TableCell>
                        <TableCell>{a.selfOverallScore ?? '—'}</TableCell>
                        <TableCell>{a.managerOverallScore ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{a.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* Delegations */}
          <TabsContent value="delegations" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowNewDelegation(true)} disabled={!employeeId}>
                <Plus className="w-4 h-4 mr-1" />{t('New Delegation', 'تفويض جديد')}
              </Button>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Delegated To', 'مُفوَّض إلى')}</TableHead>
                    <TableHead>{t('From', 'من')}</TableHead>
                    <TableHead>{t('Until', 'حتى')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Reason', 'السبب')}</TableHead>
                    <TableHead>{t('Actions', 'إجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delegations.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('No delegations', 'لا توجد تفويضات')}</TableCell></TableRow>
                  ) : delegations.map(d => (
                    <TableRow key={d.id}>
                      <TableCell>#{d.delegateEmployeeId}</TableCell>
                      <TableCell>{fmtDate(d.startDate)}</TableCell>
                      <TableCell>{fmtDate(d.endDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          d.status === 'active' ? 'border-emerald-400 text-emerald-600' :
                            d.status === 'revoked' ? 'border-red-400 text-red-600' :
                              'border-gray-400 text-gray-500'
                        )}>
                          {d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-48 truncate">{d.reason ?? '—'}</TableCell>
                      <TableCell>
                        {d.status === 'active' && (
                          <Button size="sm" variant="outline" className="text-red-600 border-red-400" onClick={() => revokeDelegate(d.id)}>
                            <Trash2 className="w-3 h-3 mr-1" />{t('Revoke', 'إلغاء')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {employeeId > 0 && (
        <NewDelegationDialog
          open={showNewDelegation}
          onClose={() => setShowNewDelegation(false)}
          delegatorEmployeeId={employeeId}
        />
      )}
    </AnimatedPage>
  );
}
