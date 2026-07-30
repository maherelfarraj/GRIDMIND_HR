import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Building2, Plus, Eye, Archive, CheckCircle, Globe, Palette, GitBranch } from 'lucide-react';
import { Link } from 'wouter';

function orgTypeBadge(type: string) {
  const map: Record<string, string> = {
    company: 'bg-blue-900/40 text-blue-300 border-blue-700',
    ministry: 'bg-purple-900/40 text-purple-300 border-purple-700',
    agency: 'bg-cyan-900/40 text-cyan-300 border-cyan-700',
    command: 'bg-amber-900/40 text-amber-300 border-amber-700',
    military_unit: 'bg-green-900/40 text-green-300 border-green-700',
  };
  return map[type] ?? 'bg-slate-700 text-slate-300 border-slate-600';
}

function statusBadge(status: string) {
  if (status === 'active') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
  if (status === 'onboarding') return 'bg-amber-900/40 text-amber-300 border-amber-700';
  if (status === 'archived') return 'bg-slate-700 text-slate-400 border-slate-600';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function AddOrgDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    orgCode: '', nameEn: '', nameAr: '', orgType: '', registrationNumber: '',
    countryCode: '', primaryContactEmail: '',
  });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.orgCode || !form.nameEn || !form.orgType) {
      toast({ title: t('Required fields missing', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: t('Organization created', 'تم إنشاء المؤسسة') });
      onSaved();
      onClose();
      setForm({ orgCode: '', nameEn: '', nameAr: '', orgType: '', registrationNumber: '', countryCode: '', primaryContactEmail: '' });
    } catch {
      toast({ title: t('Error saving', 'خطأ في الحفظ'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>{t('Add Organization', 'إضافة مؤسسة')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div><Label>{t('Org Code', 'رمز المؤسسة')} *</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.orgCode} onChange={e => set('orgCode', e.target.value)} /></div>
          <div>
            <Label>{t('Type', 'النوع')} *</Label>
            <Select value={form.orgType} onValueChange={v => set('orgType', v)}>
              <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue placeholder={t('Select', 'اختر')} /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {['company','ministry','agency','command','military_unit'].map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>{t('Name (English)', 'الاسم بالإنجليزية')} *</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.nameEn} onChange={e => set('nameEn', e.target.value)} /></div>
          <div className="col-span-2"><Label>{t('Name (Arabic)', 'الاسم بالعربية')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" dir="rtl" value={form.nameAr} onChange={e => set('nameAr', e.target.value)} /></div>
          <div><Label>{t('Registration No.', 'رقم التسجيل')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.registrationNumber} onChange={e => set('registrationNumber', e.target.value)} /></div>
          <div><Label>{t('Country Code', 'رمز البلد')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.countryCode} onChange={e => set('countryCode', e.target.value)} placeholder="SA" /></div>
          <div className="col-span-2"><Label>{t('Primary Contact Email', 'البريد الإلكتروني للتواصل')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="email" value={form.primaryContactEmail} onChange={e => set('primaryContactEmail', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrgDetailDrawer({ org, onClose }: { org: any; onClose: () => void }) {
  const { t } = useLanguage();
  if (!org) return null;
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/50" />
      <div className="w-96 bg-slate-800 border-l border-slate-700 h-full overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{org.nameEn}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400">✕</Button>
        </div>
        <Card className="bg-slate-700 border-slate-600">
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">{t('Code', 'الرمز')}</span><span className="text-white font-mono">{org.orgCode}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Arabic Name', 'الاسم بالعربية')}</span><span className="text-white" dir="rtl">{org.nameAr || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Type', 'النوع')}</span><Badge variant="outline" className={orgTypeBadge(org.orgType)}>{org.orgType}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Status', 'الحالة')}</span><Badge variant="outline" className={statusBadge(org.status)}>{org.status}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Country', 'البلد')}</span><span className="text-white">{org.countryCode || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Registration', 'التسجيل')}</span><span className="text-white font-mono">{org.registrationNumber || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Contact Email', 'البريد الإلكتروني')}</span><span className="text-white text-xs">{org.primaryContactEmail || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('Employees', 'الموظفون')}</span><span className="text-white">{org.employeeCount ?? 0}</span></div>
          </CardContent>
        </Card>
        <Separator className="bg-slate-700" />
        <div className="space-y-2">
          <p className="text-xs text-slate-400 uppercase tracking-wider">{t('Quick Navigation', 'التنقل السريع')}</p>
          <Link href="/org-branding"><div className="flex items-center gap-2 p-2 rounded hover:bg-slate-700 cursor-pointer text-blue-400 text-sm"><Palette className="w-4 h-4" />{t('Branding & White-Label', 'الهوية البصرية')}</div></Link>
          <Link href="/policy-localization"><div className="flex items-center gap-2 p-2 rounded hover:bg-slate-700 cursor-pointer text-blue-400 text-sm"><Globe className="w-4 h-4" />{t('Policy Localization', 'السياسات المحلية')}</div></Link>
          <Link href="/policy-governance"><div className="flex items-center gap-2 p-2 rounded hover:bg-slate-700 cursor-pointer text-blue-400 text-sm"><GitBranch className="w-4 h-4" />{t('Policy Governance', 'حوكمة السياسات')}</div></Link>
        </div>
      </div>
    </div>
  );
}

export default function Organizations() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [detailOrg, setDetailOrg] = useState<any>(null);
  const [archiveTarget, setArchiveTarget] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/organizations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOrgs(Array.isArray(data) ? data : (data.organizations ?? []));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleActivate(org: any) {
    try {
      await fetch(`/api/organizations/${org.id}/activate`, { method: 'POST' });
      toast({ title: t('Organization activated', 'تم تفعيل المؤسسة') });
      load();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    try {
      await fetch(`/api/organizations/${archiveTarget.id}/archive`, { method: 'POST' });
      toast({ title: t('Organization archived', 'تم أرشفة المؤسسة') });
      setArchiveTarget(null);
      load();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-7 h-7 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">{t('Organizations', 'المؤسسات')}</h1>
              <p className="text-slate-400 text-sm">{t('Multi-organization management', 'إدارة المؤسسات المتعددة')}</p>
            </div>
          </div>
          <Button onClick={() => setAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />{t('Add Organization', 'إضافة مؤسسة')}
          </Button>
        </div>

        {error && (
          <Card className="bg-red-900/30 border-red-700">
            <CardContent className="p-4 text-red-300 text-sm">{t('Failed to load organizations', 'فشل تحميل المؤسسات')}: {error}</CardContent>
          </Card>
        )}

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader><CardTitle className="text-white text-base">{t('All Organizations', 'جميع المؤسسات')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 bg-slate-700/50">
                    <TableHead className="text-slate-300">{t('Code', 'الرمز')}</TableHead>
                    <TableHead className="text-slate-300">{t('Name (EN)', 'الاسم (إنجليزي)')}</TableHead>
                    <TableHead className="text-slate-300">{t('Name (AR)', 'الاسم (عربي)')}</TableHead>
                    <TableHead className="text-slate-300">{t('Type', 'النوع')}</TableHead>
                    <TableHead className="text-slate-300">{t('Status', 'الحالة')}</TableHead>
                    <TableHead className="text-slate-300 text-right">{t('Employees', 'الموظفون')}</TableHead>
                    <TableHead className="text-slate-300">{t('Actions', 'الإجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">{t('No organizations found', 'لا توجد مؤسسات')}</TableCell></TableRow>
                  ) : orgs.map(org => (
                    <TableRow key={org.id} className="border-slate-700 hover:bg-slate-700/30">
                      <TableCell className="font-mono text-slate-300 text-sm">{org.orgCode}</TableCell>
                      <TableCell className="text-white font-medium">{org.nameEn}</TableCell>
                      <TableCell className="text-slate-300" dir="rtl">{org.nameAr || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className={orgTypeBadge(org.orgType)}>{org.orgType}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className={statusBadge(org.status)}>{org.status}</Badge></TableCell>
                      <TableCell className="text-right text-slate-300">{org.employeeCount ?? 0}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300 h-7 px-2" onClick={() => setDetailOrg(org)}>
                            <Eye className="w-3.5 h-3.5 me-1" />{t('View', 'عرض')}
                          </Button>
                          {org.status === 'onboarding' && (
                            <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-7 px-2" onClick={() => handleActivate(org)}>
                              <CheckCircle className="w-3.5 h-3.5 me-1" />{t('Activate', 'تفعيل')}
                            </Button>
                          )}
                          {org.status !== 'archived' && (
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 px-2" onClick={() => setArchiveTarget(org)}>
                              <Archive className="w-3.5 h-3.5 me-1" />{t('Archive', 'أرشفة')}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AddOrgDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />

        {detailOrg && <OrgDetailDrawer org={detailOrg} onClose={() => setDetailOrg(null)} />}

        <AlertDialog open={!!archiveTarget} onOpenChange={v => !v && setArchiveTarget(null)}>
          <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Archive Organization?', 'أرشفة المؤسسة؟')}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                {t('This will archive', 'سيتم أرشفة')} <strong className="text-white">{archiveTarget?.nameEn}</strong>. {t('This action is audit-logged.', 'هذا الإجراء مسجل تدقيقياً.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-slate-600">{t('Cancel', 'إلغاء')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleArchive} className="bg-red-600 hover:bg-red-700">{t('Archive', 'أرشفة')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AnimatedPage>
  );
}
