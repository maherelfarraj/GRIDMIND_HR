import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import { useListSecurityClearances, useCreateSecurityClearance, useUpdateSecurityClearance } from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
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
import { Plus, Loader2, ShieldAlert, Shield, ShieldCheck, ShieldOff, AlertTriangle, Pencil } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
const CLEARANCE_LEVELS = ['unclassified','restricted','confidential','secret','top_secret','sci'];
const CLEARANCE_STATUSES = ['active','suspended','revoked','expired','pending'];

const LEVEL_BADGE: Record<string, { cls: string; label: string }> = {
  unclassified: { cls: 'bg-gray-100 text-gray-600 border-transparent', label: 'UNCLASSIFIED' },
  restricted: { cls: 'bg-blue-100 text-blue-700 border-transparent', label: 'RESTRICTED' },
  confidential: { cls: 'bg-yellow-100 text-yellow-700 border-transparent', label: 'CONFIDENTIAL' },
  secret: { cls: 'bg-orange-100 text-orange-700 border-transparent', label: 'SECRET' },
  top_secret: { cls: 'bg-red-100 text-red-700 border-transparent', label: 'TOP SECRET' },
  sci: { cls: 'bg-purple-100 text-purple-700 border-transparent', label: 'SCI' },
};

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700 border-transparent',
  suspended: 'bg-yellow-100 text-yellow-700 border-transparent',
  revoked: 'bg-red-100 text-red-700 border-transparent',
  expired: 'bg-gray-100 text-gray-500 border-transparent',
  pending: 'bg-blue-100 text-blue-700 border-transparent',
};

