import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSyncStatus, useListBranchServers, useRegisterBranchServer,
  useListSyncQueue, useResolveSyncConflict,
  useListBackupRecords, useCreateBackupRecord, useGetDrStatus,
  useGetBackupScheduleStatus,
  useGetLicense,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Server, Plus, Loader2, HardDrive, Shield, GitBranch, AlertTriangle, CheckCircle, XCircle, RefreshCw, Activity, Clock, Calendar } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtBytes(bytes: number | string | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n/1024/1024).toFixed(1)} MB`;
  return `${(n/1024/1024/1024).toFixed(2)} GB`;
}

function statusDot(status: string) {
  const cls = status === 'online' ? 'bg-green-500' : status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500';
  return <span className={cn('inline-block w-2.5 h-2.5 rounded-full', cls)} />;
}

// ─── Tab 1: Overview ──────────────────────────────────────────────────────────
function OverviewTab() {
  const { t, lang } = useLanguage();
  const { data: syncStatus, isLoading } = useGetSyncStatus();

  if (isLoading) return <div className="space-y-2">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-20" />)}</div>;
  if (!syncStatus) return <p className="text-gray-400 text-sm">{t('Unable to load sync status','تعذر تحميل حالة المزامنة')}</p>;

  const s = syncStatus as any;
  const stats = [
    { label: t('Total Branch Servers','إجمالي الخوادم الفرعية'), value: s.totalBranchServers ?? 0, icon: Server, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: t('Online','متصل'), value: s.onlineCount ?? 0, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
    { label: t('Offline','غير متصل'), value: s.offlineCount ?? 0, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: t('Pending Sync','انتظار مزامنة'), value: s.pendingSyncEntries ?? 0, icon: RefreshCw, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: t('Conflicts','تعارضات'), value: s.conflictCount ?? 0, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: t('Failed','فشل'), value: s.failedCount ?? 0, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map(st => (
          <Card key={st.label} className="rounded-xl shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn('p-2 rounded-lg', st.bg)}><st.icon className={cn('w-5 h-5', st.color)} /></div>
              <div><p className="text-xs text-gray-500">{st.label}</p><p className="text-2xl font-bold">{st.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Branch servers mini-table */}
      {s.branchServers && s.branchServers.length > 0 && (
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('Branch Server Status','حالة الخوادم الفرعية')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Code','الرمز')}</TableHead>
                  <TableHead>{t('Name','الاسم')}</TableHead>
                  <TableHead>{t('Status','الحالة')}</TableHead>
                  <TableHead>{t('Last Seen','آخر ظهور')}</TableHead>
                  <TableHead>{t('Pending','معلق')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.branchServers.map((bs: any) => (
                  <TableRow key={bs.id}>
                    <TableCell className="font-mono text-xs">{bs.serverCode}</TableCell>
                    <TableCell className="text-sm">{localName(bs.nameEn, bs.nameAr, lang)}</TableCell>
                    <TableCell><div className="flex items-center gap-1.5">{statusDot(bs.status)}<span className="text-xs capitalize">{bs.status}</span></div></TableCell>
                    <TableCell className="text-xs">{fmtDate(bs.lastSeen)}</TableCell>
                    <TableCell className="text-sm">{bs.pendingCount ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 2: Branch Servers ────────────────────────────────────────────────────
function BranchServersTab() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolution, setResolution] = useState('hq_wins');
  const [resolveNotes, setResolveNotes] = useState('');
  const [form, setForm] = useState({
    serverCode:'', nameEn:'', nameAr:'', location:'', orgUnitCode:'',
    ipAddress:'', publicKeyHash:'', adminEmail:'', softwareVersion:'', syncEnabled: true,
  });

  const { data: servers, isLoading: loadingServers } = useListBranchServers();
  const { data: syncQueue, isLoading: loadingQueue } = useListSyncQueue();

  const createMutation = useRegisterBranchServer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listBranchServers'] });
        queryClient.invalidateQueries({ queryKey: ['getSyncStatus'] });
        setShowCreate(false);
        setForm({ serverCode:'', nameEn:'', nameAr:'', location:'', orgUnitCode:'', ipAddress:'', publicKeyHash:'', adminEmail:'', softwareVersion:'', syncEnabled: true });
        toast({ title: t('Server registered','تم تسجيل الخادم') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const resolveMutation = useResolveSyncConflict({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listSyncQueue'] });
        setResolveId(null);
        toast({ title: t('Conflict resolved','تم حل التعارض') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const conflictQueue = (syncQueue ?? []).filter((q: any) => ['conflict','failed'].includes(q.status));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('Register Server','تسجيل خادم')}
        </Button>
      </div>

      {/* Servers table */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {loadingServers ? <div className="p-4 space-y-2">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Code','الرمز')}</TableHead>
                    <TableHead>{t('Name','الاسم')}</TableHead>
                    <TableHead>{t('Location','الموقع')}</TableHead>
                    <TableHead>{t('IP','عنوان IP')}</TableHead>
                    <TableHead>{t('Status','الحالة')}</TableHead>
                    <TableHead>{t('Sync','مزامنة')}</TableHead>
                    <TableHead>{t('Last Seen','آخر ظهور')}</TableHead>
                    <TableHead>{t('Version','الإصدار')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(servers ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">{t('No servers registered','لا توجد خوادم مسجلة')}</TableCell></TableRow>
                  ) : (servers ?? []).map((s: any) => (
                    <TableRow key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="font-mono text-xs">{s.serverCode}</TableCell>
                      <TableCell className="font-medium text-sm">{localName(s.nameEn, s.nameAr, lang)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{s.location ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{s.ipAddress ?? '—'}</TableCell>
                      <TableCell><div className="flex items-center gap-1.5">{statusDot(s.status)}<span className="text-xs capitalize">{s.status}</span></div></TableCell>
                      <TableCell>{s.syncEnabled ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}</TableCell>
                      <TableCell className="text-xs">{fmtDate(s.lastSeen)}</TableCell>
                      <TableCell className="font-mono text-xs">{s.softwareVersion ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Queue (conflicts/failed) */}
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('Sync Conflicts & Failures','تعارضات وإخفاقات المزامنة')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingQueue ? <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Source → Target','المصدر → الهدف')}</TableHead>
                    <TableHead>{t('Entity','الكيان')}</TableHead>
                    <TableHead>{t('Operation','العملية')}</TableHead>
                    <TableHead>{t('Status','الحالة')}</TableHead>
                    <TableHead>{t('Error','الخطأ')}</TableHead>
                    <TableHead>{t('Retries','المحاولات')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conflictQueue.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t('No conflicts or failures','لا توجد تعارضات أو إخفاقات')}</TableCell></TableRow>
                  ) : conflictQueue.map((q: any) => (
                    <TableRow key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="text-xs font-mono">{q.sourceServerId} → {q.targetServerId}</TableCell>
                      <TableCell className="text-xs">{q.entityType}/{q.entityId}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{q.operation}</Badge></TableCell>
                      <TableCell><Badge className={cn('text-xs border-transparent', q.status==='conflict'?'bg-orange-100 text-orange-700':'bg-red-100 text-red-700')}>{q.status}</Badge></TableCell>
                      <TableCell className="text-xs text-red-600 max-w-[150px] truncate">{q.errorMessage ?? '—'}</TableCell>
                      <TableCell className="text-xs">{q.retryCount ?? 0}</TableCell>
                      <TableCell>
                        {q.status === 'conflict' && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setResolveId(q.id)}>
                            {t('Resolve','حل')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Register server dialog */}
      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('Register Branch Server','تسجيل خادم فرعي')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2 max-h-[60vh] overflow-y-auto">
            {([['serverCode','Server Code','رمز الخادم'],['nameEn','Name EN','الاسم EN'],['nameAr','Name AR','الاسم AR'],
              ['location','Location','الموقع'],['orgUnitCode','Org Unit Code','رمز الوحدة'],
              ['ipAddress','IP Address','عنوان IP'],['publicKeyHash','Public Key Hash','تجزئة المفتاح العام'],
              ['adminEmail','Admin Email','بريد المشرف'],['softwareVersion','Software Version','إصدار البرنامج']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input value={form[key as keyof typeof form] as string} onChange={e => setForm(p=>({...p,[key]:e.target.value}))} placeholder={t(label, labelAr)} />
              </div>
            ))}
            <div className="space-y-1 col-span-2 flex items-center gap-3">
              <input type="checkbox" id="syncEnabled" checked={form.syncEnabled} onChange={e => setForm(p=>({...p,syncEnabled:e.target.checked}))} />
              <label htmlFor="syncEnabled" className="text-sm">{t('Sync Enabled','المزامنة مفعلة')}</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.serverCode || !form.nameEn}
              onClick={() => createMutation.mutate({ data: form } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Register','تسجيل')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve conflict dialog */}
      <Dialog open={resolveId !== null} onOpenChange={v => !v && setResolveId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Resolve Conflict','حل التعارض')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Resolution Strategy','استراتيجية الحل')}</label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hq_wins">{t('HQ Wins','المقر الرئيسي يفوز')}</SelectItem>
                  <SelectItem value="branch_wins">{t('Branch Wins','الفرع يفوز')}</SelectItem>
                  <SelectItem value="manual_merge">{t('Manual Merge','دمج يدوي')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Notes','ملاحظات')}</label>
              <Input value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveId(null)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ id: resolveId!, data: { resolution, notes: resolveNotes } } as any)}>
              {resolveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Resolve','حل')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 3: Backup & DR ───────────────────────────────────────────────────────
function BackupDrTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showTrigger, setShowTrigger] = useState(false);
  const [backupForm, setBackupForm] = useState({ backupType: 'full', serverCode: '' });

  const { data: drStatus, isLoading: loadingDr } = useGetDrStatus();
  const { data: backups, isLoading: loadingBackups } = useListBackupRecords();
  const { data: scheduleStatus, isLoading: loadingSchedule } = useGetBackupScheduleStatus({ query: { refetchInterval: 30_000 } as any });

  const createBackupMutation = useCreateBackupRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listBackupRecords'] });
        setShowTrigger(false);
        toast({ title: t('Backup triggered','تم تشغيل النسخ الاحتياطي') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  function drStatusBadge(s: string) {
    const cfg: Record<string,string> = { healthy:'bg-green-100 text-green-700', warning:'bg-yellow-100 text-yellow-700', critical:'bg-red-100 text-red-700' };
    return <Badge className={cn('text-sm border-transparent font-semibold', cfg[s] ?? 'bg-gray-100 text-gray-600')}>{s?.toUpperCase()}</Badge>;
  }

  function backupStatusBadge(s: string) {
    const cfg: Record<string,string> = {
      in_progress:'bg-blue-100 text-blue-700', completed:'bg-green-100 text-green-700',
      failed:'bg-red-100 text-red-700', verified:'bg-emerald-100 text-emerald-700',
    };
    return <Badge className={cn('text-xs border-transparent', cfg[s] ?? 'bg-gray-100 text-gray-600')}>{s?.replace('_',' ')}</Badge>;
  }

  const dr = drStatus as any;

  const sched = scheduleStatus as any;

  return (
    <div className="space-y-6">
      {/* Backup Schedule card */}
      {loadingSchedule ? <Skeleton className="h-36 rounded-xl" /> : sched && (
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-500" />
                {t('Backup Schedule','جدول النسخ الاحتياطي')}
              </CardTitle>
              {sched.enabled && sched.valid && sched.running
                ? <Badge className="bg-green-100 text-green-700 border-transparent">{t('Active','نشط')}</Badge>
                : sched.enabled && !sched.valid
                  ? <Badge className="bg-red-100 text-red-700 border-transparent">{t('Invalid cron','cron غير صالح')}</Badge>
                  : <Badge className="bg-gray-100 text-gray-500 border-transparent">{t('Disabled','معطّل')}</Badge>
              }
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">{t('Cron expression','تعبير Cron')}</p>
                <p className="text-sm font-mono font-medium">{sched.cronExpression}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('Last run','آخر تشغيل')}</p>
                <p className="text-sm font-medium">{fmtDate(sched.lastRunAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('Last run status','حالة آخر تشغيل')}</p>
                {sched.lastRunStatus === 'completed'
                  ? <span className="flex items-center gap-1 text-sm font-medium text-green-600"><CheckCircle className="w-3.5 h-3.5" />{t('Completed','مكتمل')}</span>
                  : sched.lastRunStatus === 'failed'
                    ? <span className="flex items-center gap-1 text-sm font-medium text-red-600"><XCircle className="w-3.5 h-3.5" />{t('Failed','فشل')}</span>
                    : <span className="text-sm text-gray-400">—</span>
                }
              </div>
              {sched.lastPrune && (
                <div>
                  <p className="text-xs text-gray-500">{t('Last prune','آخر تنظيف')}</p>
                  <p className="text-sm font-medium">
                    {sched.lastPrune.expired} {t('expired','منتهي')} · {sched.lastPrune.filesDeleted} {t('deleted','محذوف')}
                    {sched.lastPrune.errors > 0 && <span className="text-red-500"> · {sched.lastPrune.errors} {t('errors','أخطاء')}</span>}
                  </p>
                </div>
              )}
            </div>
            {sched.lastRunError && (
              <Alert className="border-red-400/40 bg-red-50 dark:bg-red-950/20 py-2">
                <XCircle className="h-3 w-3 text-red-600" />
                <AlertDescription className="text-red-700 text-xs font-mono">{sched.lastRunError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* DR Status card */}
      {loadingDr ? <Skeleton className="h-48 rounded-xl" /> : dr && (
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t('DR Status','حالة التعافي من الكوارث')}</CardTitle>
              {drStatusBadge(dr.overallStatus)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[
                { label: t('RPO Current','RPO الحالي'), value: dr.rpoCurrent ?? '—' },
                { label: t('RPO Target','RPO المستهدف'), value: dr.rpoTarget ?? '—' },
                { label: t('RTO Target','RTO المستهدف'), value: dr.rtoTarget ?? '—' },
                { label: t('Last Backup','آخر نسخة احتياطية'), value: fmtDate(dr.lastBackup) },
                { label: t('Last Verified','آخر تحقق'), value: fmtDate(dr.lastVerified) },
                { label: t('Last Restore Test','آخر اختبار استعادة'), value: fmtDate(dr.lastRestoreTest) },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-sm font-medium">{item.value}</p>
                </div>
              ))}
            </div>
            {dr.alerts && dr.alerts.length > 0 && (
              <div className="space-y-2">
                {dr.alerts.map((alert: string, i: number) => (
                  <Alert key={i} className="border-yellow-400/40 bg-yellow-50 dark:bg-yellow-950/20 py-2">
                    <AlertTriangle className="h-3 w-3 text-yellow-600" />
                    <AlertDescription className="text-yellow-700 text-xs">{alert}</AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Backups table */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900 dark:text-white">{t('Backup Records','سجلات النسخ الاحتياطي')}</h3>
        <Button onClick={() => setShowTrigger(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <HardDrive className="w-4 h-4 mr-2" />{t('Trigger Backup','تشغيل نسخة احتياطية')}
        </Button>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {loadingBackups ? <div className="p-4 space-y-2">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Type','النوع')}</TableHead>
                    <TableHead>{t('Status','الحالة')}</TableHead>
                    <TableHead>{t('Started','بدأ')}</TableHead>
                    <TableHead>{t('Completed','اكتمل')}</TableHead>
                    <TableHead>{t('Size','الحجم')}</TableHead>
                    <TableHead>{t('Checksum','المجموع التحققي')}</TableHead>
                    <TableHead>{t('Verified','تم التحقق')}</TableHead>
                    <TableHead>{t('Restore Test','اختبار الاستعادة')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(backups ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">{t('No backup records','لا توجد سجلات نسخ احتياطي')}</TableCell></TableRow>
                  ) : (backups ?? []).map((b: any) => (
                    <TableRow key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{b.backupType}</Badge></TableCell>
                      <TableCell>{backupStatusBadge(b.status)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(b.startedAt)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(b.completedAt)}</TableCell>
                      <TableCell className="text-xs">{fmtBytes(b.fileSizeBytes)}</TableCell>
                      <TableCell className="font-mono text-xs">{b.checksum ? b.checksum.slice(0, 8) + '…' : '—'}</TableCell>
                      <TableCell>
                        {b.isVerified ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}
                      </TableCell>
                      <TableCell className="text-xs">{b.restoreTestResult ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showTrigger} onOpenChange={v => !v && setShowTrigger(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Trigger Backup','تشغيل نسخة احتياطية')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Backup Type','نوع النسخة الاحتياطية')}</label>
              <Select value={backupForm.backupType} onValueChange={v => setBackupForm(p=>({...p,backupType:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['full','incremental','differential'].map(bt => <SelectItem key={bt} value={bt}>{bt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Server Code (optional)','رمز الخادم (اختياري)')}</label>
              <Input value={backupForm.serverCode} onChange={e => setBackupForm(p=>({...p,serverCode:e.target.value}))} placeholder={t('Leave empty for all','اتركه فارغاً للكل')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTrigger(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createBackupMutation.isPending}
              onClick={() => createBackupMutation.mutate({ data: { backupType: backupForm.backupType, serverCode: backupForm.serverCode || null } } as any)}>
              {createBackupMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Trigger','تشغيل')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 4: License ───────────────────────────────────────────────────────────
function LicenseTab() {
  const { t } = useLanguage();
  const [showActivate, setShowActivate] = useState(false);
  const [licForm, setLicForm] = useState({ licenseKey:'', issuedTo:'', validationMethod:'online' });

  const { data: license, isLoading } = useGetLicense();
  const lic = license as any;

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (!lic) return (
    <div className="text-center py-16 text-gray-400">
      <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p>{t('No license information available','لا تتوفر معلومات الترخيص')}</p>
      <Button className="mt-4" onClick={() => setShowActivate(true)}>{t('Activate License','تفعيل الترخيص')}</Button>
    </div>
  );

  const editionCfg: Record<string, string> = {
    community: 'bg-gray-100 text-gray-700', standard: 'bg-blue-100 text-blue-700',
    enterprise: 'bg-indigo-100 text-indigo-700', defense: 'bg-red-100 text-red-700',
  };

  const expiryDays = lic.validUntil
    ? Math.floor((new Date(lic.validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const expiryColor = expiryDays === null ? 'text-gray-500'
    : expiryDays > 90 ? 'text-green-600'
    : expiryDays > 30 ? 'text-yellow-600'
    : 'text-red-600';

  return (
    <div className="space-y-6">
      {lic.edition !== 'defense' && (
        <Alert className="border-yellow-400/40 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-700 dark:text-yellow-400">
            {t('Defense edition required for military-grade security controls, classification enforcement, and offline operation in air-gap mode.','نسخة Defense مطلوبة لضوابط الأمان العسكرية وفرض التصنيف والتشغيل دون اتصال في وضع الفصل الجوي.')}
          </AlertDescription>
        </Alert>
      )}

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{lic.productName ?? 'GridMindHR'}</h2>
              <p className="text-sm text-gray-500 mt-1">{t('Issued to','صادر لـ')}: <span className="font-medium">{lic.issuedTo}</span></p>
            </div>
            <Badge className={cn('text-sm px-3 py-1 border-transparent uppercase font-bold', editionCfg[lic.edition] ?? 'bg-gray-100 text-gray-700')}>
              {lic.edition}
            </Badge>
          </div>

          {/* Grid details */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div><p className="text-xs text-gray-500">{t('Valid From','صالح من')}</p><p className="text-sm font-medium">{lic.validFrom ? new Date(lic.validFrom).toLocaleDateString() : '—'}</p></div>
            <div><p className="text-xs text-gray-500">{t('Valid Until','صالح حتى')}</p><p className="text-sm font-medium">{lic.validUntil ? new Date(lic.validUntil).toLocaleDateString() : '—'}</p></div>
            {expiryDays !== null && (
              <div><p className="text-xs text-gray-500">{t('Days Until Expiry','أيام حتى الانتهاء')}</p><p className={cn('text-sm font-bold', expiryColor)}>{expiryDays} {t('days','يوم')}</p></div>
            )}
            <div><p className="text-xs text-gray-500">{t('Max Users','أقصى عدد مستخدمين')}</p><p className="text-sm font-medium">{lic.maxUsers ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">{t('Max Branches','أقصى عدد فروع')}</p><p className="text-sm font-medium">{lic.maxBranches ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">{t('Offline Grace Days','أيام التسامح دون اتصال')}</p><p className="text-sm font-medium">{lic.offlineGraceDays ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">{t('Validation Method','طريقة التحقق')}</p><p className="text-sm font-medium capitalize">{lic.validationMethod}</p></div>
            <div><p className="text-xs text-gray-500">{t('Last Validated','آخر تحقق')}</p><p className="text-sm font-medium">{fmtDate(lic.lastValidated)}</p></div>
          </div>

          {/* Features */}
          {lic.features && lic.features.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">{t('Enabled Features','الميزات المفعلة')}</p>
              <div className="flex flex-wrap gap-2">
                {lic.features.map((f: string) => (
                  <Badge key={f} className="bg-indigo-100 text-indigo-700 border-transparent text-xs">{f}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setShowActivate(true)}>
              <Shield className="w-4 h-4 mr-2" />{t('Activate New License','تفعيل ترخيص جديد')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showActivate} onOpenChange={v => !v && setShowActivate(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Activate License','تفعيل الترخيص')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('License Key','مفتاح الترخيص')}</label>
              <Input type="password" value={licForm.licenseKey} onChange={e => setLicForm(p=>({...p,licenseKey:e.target.value}))} placeholder="XXXX-XXXX-XXXX-XXXX" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Issued To','صادر لـ')}</label>
              <Input value={licForm.issuedTo} onChange={e => setLicForm(p=>({...p,issuedTo:e.target.value}))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Validation Method','طريقة التحقق')}</label>
              <Select value={licForm.validationMethod} onValueChange={v => setLicForm(p=>({...p,validationMethod:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">{t('Online','متصل')}</SelectItem>
                  <SelectItem value="offline">{t('Offline','غير متصل')}</SelectItem>
                  <SelectItem value="air_gap">{t('Air-Gap','فصل جوي')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActivate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={!licForm.licenseKey}>{t('Activate','تفعيل')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminAirgap() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'overview'|'servers'|'backup'|'license'>('overview');

  const tabs = [
    { key: 'overview' as const, label: t('Overview','نظرة عامة'), icon: Activity },
    { key: 'servers' as const, label: t('Branch Servers','الخوادم الفرعية'), icon: Server },
    { key: 'backup' as const, label: t('Backup & DR','النسخ الاحتياطي والاسترداد'), icon: HardDrive },
    { key: 'license' as const, label: t('License','الترخيص'), icon: Shield },
  ];

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <GitBranch className="w-7 h-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Air-Gap Administration','إدارة الفصل الجوي')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('Offline operations, branch servers, backup, and licensing','التشغيل دون اتصال والخوادم الفرعية والنسخ الاحتياطي والترخيص')}</p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {tabs.map(tab_ => (
            <button key={tab_.key} onClick={() => setTab(tab_.key)}
              className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap', tab === tab_.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
              <tab_.icon className="w-4 h-4" />
              {tab_.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab />}
        {tab === 'servers' && <BranchServersTab />}
        {tab === 'backup' && <BackupDrTab />}
        {tab === 'license' && <LicenseTab />}
      </div>
    </AnimatedPage>
  );
}
