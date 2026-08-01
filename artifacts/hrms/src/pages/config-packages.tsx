import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListConfigPackages, useCreateConfigPackage, useImportConfigPackage,
  useSignConfigPackage, useExportConfigPackage, useApplyConfigPackage,
  useListEnvironmentSnapshots, useCreateEnvironmentSnapshot,
  useCompareEnvironmentSnapshots, usePinEnvironmentSnapshot, useUnpinEnvironmentSnapshot,
  getListConfigPackagesQueryKey, getListEnvironmentSnapshotsQueryKey,
} from '@workspace/api-client-react';
import type {
  ConfigPackage, EnvironmentSnapshot, CompareEnvironmentSnapshots200,
} from '@workspace/api-client-react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, AlertTriangle, Pin, PinOff, Camera, ArrowRight } from 'lucide-react';

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pkgTypeBadge(type: string) {
  if (type === 'full') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  if (type === 'delta') return 'bg-cyan-900/40 text-cyan-300 border-cyan-700';
  if (type === 'rollback') return 'bg-amber-900/40 text-amber-300 border-amber-700';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function pkgStatusBadge(status: string) {
  if (status === 'applied') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
  if (status === 'imported') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  if (status === 'signed') return 'bg-cyan-900/40 text-cyan-300 border-cyan-700';
  if (status === 'rejected') return 'bg-red-900/40 text-red-300 border-red-700';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function envBadge(env: string) {
  if (env === 'production') return 'bg-red-900/40 text-red-300 border-red-700';
  if (env === 'staging') return 'bg-amber-900/40 text-amber-300 border-amber-700';
  return 'bg-blue-900/40 text-blue-300 border-blue-700';
}

function CreatePackageDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const createMut = useCreateConfigPackage();
  const [form, setForm] = useState({ packageName: '', packageType: 'full', version: '1.0.0', sourceEnvironment: 'staging', targetEnvironment: 'production', descriptionEn: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  async function handleSave() {
    try {
      await createMut.mutateAsync({
        data: {
          packageName: form.packageName,
          packageType: form.packageType,
          version: form.version,
          sourceEnvironment: form.sourceEnvironment,
          targetEnvironment: form.targetEnvironment,
          descriptionEn: form.descriptionEn || null,
        },
      });
      toast({ title: t('Package created', 'تم إنشاء الحزمة') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
        <DialogHeader><DialogTitle>{t('Create Config Package', 'إنشاء حزمة إعدادات')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Package Name', 'اسم الحزمة')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.packageName} onChange={e => set('packageName', e.target.value)} /></div>
            <div><Label>{t('Version', 'الإصدار')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.version} onChange={e => set('version', e.target.value)} placeholder="1.0.0" /></div>
            <div><Label>{t('Type', 'النوع')}</Label>
              <Select value={form.packageType} onValueChange={v => set('packageType', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['full','delta','rollback'].map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('Source Env', 'بيئة المصدر')}</Label>
              <Select value={form.sourceEnvironment} onValueChange={v => set('sourceEnvironment', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['development','staging','production'].map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('Target Env', 'بيئة الهدف')}</Label>
              <Select value={form.targetEnvironment} onValueChange={v => set('targetEnvironment', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['development','staging','production'].map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>{t('Description', 'الوصف')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.descriptionEn} onChange={e => set('descriptionEn', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={createMut.isPending} className="bg-blue-600 hover:bg-blue-700">{createMut.isPending ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactPreviewDialog({ open, onClose, pkg, onApply }: { open: boolean; onClose: () => void; pkg: ConfigPackage | null; onApply: (reason: string) => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!pkg) return null;
  let impactPretty: string | null = null;
  if (pkg.impactPreviewJson) {
    try { impactPretty = JSON.stringify(JSON.parse(pkg.impactPreviewJson), null, 2); }
    catch { impactPretty = pkg.impactPreviewJson; }
  }
  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={v => !v && onClose()}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
          <DialogHeader><DialogTitle>{t('Impact Preview', 'معاينة التأثير')} — {pkg.packageName}</DialogTitle></DialogHeader>
          <pre className="bg-slate-900 border border-slate-700 rounded p-3 text-xs font-mono text-slate-300 overflow-auto max-h-64">
            {impactPretty ?? t('No impact data available', 'لا تتوفر بيانات التأثير')}
          </pre>
          <div><Label>{t('Apply Reason', 'سبب التطبيق')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={reason} onChange={e => setReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Close', 'إغلاق')}</Button>
            <Button onClick={() => setConfirmOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">{t('Apply Package', 'تطبيق الحزمة')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={v => !v && setConfirmOpen(false)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Apply Config Package?', 'تطبيق حزمة الإعدادات؟')}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">{t('This will apply changes to the target environment. This action is audit-logged.', 'سيتم تطبيق التغييرات على البيئة الهدف. هذا الإجراء مسجل تدقيقياً.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600">{t('Cancel', 'إلغاء')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onApply(reason); setConfirmOpen(false); }} className="bg-emerald-600 hover:bg-emerald-700">{t('Apply', 'تطبيق')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CaptureSnapshotDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const createMut = useCreateEnvironmentSnapshot();
  const [form, setForm] = useState({ snapshotName: '', environment: 'staging', scope: 'full' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  async function handleSave() {
    try {
      await createMut.mutateAsync({ data: form });
      toast({ title: t('Snapshot captured', 'تم التقاط اللقطة') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>{t('Capture Snapshot', 'التقاط لقطة')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Snapshot Name', 'اسم اللقطة')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.snapshotName} onChange={e => set('snapshotName', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Environment', 'البيئة')}</Label>
              <Select value={form.environment} onValueChange={v => set('environment', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['development','staging','production'].map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('Scope', 'النطاق')}</Label>
              <Select value={form.scope} onValueChange={v => set('scope', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['full','partial','policy_only'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={createMut.isPending} className="bg-blue-600 hover:bg-blue-700">{createMut.isPending ? t('Capturing…', 'جاري الالتقاط…') : t('Capture', 'التقاط')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConfigPackages() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: packages = [], isLoading: pkgsLoading } = useListConfigPackages();
  const { data: snapshots = [], isLoading: snapsLoading } = useListEnvironmentSnapshots();
  const loading = pkgsLoading || snapsLoading;
  const signMut = useSignConfigPackage();
  const exportMut = useExportConfigPackage();
  const applyMut = useApplyConfigPackage();
  const importMut = useImportConfigPackage();
  const compareMut = useCompareEnvironmentSnapshots();
  const pinMut = usePinEnvironmentSnapshot();
  const unpinMut = useUnpinEnvironmentSnapshot();
  const [createOpen, setCreateOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [impactPkg, setImpactPkg] = useState<ConfigPackage | null>(null);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareResult, setCompareResult] = useState<CompareEnvironmentSnapshots200 | null>(null);

  function refreshPackages() { queryClient.invalidateQueries({ queryKey: getListConfigPackagesQueryKey() }); }
  function refreshSnapshots() { queryClient.invalidateQueries({ queryKey: getListEnvironmentSnapshotsQueryKey() }); }

  async function signPackage(id: number) {
    try {
      await signMut.mutateAsync({ id });
      toast({ title: t('Package signed', 'تم توقيع الحزمة') });
      refreshPackages();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function exportPackage(id: number, name: string) {
    try {
      const data = await exportMut.mutateAsync({ id });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.json`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: t('Package exported', 'تم تصدير الحزمة') });
      refreshPackages();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function applyPackage(id: number, reason: string) {
    try {
      await applyMut.mutateAsync({ id, data: { reason: reason || null } });
      toast({ title: t('Package applied', 'تم تطبيق الحزمة') });
      setImpactPkg(null);
      refreshPackages();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function importPackage() {
    if (!importJson.trim()) return;
    let pkg: unknown;
    try { pkg = JSON.parse(importJson); }
    catch { toast({ title: t('Invalid JSON', 'JSON غير صالح'), variant: 'destructive' }); return; }
    try {
      await importMut.mutateAsync({ data: { packageJson: pkg } });
      toast({ title: t('Package imported', 'تم استيراد الحزمة') });
      setImportJson('');
      refreshPackages();
    } catch { toast({ title: t('Import failed', 'فشل الاستيراد'), variant: 'destructive' }); }
  }

  async function compareSnapshots() {
    if (!compareA || !compareB) return;
    try {
      const result = await compareMut.mutateAsync({ data: { snapshotIdA: parseInt(compareA), snapshotIdB: parseInt(compareB) } });
      setCompareResult(result);
    } catch { toast({ title: t('Compare failed', 'فشلت المقارنة'), variant: 'destructive' }); }
  }

  async function pinSnapshot(id: number) {
    try {
      await pinMut.mutateAsync({ id });
      refreshSnapshots();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function unpinSnapshot(id: number) {
    try {
      await unpinMut.mutateAsync({ id });
      refreshSnapshots();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  const rollbackPackages = packages.filter(p => p.isRollbackPackage);

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Package className="w-7 h-7 text-indigo-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Config Packages', 'حزم الإعدادات')}</h1>
            <p className="text-slate-400 text-sm">{t('Configuration import, export, snapshots, and rollback', 'استيراد وتصدير الإعدادات واللقطات والتراجع')}</p>
          </div>
        </div>

        <Tabs defaultValue="packages">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="packages" className="data-[state=active]:bg-slate-700">{t('Packages', 'الحزم')}</TabsTrigger>
            <TabsTrigger value="snapshots" className="data-[state=active]:bg-slate-700">{t('Snapshots', 'اللقطات')}</TabsTrigger>
            <TabsTrigger value="rollback" className="data-[state=active]:bg-slate-700">{t('Rollback History', 'سجل التراجع')}</TabsTrigger>
          </TabsList>

          {/* Packages Tab */}
          <TabsContent value="packages" className="mt-4 space-y-4">
            <div className="rounded-md border border-amber-700/50 bg-amber-900/30 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-amber-400 text-sm">{t('Package signing uses a server-side HMAC key. Ensure the same signing key is deployed on the target environment.', 'يستخدم توقيع الحزمة مفتاح HMAC من جانب الخادم. تأكد من نشر نفس مفتاح التوقيع في البيئة الهدف.')}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button onClick={() => setCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2"><span>+</span>{t('Create Package', 'إنشاء حزمة')}</Button>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loading ? <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 bg-slate-700" />)}</div> : (
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Name', 'الاسم')}</TableHead>
                      <TableHead className="text-slate-300">{t('Type', 'النوع')}</TableHead>
                      <TableHead className="text-slate-300">{t('Version', 'الإصدار')}</TableHead>
                      <TableHead className="text-slate-300">{t('Status', 'الحالة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Flow', 'التدفق')}</TableHead>
                      <TableHead className="text-slate-300">{t('Created', 'تاريخ الإنشاء')}</TableHead>
                      <TableHead className="text-slate-300">{t('Actions', 'الإجراءات')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {packages.filter(p => !p.isRollbackPackage).length === 0
                        ? <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">{t('No packages', 'لا توجد حزم')}</TableCell></TableRow>
                        : packages.filter(p => !p.isRollbackPackage).map(p => (
                          <TableRow key={p.id} className="border-slate-700 hover:bg-slate-700/30">
                            <TableCell className="text-white font-medium">{p.packageName}</TableCell>
                            <TableCell><Badge variant="outline" className={`text-xs ${pkgTypeBadge(p.packageType)}`}>{p.packageType}</Badge></TableCell>
                            <TableCell className="font-mono text-slate-300 text-sm">{p.version}</TableCell>
                            <TableCell><Badge variant="outline" className={`text-xs ${pkgStatusBadge(p.status)}`}>{p.status}</Badge></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 text-xs text-slate-400">
                                <Badge variant="outline" className={`text-xs ${envBadge(p.sourceEnvironment)}`}>{p.sourceEnvironment}</Badge>
                                <ArrowRight className="w-3 h-3" />
                                <Badge variant="outline" className={`text-xs ${envBadge(p.targetEnvironment)}`}>{p.targetEnvironment}</Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-400 text-sm">{fmtDate(p.createdAt)}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {p.status === 'draft' && <Button size="sm" variant="ghost" className="text-cyan-400 hover:text-cyan-300 h-7 px-2 text-xs" onClick={() => signPackage(p.id)}>{t('Sign', 'توقيع')}</Button>}
                                {p.status === 'signed' && <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300 h-7 px-2 text-xs" onClick={() => exportPackage(p.id, p.packageName)}>{t('Export', 'تصدير')}</Button>}
                                {p.status === 'imported' && <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-7 px-2 text-xs" onClick={() => setImpactPkg(p)}>{t('Preview & Apply', 'معاينة وتطبيق')}</Button>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader><CardTitle className="text-white text-sm">{t('Import Package (paste JSON or upload)', 'استيراد حزمة (الصق JSON أو ارفع ملفًا)')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Textarea className="bg-slate-700 border-slate-600 font-mono text-xs h-32 resize-none" value={importJson} onChange={e => setImportJson(e.target.value)} placeholder='{"packageName": "...", ...}' />
                <Button onClick={importPackage} disabled={importMut.isPending || !importJson.trim()} className="bg-indigo-600 hover:bg-indigo-700">
                  {importMut.isPending ? t('Importing…', 'جاري الاستيراد…') : t('Import', 'استيراد')}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Snapshots Tab */}
          <TabsContent value="snapshots" className="mt-4 space-y-4">
            <div className="flex justify-between items-start flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Label className="text-slate-300 text-sm shrink-0">{t('Compare:', 'مقارنة:')}</Label>
                <Select value={compareA} onValueChange={setCompareA}>
                  <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white text-sm h-8"><SelectValue placeholder={t('Snapshot A', 'لقطة أ')} /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {snapshots.map((s: EnvironmentSnapshot) => <SelectItem key={s.id} value={String(s.id)}>{s.snapshotName}</SelectItem>)}
                  </SelectContent>
                </Select>
                <ArrowRight className="w-4 h-4 text-slate-400" />
                <Select value={compareB} onValueChange={setCompareB}>
                  <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white text-sm h-8"><SelectValue placeholder={t('Snapshot B', 'لقطة ب')} /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {snapshots.map((s: EnvironmentSnapshot) => <SelectItem key={s.id} value={String(s.id)}>{s.snapshotName}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 h-8" onClick={compareSnapshots} disabled={compareMut.isPending}>{t('Compare', 'مقارنة')}</Button>
              </div>
              <Button onClick={() => setCaptureOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2 h-8 text-sm"><Camera className="w-4 h-4" />{t('Capture Snapshot', 'التقاط لقطة')}</Button>
            </div>

            {compareResult && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader><CardTitle className="text-white text-sm">{t('Comparison Result', 'نتيجة المقارنة')}</CardTitle></CardHeader>
                <CardContent>
                  <pre className="text-xs font-mono text-slate-300 bg-slate-900 border border-slate-700 rounded p-3 overflow-auto max-h-48">{JSON.stringify(compareResult, null, 2)}</pre>
                </CardContent>
              </Card>
            )}

            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loading ? <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div> : (
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Name', 'الاسم')}</TableHead>
                      <TableHead className="text-slate-300">{t('Environment', 'البيئة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Scope', 'النطاق')}</TableHead>
                      <TableHead className="text-slate-300">{t('Items', 'العناصر')}</TableHead>
                      <TableHead className="text-slate-300">{t('Captured', 'التقاط')}</TableHead>
                      <TableHead className="text-slate-300">{t('Pinned', 'مثبت')}</TableHead>
                      <TableHead className="text-slate-300">{t('Actions', 'الإجراءات')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {snapshots.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">{t('No snapshots', 'لا توجد لقطات')}</TableCell></TableRow>
                      : snapshots.map((s: EnvironmentSnapshot) => (
                        <TableRow key={s.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-white font-medium">{s.snapshotName}</TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${envBadge(s.environment)}`}>{s.environment}</Badge></TableCell>
                          <TableCell><Badge variant="outline" className="text-xs border-slate-600 text-slate-300">{s.scope}</Badge></TableCell>
                          <TableCell className="text-slate-300">{s.itemCount ?? '—'}</TableCell>
                          <TableCell className="text-slate-300 text-sm">{fmtDate(s.capturedAt)}</TableCell>
                          <TableCell>{s.isPinned ? <Badge variant="outline" className="text-xs bg-amber-900/40 text-amber-300 border-amber-700">{t('Pinned','مثبت')}</Badge> : <span className="text-slate-500 text-xs">—</span>}</TableCell>
                          <TableCell>
                            {!s.isPinned ? (
                              <Button size="sm" variant="ghost" className="text-slate-400 hover:text-slate-300 h-7 px-2 text-xs" onClick={() => pinSnapshot(s.id)}>
                                <Pin className="w-3 h-3 me-1" />{t('Pin', 'تثبيت')}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300 h-7 px-2 text-xs" onClick={() => unpinSnapshot(s.id)}>
                                <PinOff className="w-3 h-3 me-1" />{t('Unpin', 'إلغاء التثبيت')}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rollback History Tab */}
          <TabsContent value="rollback" className="mt-4">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loading ? <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div> : (
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Package Name', 'اسم الحزمة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Rollback Of', 'تراجع عن')}</TableHead>
                      <TableHead className="text-slate-300">{t('Reason', 'السبب')}</TableHead>
                      <TableHead className="text-slate-300">{t('Applied', 'مُطبَّق')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rollbackPackages.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">{t('No rollback history', 'لا يوجد سجل تراجع')}</TableCell></TableRow>
                      : rollbackPackages.map(p => (
                        <TableRow key={p.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-white font-medium">{p.packageName}</TableCell>
                          <TableCell className="text-slate-300 text-sm">{p.rollbackOfPackageId != null ? `#${p.rollbackOfPackageId}` : '—'}</TableCell>
                          <TableCell className="text-slate-400 text-sm max-w-48 truncate">{p.descriptionEn ?? '—'}</TableCell>
                          <TableCell className="text-slate-300 text-sm">{fmtDate(p.appliedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <CreatePackageDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refreshPackages} />
        <CaptureSnapshotDialog open={captureOpen} onClose={() => setCaptureOpen(false)} onSaved={refreshSnapshots} />
        <ImpactPreviewDialog open={!!impactPkg} onClose={() => setImpactPkg(null)} pkg={impactPkg} onApply={(reason) => impactPkg && applyPackage(impactPkg.id, reason)} />
      </div>
    </AnimatedPage>
  );
}
