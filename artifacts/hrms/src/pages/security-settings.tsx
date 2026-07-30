import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListDualAuthRequests, useCreateDualAuthRequest, useApproveDualAuthRequest, useRejectDualAuthRequest,
  useListBreakGlassAccess, useRequestBreakGlassAccess, useRevokeBreakGlassAccess,
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SecuritySettings() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'dualauth'|'breakglass'>('dualauth');

  const tabs = [
    { key: 'dualauth' as const, label: t('Dual Authorization','التفويض المزدوج') },
    { key: 'breakglass' as const, label: t('Break-Glass Access','وصول الطوارئ') },
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
      </div>
    </AnimatedPage>
  );
}