const LEVEL_ORDER: Record<string, number> = {
  sci: 6, top_secret: 5, secret: 4, confidential: 3, restricted: 2, unclassified: 1,
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function isExpiringSoon(expiryDate: string | null | undefined) {
  if (!expiryDate) return false;
  const diff = new Date(expiryDate).getTime() - Date.now();
  return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000;
}

// ─── Create/Edit Dialog ───────────────────────────────────────────────────────
function ClearanceDialog({ open, onClose, editRecord }: { open: boolean; onClose: () => void; editRecord?: any }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employeeId: editRecord?.employeeId ? String(editRecord.employeeId) : '',
    clearanceLevel: editRecord?.clearanceLevel ?? 'confidential',
    status: editRecord?.status ?? 'active',
    grantedDate: editRecord?.grantedDate ?? '',
    expiryDate: editRecord?.expiryDate ?? '',
    investigationAuthority: editRecord?.investigationAuthority ?? '',
  });

  const createMutation = useCreateSecurityClearance({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listSecurityClearances'] });
        onClose();
        toast({ title: t('Clearance created','تم إنشاء التصريح الأمني') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const updateMutation = useUpdateSecurityClearance({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listSecurityClearances'] });
        onClose();
        toast({ title: t('Clearance updated','تم تحديث التصريح') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    const data = {
      ...form,
      employeeId: Number(form.employeeId),
      expiryDate: form.expiryDate || null,
    };
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, data } as any);
    } else {
      createMutation.mutate({ data } as any);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editRecord ? t('Edit Clearance','تعديل التصريح') : t('New Security Clearance','تصريح أمني جديد')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Employee ID','رقم الموظف')}</label>
            <Input type="number" value={form.employeeId} onChange={e => setForm(p=>({...p, employeeId:e.target.value}))} disabled={!!editRecord} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Clearance Level','مستوى التصريح')}</label>
              <Select value={form.clearanceLevel} onValueChange={v => setForm(p=>({...p,clearanceLevel:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CLEARANCE_LEVELS.map(l => <SelectItem key={l} value={l}>{l.replace('_',' ').toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Status','الحالة')}</label>
              <Select value={form.status} onValueChange={v => setForm(p=>({...p,status:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CLEARANCE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Granted Date','تاريخ المنح')}</label>
              <Input type="date" value={form.grantedDate} onChange={e => setForm(p=>({...p,grantedDate:e.target.value}))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Expiry Date','تاريخ الانتهاء')}</label>
              <Input type="date" value={form.expiryDate} onChange={e => setForm(p=>({...p,expiryDate:e.target.value}))} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Investigation Authority','جهة التحقيق')}</label>
            <Input value={form.investigationAuthority} onChange={e => setForm(p=>({...p,investigationAuthority:e.target.value}))} placeholder={t('e.g. Military Intelligence','مثال: الاستخبارات العسكرية')} />
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
export default function SecurityClearances() {
  const { t } = useLanguage();
  const [showCreate, setShowCreate] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);

  const { data: clearances, isLoading } = useListSecurityClearances();

  const sorted = useMemo(() => {
    return [...(clearances ?? [])].sort((a: any, b: any) =>
      (LEVEL_ORDER[b.clearanceLevel] ?? 0) - (LEVEL_ORDER[a.clearanceLevel] ?? 0)
    );
  }, [clearances]);

  // Summary stats
  const total = sorted.length;
  const active = sorted.filter((c: any) => c.status === 'active').length;
  const expiringSoon = sorted.filter((c: any) => isExpiringSoon(c.expiryDate)).length;
  const revokedExpired = sorted.filter((c: any) => ['revoked','expired'].includes(c.status)).length;

  const stats = [
    { label: t('Total Cleared','إجمالي المصرح لهم'), value: total, icon: Shield, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: t('Active Clearances','التصاريح النشطة'), value: active, icon: ShieldCheck, color: 'text-green-600', bg: 'bg-green-50' },
    { label: t('Expiring Soon','تنتهي قريباً'), value: expiringSoon, icon: ShieldAlert, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: t('Revoked / Expired','ملغاة / منتهية'), value: revokedExpired, icon: ShieldOff, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Security Clearances','التصاريح الأمنية')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Manage personnel security clearances and access levels','إدارة التصاريح الأمنية ومستويات الوصول')}</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-4 h-4 mr-2" />{t('New Clearance','تصريح جديد')}
          </Button>
        </div>

        {/* Warning banner */}
        <Alert className="border-yellow-400/40 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-700 dark:text-yellow-400">
            {t('⚠️ Security clearance records are restricted. All access is logged. Unauthorized access triggers automatic notification.','⚠️ سجلات التصاريح الأمنية مقيدة. يتم تسجيل جميع عمليات الوصول. الوصول غير المصرح به يطلق إشعاراً تلقائياً.')}
          </AlertDescription>
        </Alert>

        {/* Summary cards */}
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

        {/* Main table */}
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{[...Array(6)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Shield className="w-10 h-10 mb-3 opacity-30" />
                <p>{t('No clearance records found','لا توجد سجلات تصاريح')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Employee','الموظف')}</TableHead>
                      <TableHead>{t('Clearance Level','مستوى التصريح')}</TableHead>
                      <TableHead>{t('Status','الحالة')}</TableHead>
                      <TableHead>{t('Granted Date','تاريخ المنح')}</TableHead>
                      <TableHead>{t('Expiry Date','تاريخ الانتهاء')}</TableHead>
                      <TableHead>{t('Authority','الجهة')}</TableHead>
                      <TableHead>{t('Dual Auth','موافقة مزدوجة')}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((c: any) => {
                      const lvlCfg = LEVEL_BADGE[c.clearanceLevel] ?? LEVEL_BADGE.unclassified;
                      const expiring = isExpiringSoon(c.expiryDate);
                      const expired = c.expiryDate && new Date(c.expiryDate) < new Date();
                      return (
                        <TableRow key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <TableCell className="font-medium text-sm">{c.employeeId}</TableCell>
                          <TableCell>
                            <Badge className={cn('text-xs font-semibold', lvlCfg.cls)}>{lvlCfg.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn('text-xs border-transparent', STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-600')}>{c.status}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{fmtDate(c.grantedDate)}</TableCell>
                          <TableCell className={cn('text-sm', expired ? 'text-red-600 font-medium' : expiring ? 'text-orange-600 font-medium' : '')}>
                            {fmtDate(c.expiryDate)}
                            {expiring && !expired && <span className="ml-1 text-xs text-orange-500">⚠</span>}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">{c.investigationAuthority ?? '—'}</TableCell>
                          <TableCell>
                            {c.requiresDualAuth && <Badge className="bg-purple-100 text-purple-700 border-transparent text-xs">{t('Required','مطلوب')}</Badge>}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => setEditRecord(c)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
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

        {/* Dialogs */}
        <ClearanceDialog open={showCreate} onClose={() => setShowCreate(false)} />
        {editRecord && <ClearanceDialog open={!!editRecord} onClose={() => setEditRecord(null)} editRecord={editRecord} />}
      </div>
    </AnimatedPage>
  );
}
