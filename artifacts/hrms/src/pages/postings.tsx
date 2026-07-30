import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployeePostings, useCreateEmployeePosting,
  useListEmployeeTransfers, useCreateEmployeeTransfer,
  useListEmployeeSecondments, useCreateEmployeeSecondment,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Loader2, FileText, ArrowRightLeft, Users } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

const TRANSFER_STATUSES = ['draft','pending_approval','approved','in_progress','completed','cancelled'];
const SECONDMENT_STATUSES = ['active','completed','cancelled','extended'];
const POSTING_TYPES = ['initial','transfer','secondment','acting','rotation'];

function statusColor(s: string) {
  const m: Record<string,string> = {
    draft:'bg-gray-100 text-gray-600', pending_approval:'bg-yellow-100 text-yellow-700',
    approved:'bg-green-100 text-green-700', in_progress:'bg-blue-100 text-blue-700',
    completed:'bg-emerald-100 text-emerald-700', cancelled:'bg-red-100 text-red-700',
    active:'bg-green-100 text-green-700', extended:'bg-purple-100 text-purple-700',
  };
  return m[s] ?? 'bg-gray-100 text-gray-600';
}

// ─── Postings Tab ─────────────────────────────────────────────────────────────
function PostingsTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [employeeIdFilter, setEmployeeIdFilter] = useState('');
  const [currentOnly, setCurrentOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    employeeId:'', positionTitleEn:'', positionTitleAr:'', orgUnitId:'', dutyStationId:'',
    postingType:'initial', startDate:'', endDate:'',
  });

  const params: any = {};
  if (employeeIdFilter) params.employeeId = Number(employeeIdFilter);
  if (currentOnly) params.isCurrent = true;
  const { data: postings, isLoading } = useListEmployeePostings(params);

  const createMutation = useCreateEmployeePosting({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listEmployeePostings'] });
        setShowCreate(false);
        setForm({ employeeId:'', positionTitleEn:'', positionTitleAr:'', orgUnitId:'', dutyStationId:'', postingType:'initial', startDate:'', endDate:'' });
        toast({ title: t('Posting created','تم إنشاء التكليف') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <Input placeholder={t('Employee ID','رقم الموظف')} value={employeeIdFilter}
            onChange={e => setEmployeeIdFilter(e.target.value)} className="w-36" type="number" />
          <div className="flex items-center gap-2">
            <Checkbox id="curr" checked={currentOnly} onCheckedChange={v => setCurrentOnly(!!v)} />
            <label htmlFor="curr" className="text-sm">{t('Current only','الحالي فقط')}</label>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('New Posting','تكليف جديد')}
        </Button>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {isLoading ? <div className="p-4 space-y-2">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-10"/>)}</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee','الموظف')}</TableHead>
                    <TableHead>{t('Position Title','المسمى الوظيفي')}</TableHead>
                    <TableHead>{t('Org Unit','الوحدة')}</TableHead>
                    <TableHead>{t('Duty Station','محطة الخدمة')}</TableHead>
                    <TableHead>{t('Type','النوع')}</TableHead>
                    <TableHead>{t('Start','البداية')}</TableHead>
                    <TableHead>{t('End','النهاية')}</TableHead>
                    <TableHead>{t('Current','حالي')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(postings ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">{t('No postings','لا توجد تكليفات')}</TableCell></TableRow>
                  ) : (postings ?? []).map((p: any) => (
                    <TableRow key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="text-sm">{p.employeeId}</TableCell>
                      <TableCell className="font-medium text-sm">{p.positionTitleEn}</TableCell>
                      <TableCell className="text-sm text-gray-500">{p.orgUnitId ?? '—'}</TableCell>
                      <TableCell className="text-sm text-gray-500">{p.dutyStationId ?? '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{p.postingType}</Badge></TableCell>
                      <TableCell className="text-sm">{fmtDate(p.startDate)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(p.endDate)}</TableCell>
                      <TableCell>
                        {p.isCurrent && <Badge className="bg-green-100 text-green-700 border-transparent text-xs">{t('Current','حالي')}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('New Posting','تكليف جديد')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2 max-h-[65vh] overflow-y-auto">
            {([['employeeId','Employee ID','رقم الموظف'],['positionTitleEn','Position EN','المسمى EN'],
              ['positionTitleAr','Position AR','المسمى AR'],['orgUnitId','Org Unit ID','رقم الوحدة'],
              ['dutyStationId','Duty Station ID','رقم المحطة']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input value={form[key as keyof typeof form]} onChange={e => setForm(p=>({...p,[key]:e.target.value}))} type={key==='employeeId'||key.endsWith('Id')?'number':'text'} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Posting Type','نوع التكليف')}</label>
              <Select value={form.postingType} onValueChange={v => setForm(p=>({...p,postingType:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{POSTING_TYPES.map(pt=><SelectItem key={pt} value={pt}>{pt}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Start Date','تاريخ البداية')}</label>
              <Input type="date" value={form.startDate} onChange={e => setForm(p=>({...p,startDate:e.target.value}))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('End Date','تاريخ النهاية')}</label>
              <Input type="date" value={form.endDate} onChange={e => setForm(p=>({...p,endDate:e.target.value}))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.employeeId || !form.startDate}
              onClick={() => createMutation.mutate({ data: { ...form, employeeId:Number(form.employeeId), orgUnitId:form.orgUnitId?Number(form.orgUnitId):null, dutyStationId:form.dutyStationId?Number(form.dutyStationId):null, endDate:form.endDate||null } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Create','إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Transfers Tab ────────────────────────────────────────────────────────────
function TransfersTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    employeeId:'', fromOrgUnitId:'', toOrgUnitId:'', transferDate:'',
    orderNumber:'', status:'draft', notes:'',
  });

  const { data: transfers, isLoading } = useListEmployeeTransfers();

  const createMutation = useCreateEmployeeTransfer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listEmployeeTransfers'] });
        setShowCreate(false);
        setForm({ employeeId:'', fromOrgUnitId:'', toOrgUnitId:'', transferDate:'', orderNumber:'', status:'draft', notes:'' });
        toast({ title: t('Transfer created','تم إنشاء النقل') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('New Transfer','نقل جديد')}
        </Button>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {isLoading ? <div className="p-4 space-y-2">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-10"/>)}</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee','الموظف')}</TableHead>
                    <TableHead>{t('From Unit','من وحدة')}</TableHead>
                    <TableHead>{t('To Unit','إلى وحدة')}</TableHead>
                    <TableHead>{t('Transfer Date','تاريخ النقل')}</TableHead>
                    <TableHead>{t('Order #','أمر رقم')}</TableHead>
                    <TableHead>{t('Status','الحالة')}</TableHead>
                    <TableHead>{t('Dual Auth','موافقة مزدوجة')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(transfers ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t('No transfers','لا توجد نقل')}</TableCell></TableRow>
                  ) : (transfers ?? []).map((tr: any) => (
                    <TableRow key={tr.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="text-sm">{tr.employeeId}</TableCell>
                      <TableCell className="text-sm text-gray-500">{tr.fromOrgUnitId ?? '—'}</TableCell>
                      <TableCell className="text-sm text-gray-500">{tr.toOrgUnitId ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(tr.transferDate)}</TableCell>
                      <TableCell className="font-mono text-xs">{tr.orderNumber ?? '—'}</TableCell>
                      <TableCell><Badge className={cn('text-xs border-transparent',statusColor(tr.status))}>{tr.status?.replace(/_/g,' ')}</Badge></TableCell>
                      <TableCell>
                        {tr.requiresDualAuth && <Badge className="bg-purple-100 text-purple-700 border-transparent text-xs">{t('Required','مطلوب')}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('New Transfer','نقل جديد')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {([['employeeId','Employee ID','رقم الموظف'],['fromOrgUnitId','From Unit ID','من وحدة'],
              ['toOrgUnitId','To Unit ID','إلى وحدة'],['orderNumber','Order Number','رقم الأمر'],
              ['transferDate','Transfer Date','تاريخ النقل']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input value={form[key as keyof typeof form]} onChange={e => setForm(p=>({...p,[key]:e.target.value}))}
                  type={key==='transferDate'?'date':key.endsWith('Id')||key==='employeeId'?'number':'text'} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Status','الحالة')}</label>
              <Select value={form.status} onValueChange={v => setForm(p=>({...p,status:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRANSFER_STATUSES.map(s=><SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.employeeId || !form.transferDate}
              onClick={() => createMutation.mutate({ data: { ...form, employeeId:Number(form.employeeId), fromOrgUnitId:form.fromOrgUnitId?Number(form.fromOrgUnitId):null, toOrgUnitId:form.toOrgUnitId?Number(form.toOrgUnitId):null } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Create','إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Secondments Tab ──────────────────────────────────────────────────────────
function SecondmentsTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    employeeId:'', hostOrgUnitId:'', startDate:'', endDate:'', status:'active', allowancePercentage:'',
  });

  const { data: secondments, isLoading } = useListEmployeeSecondments();

  const createMutation = useCreateEmployeeSecondment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listEmployeeSecondments'] });
        setShowCreate(false);
        setForm({ employeeId:'', hostOrgUnitId:'', startDate:'', endDate:'', status:'active', allowancePercentage:'' });
        toast({ title: t('Secondment created','تم إنشاء الإعارة') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('New Secondment','إعارة جديدة')}
        </Button>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {isLoading ? <div className="p-4 space-y-2">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-10"/>)}</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee','الموظف')}</TableHead>
                    <TableHead>{t('Host Unit','الوحدة المضيفة')}</TableHead>
                    <TableHead>{t('Start','البداية')}</TableHead>
                    <TableHead>{t('End','النهاية')}</TableHead>
                    <TableHead>{t('Status','الحالة')}</TableHead>
                    <TableHead>{t('Allowance %','بدل %')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(secondments ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">{t('No secondments','لا توجد إعارات')}</TableCell></TableRow>
                  ) : (secondments ?? []).map((s: any) => (
                    <TableRow key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="text-sm">{s.employeeId}</TableCell>
                      <TableCell className="text-sm text-gray-500">{s.hostOrgUnitId ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(s.startDate)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(s.endDate)}</TableCell>
                      <TableCell><Badge className={cn('text-xs border-transparent',statusColor(s.status))}>{s.status}</Badge></TableCell>
                      <TableCell className="text-sm">{s.allowancePercentage ? `${s.allowancePercentage}%` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('New Secondment','إعارة جديدة')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {([['employeeId','Employee ID','رقم الموظف'],['hostOrgUnitId','Host Unit ID','رقم الوحدة المضيفة'],
              ['startDate','Start Date','تاريخ البداية'],['endDate','End Date','تاريخ النهاية'],
              ['allowancePercentage','Allowance %','نسبة البدل']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input value={form[key as keyof typeof form]} onChange={e => setForm(p=>({...p,[key]:e.target.value}))}
                  type={key.includes('Date')?'date':key==='employeeId'||key.endsWith('Id')?'number':'text'} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Status','الحالة')}</label>
              <Select value={form.status} onValueChange={v => setForm(p=>({...p,status:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SECONDMENT_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.employeeId || !form.startDate}
              onClick={() => createMutation.mutate({ data: { ...form, employeeId:Number(form.employeeId), hostOrgUnitId:form.hostOrgUnitId?Number(form.hostOrgUnitId):null, allowancePercentage:form.allowancePercentage?String(form.allowancePercentage):null } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Create','إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Postings() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'postings'|'transfers'|'secondments'>('postings');

  const tabs = [
    { key: 'postings' as const, label: t('Postings','التكليفات'), icon: FileText },
    { key: 'transfers' as const, label: t('Transfers','النقل'), icon: ArrowRightLeft },
    { key: 'secondments' as const, label: t('Secondments','الإعارات'), icon: Users },
  ];

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Postings & Transfers','التكليفات والنقل')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Manage employee postings, transfers, and secondments','إدارة تكليفات الموظفين ونقلهم وإعاراتهم')}</p>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {tabs.map(tab_ => (
            <button key={tab_.key} onClick={() => setTab(tab_.key)}
              className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors', tab === tab_.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
              <tab_.icon className="w-4 h-4" />
              {tab_.label}
            </button>
          ))}
        </div>

        {tab === 'postings' && <PostingsTab />}
        {tab === 'transfers' && <TransfersTab />}
        {tab === 'secondments' && <SecondmentsTab />}
      </div>
    </AnimatedPage>
  );
}
