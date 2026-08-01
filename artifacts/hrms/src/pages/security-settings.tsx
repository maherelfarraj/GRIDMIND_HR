import { useState, useMemo, useEffect, useCallback } from 'react';
import { ACTIVITY_PAGE_SIZE, appendActivityPage, emptyActivityState, hasMoreActivity, nextActivityOffset } from '@/lib/session-activity';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListDualAuthRequests, useCreateDualAuthRequest, useApproveDualAuthRequest, useRejectDualAuthRequest,
  useListBreakGlassAccess, useRequestBreakGlassAccess, useRevokeBreakGlassAccess,
  useListPrivilegedSessions, useReviewPrivilegedSession, getPrivilegedSessionActivity,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Loader2, ShieldAlert, AlertTriangle, CheckCircle, XCircle, Clock, Info, ChevronDown, ChevronRight } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function dualAuthStatusBadge(s: string) {
  const cfg: Record<string,string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    first_approved: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-500',
  };
  return <Badge className={cn('text-xs border-transparent capitalize', cfg[s] ?? 'bg-gray-100 text-gray-600')}>{s.replace('_',' ')}</Badge>;
}

// ─── Approve Modal ────────────────────────────────────────────────────────────
function ApproveModal({ open, onClose, requestId }: { open: boolean; onClose: () => void; requestId: number | null }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [approverUserId, setApproverUserId] = useState('');
  const [notes, setNotes] = useState('');

  const approveMutation = useApproveDualAuthRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listDualAuthRequests'] });
        onClose();
        setApproverUserId(''); setNotes('');
        toast({ title: t('Request approved','تمت الموافقة على الطلب') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Approve Dual Auth Request','الموافقة على طلب التوثيق المزدوج')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Your User ID','رقم المستخدم الخاص بك')}</label>
            <Input type="number" value={approverUserId} onChange={e => setApproverUserId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Notes','ملاحظات')}</label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('Optional notes...','ملاحظات اختيارية...')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel','إلغاء')}</Button>
          <Button disabled={approveMutation.isPending || !approverUserId || !requestId}
            onClick={() => approveMutation.mutate({ id: requestId!, data: { approverUserId: Number(approverUserId), notes } } as any)}>
            {approveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t('Approve','موافقة')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab 1: Dual Authorization ────────────────────────────────────────────────
function DualAuthTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [approveId, setApproveId] = useState<number | null>(null);
  const [form, setForm] = useState({ actionType:'', descriptionEn:'', justification:'', ttlMinutes:'60' });

  const { data: requests, isLoading } = useListDualAuthRequests();

  const rejectMutation = useRejectDualAuthRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listDualAuthRequests'] });
        toast({ title: t('Request rejected','تم رفض الطلب') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const createMutation = useCreateDualAuthRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listDualAuthRequests'] });
        setShowCreate(false);
        setForm({ actionType:'', descriptionEn:'', justification:'', ttlMinutes:'60' });
        toast({ title: t('Request created','تم إنشاء الطلب') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  // Summary
  const allReqs = requests ?? [];
  const pending = allReqs.filter((r: any) => ['pending','first_approved'].includes(r.status)).length;
  const today = new Date().toDateString();
  const approvedToday = allReqs.filter((r: any) => r.status === 'approved' && r.updatedAt && new Date(r.updatedAt).toDateString() === today).length;
  const expired = allReqs.filter((r: any) => r.status === 'expired').length;

  return (
    <div className="space-y-4">
      {/* Info box */}
      <Alert className="border-blue-400/40 bg-blue-50 dark:bg-blue-950/20">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-700 dark:text-blue-400">
          {t('Dual authorization enforces separation of duties. Two different users must approve sensitive actions. The same user cannot provide both approvals.','يفرض التفويض المزدوج الفصل بين الواجبات. يجب أن يوافق مستخدمان مختلفان على الإجراءات الحساسة. لا يمكن للمستخدم نفسه تقديم كلا الموافقتين.')}
        </AlertDescription>
      </Alert>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t('Pending','معلق'), value: pending, color: 'text-yellow-600', bg: 'bg-yellow-50', icon: Clock },
          { label: t('Approved Today','موافق عليه اليوم'), value: approvedToday, color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle },
          { label: t('Expired','منتهي الصلاحية'), value: expired, color: 'text-gray-500', bg: 'bg-gray-50', icon: XCircle },
        ].map(s => (
          <Card key={s.label} className="rounded-xl shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn('p-2 rounded-lg', s.bg)}><s.icon className={cn('w-4 h-4', s.color)} /></div>
              <div><p className="text-xs text-gray-500">{s.label}</p><p className="text-xl font-bold">{s.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('New Request','طلب جديد')}
        </Button>
      </div>

      {/* Table */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Action Type','نوع الإجراء')}</TableHead>
                    <TableHead>{t('Description','الوصف')}</TableHead>
                    <TableHead>{t('Initiated By','بدأ بواسطة')}</TableHead>
                    <TableHead>{t('Status','الحالة')}</TableHead>
                    <TableHead>{t('Expires At','ينتهي في')}</TableHead>
                    <TableHead>{t('Created','أُنشئ')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allReqs.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t('No requests','لا توجد طلبات')}</TableCell></TableRow>
                  ) : allReqs.map((r: any) => {
                    const canApprove = ['pending','first_approved'].includes(r.status);
                    const canReject = r.status === 'pending';
                    return (
                      <TableRow key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <TableCell><Badge variant="outline" className="text-xs font-mono">{r.actionType}</Badge></TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{r.descriptionEn}</TableCell>
                        <TableCell className="text-sm">{r.initiatedByUserId}</TableCell>
                        <TableCell>{dualAuthStatusBadge(r.status)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.expiresAt)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {canApprove && (
                              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                                onClick={() => setApproveId(r.id)}>
                                <CheckCircle className="w-3 h-3 mr-1" />{t('Approve','موافقة')}
                              </Button>
                            )}
                            {canReject && (
                              <Button size="sm" variant="destructive" className="h-7 text-xs"
                                onClick={() => rejectMutation.mutate({ id: r.id } as any)}>
                                <XCircle className="w-3 h-3 mr-1" />{t('Reject','رفض')}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('New Dual Auth Request','طلب توثيق مزدوج جديد')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Action Type','نوع الإجراء')}</label>
              <Input value={form.actionType} onChange={e => setForm(p=>({...p,actionType:e.target.value}))} placeholder={t('e.g. SALARY_CHANGE','مثال: SALARY_CHANGE')} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Description','الوصف')}</label>
              <Textarea rows={2} value={form.descriptionEn} onChange={e => setForm(p=>({...p,descriptionEn:e.target.value}))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Justification','المبرر')}</label>
              <Textarea rows={2} value={form.justification} onChange={e => setForm(p=>({...p,justification:e.target.value}))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('TTL Minutes','مدة الصلاحية (دقيقة)')}</label>
              <Input type="number" value={form.ttlMinutes} onChange={e => setForm(p=>({...p,ttlMinutes:e.target.value}))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.actionType}
              onClick={() => createMutation.mutate({ data: { ...form, ttlMinutes: Number(form.ttlMinutes) } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Submit','إرسال')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApproveModal open={approveId !== null} onClose={() => setApproveId(null)} requestId={approveId} />
    </div>
  );
}

// ─── Tab 2: Break-Glass Access ────────────────────────────────────────────────
function BreakGlassTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({ userId:'', resourceType:'', resourceLabel:'', justification:'', emergencyCode:'', ttlMinutes:'60' });

  const { data: records, isLoading } = useListBreakGlassAccess();

  const requestMutation = useRequestBreakGlassAccess({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listBreakGlassAccess'] });
        setShowCreate(false);
        setForm({ userId:'', resourceType:'', resourceLabel:'', justification:'', emergencyCode:'', ttlMinutes:'60' });
        toast({ title: t('Break-glass access granted','تم منح وصول الطوارئ') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const revokeMutation = useRevokeBreakGlassAccess({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listBreakGlassAccess'] });
        toast({ title: t('Access revoked','تم إلغاء الوصول') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const allRecords = records ?? [];
  const activeRecords = allRecords.filter((r: any) => r.isActive);

  return (
    <div className="space-y-4">
      {/* Warning */}
      <Alert className="border-red-400/40 bg-red-50 dark:bg-red-950/20">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-700 dark:text-red-400 font-medium">
          {t('⚠️ Break-glass access bypasses normal permissions. All access is logged and triggers supervisor notification. Misuse is an audit violation.','⚠️ وصول كسر الزجاج يتجاوز الأذونات العادية. يتم تسجيل جميع عمليات الوصول وتطلق إشعار للمشرف. إساءة الاستخدام تُعدّ انتهاكاً للتدقيق.')}
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-red-600 hover:bg-red-700 text-white">
          <ShieldAlert className="w-4 h-4 mr-2" />{t('Request Break-Glass','طلب وصول طوارئ')}
        </Button>
      </div>

      {/* Active records */}
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-red-600">{t('Active Break-Glass Sessions','جلسات الوصول النشطة')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : activeRecords.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('No active break-glass sessions','لا توجد جلسات وصول نشطة')}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('User','المستخدم')}</TableHead>
                    <TableHead>{t('Resource Type','نوع المورد')}</TableHead>
                    <TableHead>{t('Resource ID','معرف المورد')}</TableHead>
                    <TableHead>{t('Justification','المبرر')}</TableHead>
                    <TableHead>{t('Granted At','منح في')}</TableHead>
                    <TableHead>{t('Expires At','ينتهي في')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeRecords.map((r: any) => (
                    <TableRow key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="text-sm font-medium">{r.userId}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{r.resourceType}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{r.resourceId ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={r.justification}>{r.justification}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.grantedAt)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.expiresAt)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="destructive" className="h-7 text-xs"
                          onClick={() => revokeMutation.mutate({ id: r.id } as any)}>
                          {t('Revoke','إلغاء')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History (collapsible) */}
      <div>
        <button onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
          {showHistory ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          {t('Access History','سجل الوصول')} ({allRecords.length})
        </button>
        {showHistory && (
          <Card className="rounded-xl shadow-sm mt-2">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('User','المستخدم')}</TableHead>
                      <TableHead>{t('Resource Type','نوع المورد')}</TableHead>
                      <TableHead>{t('Justification','المبرر')}</TableHead>
                      <TableHead>{t('Granted At','منح في')}</TableHead>
                      <TableHead>{t('Active','نشط')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allRecords.map((r: any) => (
                      <TableRow key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <TableCell className="text-sm">{r.userId}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{r.resourceType}</Badge></TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{r.justification}</TableCell>
                        <TableCell className="text-xs">{fmtDate(r.grantedAt)}</TableCell>
                        <TableCell>
                          <span className={cn('inline-block w-2 h-2 rounded-full', r.isActive ? 'bg-green-500' : 'bg-gray-300')} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-red-600">{t('Request Break-Glass Access','طلب وصول الطوارئ')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {([['userId','User ID','رقم المستخدم'],['resourceType','Resource Type','نوع المورد'],['resourceLabel','Resource Label','وصف المورد']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input type={key === 'userId' ? 'number' : 'text'} value={form[key as keyof typeof form]}
                  onChange={e => setForm(p=>({...p,[key]:e.target.value}))} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Justification (required)','المبرر (مطلوب)')}</label>
              <Textarea rows={3} value={form.justification} onChange={e => setForm(p=>({...p,justification:e.target.value}))}
                placeholder={t('Explain the emergency reason...','اشرح سبب الطوارئ...')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t('Emergency Code (optional)','رمز الطوارئ (اختياري)')}</label>
                <Input value={form.emergencyCode} onChange={e => setForm(p=>({...p,emergencyCode:e.target.value}))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t('TTL (minutes)','مدة الصلاحية (دقيقة)')}</label>
                <Input type="number" value={form.ttlMinutes} onChange={e => setForm(p=>({...p,ttlMinutes:e.target.value}))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button variant="destructive" disabled={requestMutation.isPending || !form.userId || !form.justification}
              onClick={() => requestMutation.mutate({ data: { ...form, userId: Number(form.userId), ttlMinutes: Number(form.ttlMinutes), emergencyCode: form.emergencyCode || null } } as any)}>
              {requestMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Request Access','طلب الوصول')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 3: Privileged Session Review ────────────────────────────────────────
function outcomeBadge(o: string | null | undefined) {
  const cfg: Record<string,string> = {
    justified: 'bg-green-100 text-green-700',
    unjustified: 'bg-red-100 text-red-700',
    under_investigation: 'bg-yellow-100 text-yellow-700',
  };
  if (!o) return <Badge className="text-xs border-transparent bg-gray-100 text-gray-500">{'—'}</Badge>;
  return <Badge className={cn('text-xs border-transparent capitalize', cfg[o] ?? 'bg-gray-100 text-gray-600')}>{o.replace(/_/g,' ')}</Badge>;
}

// Audit-log actions the session holder performed during the elevated-access
// window — reviewers see what was actually touched, not just the time window.
function SessionActivityList({ sessionId }: { sessionId: number }) {
  const { t } = useLanguage();
  // Long elevated-access windows can hold thousands of audit rows — fetch
  // fixed-size pages (offset = rows already loaded) and append on demand,
  // so progress is made past the server's per-request cap.
  const [state, setState] = useState(emptyActivityState);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadPage = useCallback(async (offset: number) => {
    setIsFetching(true);
    setLoadError(false);
    try {
      const page = await getPrivilegedSessionActivity(sessionId, { limit: ACTIVITY_PAGE_SIZE, offset });
      setState((prev) => appendActivityPage(offset === 0 ? emptyActivityState() : prev, page));
    } catch {
      setLoadError(true);
    } finally {
      setIsFetching(false);
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setState(emptyActivityState());
    setIsLoading(true);
    void loadPage(0);
  }, [loadPage]);

  if (isLoading) return <div className="space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (loadError && state.items.length === 0) {
    return <div className="text-xs text-red-500 py-2">{t('Failed to load session activity.','فشل تحميل نشاط الجلسة.')}</div>;
  }
  const activity = state.items;
  const total = state.total;
  if (activity.length === 0) {
    return <div className="text-xs text-gray-400 py-2">{t('No audit-log actions recorded during this session window.','لم تُسجل أي إجراءات في سجل التدقيق خلال نافذة هذه الجلسة.')}</div>;
  }
  return (
    <div className="space-y-1.5">
    <div className="max-h-56 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
      {activity.map((a) => (
        <div key={a.id} className="px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{a.action}</span>
            <span className="text-gray-400 whitespace-nowrap">{fmtDate(a.createdAt)}</span>
          </div>
          <div className="text-gray-500 mt-0.5">
            {a.entityType}{a.entityId != null ? ` #${a.entityId}` : ''}{a.entityLabel ? ` — ${a.entityLabel}` : ''}
          </div>
        </div>
      ))}
    </div>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-400">
        {t(`Showing ${activity.length} of ${total} actions`, `عرض ${activity.length} من ${total} إجراء`)}
      </span>
      {hasMoreActivity(state) && (
        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={isFetching}
          onClick={() => void loadPage(nextActivityOffset(state))}>
          {isFetching && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          {loadError ? t('Retry','إعادة المحاولة') : t('Load more','تحميل المزيد')}
        </Button>
      )}
    </div>
    </div>
  );
}

function ReviewModal({ open, onClose, sessionId }: { open: boolean; onClose: () => void; sessionId: number | null }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState('justified');
  const [notes, setNotes] = useState('');

  const reviewMutation = useReviewPrivilegedSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listPrivilegedSessions'] });
        onClose();
        setOutcome('justified'); setNotes('');
        toast({ title: t('Session reviewed','تمت مراجعة الجلسة') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Review Privileged Session','مراجعة الجلسة المميزة')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-gray-500">{t('The review is recorded under your signed-in account.','تُسجل المراجعة باسم حسابك المسجل.')}</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Actions taken during this session','الإجراءات المتخذة خلال هذه الجلسة')}</label>
            {sessionId != null && <SessionActivityList sessionId={sessionId} />}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Outcome','النتيجة')}</label>
            <select value={outcome} onChange={e => setOutcome(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-sm">
              <option value="justified">{t('Justified','مبرر')}</option>
              <option value="unjustified">{t('Unjustified','غير مبرر')}</option>
              <option value="under_investigation">{t('Under Investigation','قيد التحقيق')}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Notes','ملاحظات')}</label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('Optional notes...','ملاحظات اختيارية...')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel','إلغاء')}</Button>
          <Button disabled={reviewMutation.isPending || !sessionId}
            onClick={() => reviewMutation.mutate({ id: sessionId!, data: { outcome, notes: notes || null } } as any)}>
            {reviewMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t('Mark Reviewed','وضع علامة تمت المراجعة')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionReviewTab() {
  const { t } = useLanguage();
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [activityId, setActivityId] = useState<number | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);

  const { data: sessions, isLoading } = useListPrivilegedSessions();
  const all = sessions ?? [];
  const pending = all.filter((s: any) => !s.reviewedAt);
  const reviewed = all.filter((s: any) => s.reviewedAt);

  const renderTable = (rows: any[], withAction: boolean) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('User','المستخدم')}</TableHead>
            <TableHead>{t('Grant','التصريح')}</TableHead>
            <TableHead>{t('Started','بدأت')}</TableHead>
            <TableHead>{t('Ended','انتهت')}</TableHead>
            <TableHead>{t('Outcome','النتيجة')}</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s: any) => (
            <TableRow key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <TableCell className="text-sm font-medium">{s.userName ?? s.userId}</TableCell>
              <TableCell className="font-mono text-xs">#{s.breakGlassAccessId}</TableCell>
              <TableCell className="text-xs">{fmtDate(s.startedAt)}</TableCell>
              <TableCell className="text-xs">{s.endedAt ? `${fmtDate(s.endedAt)} (${s.endReason ?? ''})` : t('Open until','مفتوحة حتى') + ' ' + fmtDate(s.scheduledEndAt)}</TableCell>
              <TableCell>{outcomeBadge(s.reviewOutcome)}</TableCell>
              <TableCell>
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActivityId(s.id)}>
                    {t('Activity','النشاط')}
                  </Button>
                  {withAction && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewId(s.id)}>
                      {t('Review','مراجعة')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-4">
      <Alert className="border-indigo-400/40 bg-indigo-50 dark:bg-indigo-950/20">
        <Info className="h-4 w-4 text-indigo-600" />
        <AlertDescription className="text-indigo-700 dark:text-indigo-400">
          {t('Every break-glass activation records a privileged session. Security officers must review each elevated-access window post-hoc.','كل تفعيل لوصول الطوارئ يسجل جلسة مميزة. يجب على ضباط الأمن مراجعة كل نافذة وصول مرتفع لاحقاً.')}
        </AlertDescription>
      </Alert>

      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t('Awaiting Review','بانتظار المراجعة')} ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : pending.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('No sessions awaiting review','لا توجد جلسات بانتظار المراجعة')}</div>
          ) : renderTable(pending, true)}
        </CardContent>
      </Card>

      <div>
        <button onClick={() => setShowReviewed(!showReviewed)}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
          {showReviewed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          {t('Reviewed Sessions','الجلسات المراجعة')} ({reviewed.length})
        </button>
        {showReviewed && (
          <Card className="rounded-xl shadow-sm mt-2">
            <CardContent className="p-0">
              {reviewed.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">{t('No reviewed sessions yet','لا توجد جلسات مراجعة بعد')}</div>
              ) : renderTable(reviewed, false)}
            </CardContent>
          </Card>
        )}
      </div>

      <ReviewModal open={reviewId !== null} onClose={() => setReviewId(null)} sessionId={reviewId} />

      <Dialog open={activityId !== null} onOpenChange={v => !v && setActivityId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('Session Activity','نشاط الجلسة')}</DialogTitle></DialogHeader>
          <p className="text-xs text-gray-500">{t('Audit-log actions the session holder performed during the elevated-access window.','إجراءات سجل التدقيق التي نفذها صاحب الجلسة خلال نافذة الوصول المرتفع.')}</p>
          {activityId != null && <SessionActivityList sessionId={activityId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SecuritySettings() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'dualauth'|'breakglass'|'sessions'>('dualauth');

  const tabs = [
    { key: 'dualauth' as const, label: t('Dual Authorization','التفويض المزدوج') },
    { key: 'breakglass' as const, label: t('Break-Glass Access','وصول الطوارئ') },
    { key: 'sessions' as const, label: t('Session Review','مراجعة الجلسات') },
  ];

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Security Settings','إعدادات الأمان')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Dual authorization and emergency access controls','التفويض المزدوج وضوابط الوصول في الطوارئ')}</p>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {tabs.map(tab_ => (
            <button key={tab_.key} onClick={() => setTab(tab_.key)}
              className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors', tab === tab_.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
              {tab_.label}
            </button>
          ))}
        </div>

        {tab === 'dualauth' && <DualAuthTab />}
        {tab === 'breakglass' && <BreakGlassTab />}
        {tab === 'sessions' && <SessionReviewTab />}
      </div>
    </AnimatedPage>
  );
}
