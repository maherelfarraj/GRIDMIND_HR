import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import { useListMobilizationStatuses, useCreateMobilizationStatus, useUpdateMobilizationStatus } from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Loader2, Users, Activity, ShieldAlert, CheckCircle, Pencil } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
const MOB_STATUSES = ['available','mobilized','deployed','deferred','exempt','leave','medical'];
const DEPLOYMENT_TYPES = ['domestic','overseas','peacekeeping','training','disaster_relief','classified'];
const READINESS_CODES = ['A1','A2','A3','B1','B2','C1','C2','D'];

function readinessBadge(code: string) {
  const cfg: Record<string,string> = {
    A1:'bg-green-100 text-green-700', A2:'bg-yellow-100 text-yellow-700',
    A3:'bg-yellow-200 text-yellow-800', B1:'bg-orange-100 text-orange-700',
    B2:'bg-orange-200 text-orange-800', C1:'bg-red-100 text-red-700',
    C2:'bg-red-200 text-red-800', D:'bg-gray-100 text-gray-600',
  };
  return <Badge className={cn('text-xs border-transparent font-semibold', cfg[code] ?? 'bg-gray-100 text-gray-600')}>{code}</Badge>;
}

function statusBadge(s: string) {
  const cfg: Record<string,string> = {
    available:'bg-green-100 text-green-700', mobilized:'bg-blue-100 text-blue-700',
    deployed:'bg-indigo-100 text-indigo-700', deferred:'bg-yellow-100 text-yellow-700',
    exempt:'bg-gray-100 text-gray-600', leave:'bg-orange-100 text-orange-700',
    medical:'bg-red-100 text-red-700',
  };
  return <Badge className={cn('text-xs border-transparent capitalize', cfg[s] ?? 'bg-gray-100 text-gray-600')}>{s}</Badge>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

// ─── Create/Edit Dialog ───────────────────────────────────────────────────────
function MobDialog({ open, onClose, editRecord }: { open: boolean; onClose: () => void; editRecord?: any }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employeeId: editRecord?.employeeId ? String(editRecord.employeeId) : '',
    status: editRecord?.status ?? 'available',
    unitAssignment: editRecord?.unitAssignment ?? '',
    deploymentType: editRecord?.deploymentType ?? '',
    readinessCode: editRecord?.readinessCode ?? 'A1',
    deploymentStart: editRecord?.deploymentStart ?? '',
    deploymentEnd: editRecord?.deploymentEnd ?? '',
    deploymentLocation: editRecord?.deploymentLocation ?? '',
    mraRating: editRecord?.mraRating ?? '',
    remarksEn: editRecord?.remarksEn ?? '',
  });

  const createMutation = useCreateMobilizationStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listMobilizationStatuses'] });
        onClose();
        toast({ title: t('Record created','تم إنشاء السجل') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const updateMutation = useUpdateMobilizationStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listMobilizationStatuses'] });
        onClose();
        toast({ title: t('Record updated','تم تحديث السجل') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    const data = { ...form, employeeId: Number(form.employeeId), deploymentStart: form.deploymentStart || null, deploymentEnd: form.deploymentEnd || null };
    if (editRecord) updateMutation.mutate({ id: editRecord.id, data } as any);
    else createMutation.mutate({ data } as any);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editRecord ? t('Edit Mobilization','تعديل التعبئة') : t('New Mobilization Record','سجل تعبئة جديد')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 max-h-[65vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Employee ID','رقم الموظف')}</label>
            <Input type="number" value={form.employeeId} onChange={e => setForm(p=>({...p,employeeId:e.target.value}))} disabled={!!editRecord} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Status','الحالة')}</label>
            <Select value={form.status} onValueChange={v => setForm(p=>({...p,status:v}))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MOB_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Readiness Code','رمز الجاهزية')}</label>
            <Select value={form.readinessCode} onValueChange={v => setForm(p=>({...p,readinessCode:v}))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{READINESS_CODES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Deployment Type','نوع الانتشار')}</label>
            <Select value={form.deploymentType} onValueChange={v => setForm(p=>({...p,deploymentType:v}))}>
              <SelectTrigger><SelectValue placeholder={t('Select...','اختر...')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('None','لا يوجد')}</SelectItem>
                {DEPLOYMENT_TYPES.map(d => <SelectItem key={d} value={d}>{d.replace(/_/g,' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {([['unitAssignment','Unit Assignment','تعيين الوحدة'],['deploymentLocation','Deployment Location','موقع الانتشار'],
            ['mraRating','MRA Rating','تقييم MRA'],['deploymmentStart','',''],['remarksEn','Remarks','ملاحظات']] as const).filter(([k]) => k !== 'deploymmentStart').map(([key, label, labelAr]) => (
            <div key={key} className={cn('space-y-1', key==='remarksEn'?'col-span-2':'')}>
              <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
              <Input value={form[key as keyof typeof form]} onChange={e => setForm(p=>({...p,[key]:e.target.value}))} />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Deployment Start','بداية الانتشار')}</label>
            <Input type="date" value={form.deploymentStart} onChange={e => setForm(p=>({...p,deploymentStart:e.target.value}))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Deployment End','نهاية الانتشار')}</label>
            <Input type="date" value={form.deploymentEnd} onChange={e => setForm(p=>({...p,deploymentEnd:e.target.value}))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel','إلغاء')}</Button>
          <Button disabled={isPending || !form.employeeId} onClick={handleSubmit}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editRecord ? t('Update','تحديث') : t('Create','إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Mobilization() {
  const { t } = useLanguage();
  const [showCreate, setShowCreate] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [codeFilter, setCodeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: records, isLoading } = useListMobilizationStatuses();

  const filtered = useMemo(() => {
    return (records ?? []).filter((r: any) => {
      const matchCode = !codeFilter || r.readinessCode === codeFilter;
      const matchStatus = statusFilter === 'all' || r.status === statusFilter;
      return matchCode && matchStatus;
    });
  }, [records, codeFilter, statusFilter]);

  // Dashboard stats
  const all = records ?? [];
  const available = all.filter((r: any) => r.status === 'available').length;
  const mobilized = all.filter((r: any) => ['mobilized','deployed'].includes(r.status)).length;
  const deferredExempt = all.filter((r: any) => ['deferred','exempt'].includes(r.status)).length;
  const readyA = all.filter((r: any) => r.readinessCode?.startsWith('A')).length;
  const readinessPct = all.length > 0 ? Math.round((readyA / all.length) * 100) : 0;

  const stats = [
    { label: t('Available','متاح'), value: available, icon: Users, color: 'text-green-600', bg: 'bg-green-50' },
    { label: t('Mobilized / Deployed','معبأ / منتشر'), value: mobilized, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: t('Deferred / Exempt','مؤجل / معفى'), value: deferredExempt, icon: ShieldAlert, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: t('Overall Readiness','الجاهزية الإجمالية'), value: `${readinessPct}%`, icon: CheckCircle, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  ];

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Mobilization','التعبئة')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Personnel readiness and deployment status','جاهزية الأفراد وحالة الانتشار')}</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-4 h-4 mr-2" />{t('New Record','سجل جديد')}
          </Button>
        </div>

        {/* Dashboard stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(s => (
            <Card key={s.label} className="rounded-xl shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn('p-2 rounded-lg', s.bg)}>
                  <s.icon className={cn('w-5 h-5', s.color)} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Readiness code chips */}
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setCodeFilter('')}
              className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors border', !codeFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300')}>
              {t('All','الكل')}
            </button>
            {READINESS_CODES.map(c => (
              <button key={c} onClick={() => setCodeFilter(codeFilter === c ? '' : c)}
                className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors border', codeFilter === c ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300')}>
                {c}
              </button>
            ))}
          </div>
          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Statuses','كل الحالات')}</SelectItem>
              {MOB_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto">{filtered.length} {t('records','سجل')}</Badge>
        </div>

        {/* Table */}
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{[...Array(6)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Activity className="w-10 h-10 mb-3 opacity-30" />
                <p>{t('No mobilization records','لا توجد سجلات تعبئة')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Employee','الموظف')}</TableHead>
                      <TableHead>{t('Status','الحالة')}</TableHead>
                      <TableHead>{t('Unit','الوحدة')}</TableHead>
                      <TableHead>{t('Deployment Type','نوع الانتشار')}</TableHead>
                      <TableHead>{t('Readiness','الجاهزية')}</TableHead>
                      <TableHead>{t('MRA Rating','تقييم MRA')}</TableHead>
                      <TableHead>{t('Start','البداية')}</TableHead>
                      <TableHead>{t('End','النهاية')}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r: any) => (
                      <TableRow key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <TableCell className="font-medium text-sm">{r.employeeId}</TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="text-sm text-gray-500">{r.unitAssignment ?? '—'}</TableCell>
                        <TableCell className="text-sm text-gray-500 capitalize">{r.deploymentType?.replace(/_/g,' ') ?? '—'}</TableCell>
                        <TableCell>{r.readinessCode ? readinessBadge(r.readinessCode) : '—'}</TableCell>
                        <TableCell className="text-sm">{r.mraRating ?? '—'}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.deploymentStart)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.deploymentEnd)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setEditRecord(r)}>
                            <Pencil className="w-4 h-4" />
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

        {/* Dialogs */}
        <MobDialog open={showCreate} onClose={() => setShowCreate(false)} />
        {editRecord && <MobDialog open={!!editRecord} onClose={() => setEditRecord(null)} editRecord={editRecord} />}
      </div>
    </AnimatedPage>
  );
}
