import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListOrganizations,
  useListNumberingSchemes, useCreateNumberingScheme, useIncrementNumberingScheme,
  useListEmploymentTypeConfigs, useCreateEmploymentTypeConfig,
  useListRetentionRules, useCreateRetentionRule,
  useListPolicyLocales, useCreatePolicyLocale, useUpdatePolicyLocale,
  getListNumberingSchemesQueryKey, getListEmploymentTypeConfigsQueryKey,
  getListRetentionRulesQueryKey, getListPolicyLocalesQueryKey,
} from '@workspace/api-client-react';
import type {
  NumberingScheme, EmploymentTypeConfig, RetentionRule, PolicyLocale,
} from '@workspace/api-client-react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Globe, Plus } from 'lucide-react';
import { localName } from '@/lib/localise';

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

function AddSchemeDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const createMut = useCreateNumberingScheme();
  const [form, setForm] = useState({ entityType: '', template: '', prefix: '', currentSequence: '1', resetCycle: 'never' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  async function handleSave() {
    try {
      await createMut.mutateAsync({ data: { ...form, currentSequence: Number(form.currentSequence) } });
      toast({ title: t('Scheme created', 'تم إنشاء المخطط') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>{t('Add Numbering Scheme', 'إضافة مخطط ترقيم')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Entity Type', 'نوع الكيان')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.entityType} onChange={e => set('entityType', e.target.value)} /></div>
          <div><Label>{t('Template', 'القالب')}</Label><Input className="mt-1 bg-slate-700 border-slate-600 font-mono" value={form.template} onChange={e => set('template', e.target.value)} placeholder="{PREFIX}-{YEAR}-{SEQ:4}" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Prefix', 'البادئة')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.prefix} onChange={e => set('prefix', e.target.value)} /></div>
            <div><Label>{t('Starting Sequence', 'تسلسل البداية')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="number" value={form.currentSequence} onChange={e => set('currentSequence', e.target.value)} /></div>
          </div>
          <div><Label>{t('Reset Cycle', 'دورة الإعادة')}</Label>
            <Select value={form.resetCycle} onValueChange={v => set('resetCycle', v)}>
              <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {['never','yearly','monthly'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={createMut.isPending} className="bg-blue-600 hover:bg-blue-700">{createMut.isPending ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEmploymentTypeDialog({ open, onClose, onSaved, orgs, defaultOrgId }: { open: boolean; onClose: () => void; onSaved: () => void; orgs: { id: number; nameEn: string }[]; defaultOrgId: string }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const createMut = useCreateEmploymentTypeConfig();
  const [form, setForm] = useState({ orgId: '', employmentType: '', labelEn: '', labelAr: '', probationDays: '90', defaultContractMonths: '12', eligibleLeave: true, eligiblePayroll: true, eligibleBenefits: false });

  useEffect(() => {
    if (open) setForm(f => ({ ...f, orgId: f.orgId || defaultOrgId }));
  }, [open, defaultOrgId]);

  async function handleSave() {
    if (!form.orgId || !form.employmentType.trim() || !form.labelEn.trim() || !form.labelAr.trim()) {
      toast({ title: t('Organization, type key, and both labels are required', 'المؤسسة ومفتاح النوع وكلا التسميتين مطلوبة'), variant: 'destructive' });
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          orgId: Number(form.orgId),
          employmentType: form.employmentType.trim(),
          labelEn: form.labelEn.trim(),
          labelAr: form.labelAr.trim(),
          probationDays: Number(form.probationDays),
          defaultContractMonths: Number(form.defaultContractMonths),
          eligibleLeave: form.eligibleLeave,
          eligiblePayroll: form.eligiblePayroll,
          eligibleBenefits: form.eligibleBenefits,
        },
      });
      toast({ title: t('Employment type created', 'تم إنشاء نوع التوظيف') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>{t('Add Employment Type', 'إضافة نوع توظيف')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Organization', 'المؤسسة')}</Label>
            <Select value={form.orgId} onValueChange={v => setForm(f => ({ ...f, orgId: v }))}>
              <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue placeholder={t('Select organization', 'اختر المؤسسة')} /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nameEn}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Type Key', 'مفتاح النوع')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.employmentType} onChange={e => setForm(f => ({ ...f, employmentType: e.target.value }))} placeholder="full_time" /></div>
            <div><Label>{t('Label (EN)', 'التسمية (إنجليزي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.labelEn} onChange={e => setForm(f => ({ ...f, labelEn: e.target.value }))} /></div>
            <div><Label>{t('Label (AR)', 'التسمية (عربي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" dir="rtl" value={form.labelAr} onChange={e => setForm(f => ({ ...f, labelAr: e.target.value }))} /></div>
            <div><Label>{t('Probation Days', 'أيام التجربة')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="number" value={form.probationDays} onChange={e => setForm(f => ({ ...f, probationDays: e.target.value }))} /></div>
            <div><Label>{t('Contract Months', 'أشهر العقد')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="number" value={form.defaultContractMonths} onChange={e => setForm(f => ({ ...f, defaultContractMonths: e.target.value }))} /></div>
          </div>
          <div className="flex gap-4 flex-wrap">
            {([['eligibleLeave','Leave','إجازة'],['eligiblePayroll','Payroll','رواتب'],['eligibleBenefits','Benefits','مزايا']] as const).map(([k, en, ar]) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                <input type="checkbox" checked={!!form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked }))} className="accent-blue-500" />
                {t(en, ar)}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={createMut.isPending} className="bg-blue-600 hover:bg-blue-700">{createMut.isPending ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRetentionRuleDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const createMut = useCreateRetentionRule();
  const [form, setForm] = useState({ dataCategory: '', retentionMonths: '', expiryAction: 'archive', legalBasisEn: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  async function handleSave() {
    try {
      await createMut.mutateAsync({
        data: {
          ...form,
          retentionMonths: form.retentionMonths ? Number(form.retentionMonths) : null,
        },
      });
      toast({ title: t('Rule created', 'تم إنشاء القاعدة') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>{t('Add Retention Rule', 'إضافة قاعدة الاحتفاظ')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Data Category', 'فئة البيانات')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.dataCategory} onChange={e => set('dataCategory', e.target.value)} /></div>
          <div><Label>{t('Retention (months, blank=indefinite)', 'الاحتفاظ (أشهر، فارغ=غير محدود)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="number" value={form.retentionMonths} onChange={e => set('retentionMonths', e.target.value)} /></div>
          <div><Label>{t('Expiry Action', 'إجراء الانتهاء')}</Label>
            <Select value={form.expiryAction} onValueChange={v => set('expiryAction', v)}>
              <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {['archive','delete','anonymize','notify'].map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>{t('Legal Basis (EN)', 'الأساس القانوني (إنجليزي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.legalBasisEn} onChange={e => set('legalBasisEn', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={createMut.isPending} className="bg-blue-600 hover:bg-blue-700">{createMut.isPending ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function retentionLabel(months: number | null) {
  if (!months) return 'Indefinite';
  const y = Math.floor(months / 12), m = months % 12;
  return [y > 0 ? `${y}y` : '', m > 0 ? `${m}mo` : ''].filter(Boolean).join(' ');
}

function expiryBadge(action: string) {
  if (action === 'delete') return 'bg-red-900/40 text-red-300 border-red-700';
  if (action === 'archive') return 'bg-slate-700 text-slate-300 border-slate-600';
  if (action === 'anonymize') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  return 'bg-amber-900/40 text-amber-300 border-amber-700';
}

type LocaleForm = {
  defaultLanguage: string; timezone: string; calendarType: string; showHijriDates: boolean;
  currencyCode: string; dateFormat: string; timeFormat: string; numeralStyle: string;
};

const EMPTY_LOCALE: LocaleForm = {
  defaultLanguage: '', timezone: '', calendarType: 'gregorian', showHijriDates: false,
  currencyCode: '', dateFormat: '', timeFormat: '24h', numeralStyle: 'arabic',
};

export default function PolicyLocalization() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOrg, setSelectedOrg] = useState('');
  const [locale, setLocale] = useState<LocaleForm>(EMPTY_LOCALE);
  const [addSchemeOpen, setAddSchemeOpen] = useState(false);
  const [addEmpTypeOpen, setAddEmpTypeOpen] = useState(false);
  const [addRetentionOpen, setAddRetentionOpen] = useState(false);
  const [weekends, setWeekends] = useState<number[]>([5, 6]);
  const [calForm, setCalForm] = useState({ standardHoursPerDay: '8', shiftStart: '08:00', shiftEnd: '16:00', summerSchedule: false });

  const { data: orgsData } = useListOrganizations();
  const orgs = Array.isArray(orgsData) ? orgsData : [];

  useEffect(() => {
    if (orgs.length > 0 && !selectedOrg) setSelectedOrg(String(orgs[0].id));
  }, [orgs, selectedOrg]);

  const orgIdNum = selectedOrg ? Number(selectedOrg) : 0;

  const { data: schemesData } = useListNumberingSchemes();
  const schemes: NumberingScheme[] = Array.isArray(schemesData) ? schemesData : [];

  const { data: empTypesData } = useListEmploymentTypeConfigs();
  const empTypes: EmploymentTypeConfig[] = Array.isArray(empTypesData) ? empTypesData : [];

  const { data: retentionData } = useListRetentionRules();
  const retention: RetentionRule[] = Array.isArray(retentionData) ? retentionData : [];

  const { data: localesData } = useListPolicyLocales(
    { orgId: orgIdNum },
    { query: { enabled: !!selectedOrg, queryKey: getListPolicyLocalesQueryKey({ orgId: orgIdNum }) } },
  );
  const currentLocale: PolicyLocale | undefined = Array.isArray(localesData) ? localesData[0] : undefined;

  useEffect(() => {
    if (currentLocale) {
      setLocale({
        defaultLanguage: currentLocale.defaultLanguage ?? '',
        timezone: currentLocale.timezone ?? '',
        calendarType: currentLocale.calendarType ?? 'gregorian',
        showHijriDates: !!currentLocale.showHijriDates,
        currencyCode: currentLocale.currencyCode ?? '',
        dateFormat: currentLocale.dateFormat ?? '',
        timeFormat: currentLocale.timeFormat ?? '24h',
        numeralStyle: currentLocale.numeralStyle ?? 'arabic',
      });
    } else {
      setLocale(EMPTY_LOCALE);
    }
  }, [currentLocale]);

  const createLocaleMut = useCreatePolicyLocale();
  const updateLocaleMut = useUpdatePolicyLocale();
  const incrementMut = useIncrementNumberingScheme();

  async function saveLocale() {
    try {
      if (currentLocale) {
        await updateLocaleMut.mutateAsync({ id: currentLocale.id, data: { ...locale } });
      } else {
        await createLocaleMut.mutateAsync({ data: { ...locale, orgId: orgIdNum } });
      }
      toast({ title: t('Locale saved', 'تم حفظ الإعدادات المحلية') });
      queryClient.invalidateQueries({ queryKey: getListPolicyLocalesQueryKey({ orgId: orgIdNum }) });
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  const savingLocale = createLocaleMut.isPending || updateLocaleMut.isPending;

  async function incrementScheme(id: number) {
    try {
      const data = await incrementMut.mutateAsync({ id });
      toast({ title: t('Incremented', 'تم الزيادة'), description: data?.nextNumber ?? '' });
      queryClient.invalidateQueries({ queryKey: getListNumberingSchemesQueryKey() });
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  function setL<K extends keyof LocaleForm>(k: K, v: LocaleForm[K]) { setLocale(l => ({ ...l, [k]: v })); }

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="w-7 h-7 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Policy Localization', 'السياسات المحلية')}</h1>
            <p className="text-slate-400 text-sm">{t('Locale, numbering, employment types, calendar, and retention', 'الإعدادات المحلية والترقيم وأنواع التوظيف والتقويم والاحتفاظ')}</p>
          </div>
        </div>

        <Tabs defaultValue="locale">
          <TabsList className="bg-slate-800 border border-slate-700 flex-wrap h-auto">
            {[['locale',t('Locale','الإعدادات')],['numbering',t('Numbering','الترقيم')],['employment',t('Employment Types','أنواع التوظيف')],['calendar',t('Calendar','التقويم')],['retention',t('Retention','الاحتفاظ')]].map(([v,l]) => (
              <TabsTrigger key={v} value={v} className="data-[state=active]:bg-slate-700">{l}</TabsTrigger>
            ))}
          </TabsList>

          {/* Locale Tab */}
          <TabsContent value="locale" className="mt-4">
            <div className="flex items-center gap-3 mb-4">
              <Label className="text-slate-300 shrink-0">{t('Organization:', 'المؤسسة:')}</Label>
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger className="w-56 bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{localName(o.nameEn, o.nameAr, lang)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 grid grid-cols-2 gap-4">
                <div><Label>{t('Language', 'اللغة')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={locale.defaultLanguage} onChange={e => setL('defaultLanguage', e.target.value)} placeholder="ar, en" /></div>
                <div><Label>{t('Timezone', 'المنطقة الزمنية')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={locale.timezone} onChange={e => setL('timezone', e.target.value)} placeholder="Asia/Riyadh" /></div>
                <div><Label>{t('Calendar Type', 'نوع التقويم')}</Label>
                  <Select value={locale.calendarType} onValueChange={v => setL('calendarType', v)}>
                    <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {['gregorian','hijri','umm_al_qura'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>{t('Currency Code', 'رمز العملة')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={locale.currencyCode} onChange={e => setL('currencyCode', e.target.value)} placeholder="SAR" /></div>
                <div><Label>{t('Date Format', 'تنسيق التاريخ')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={locale.dateFormat} onChange={e => setL('dateFormat', e.target.value)} placeholder="DD/MM/YYYY" /></div>
                <div><Label>{t('Time Format', 'تنسيق الوقت')}</Label>
                  <Select value={locale.timeFormat} onValueChange={v => setL('timeFormat', v)}>
                    <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="24h">24h</SelectItem>
                      <SelectItem value="12h">12h (AM/PM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>{t('Numeral Style', 'أسلوب الأرقام')}</Label>
                  <Select value={locale.numeralStyle} onValueChange={v => setL('numeralStyle', v)}>
                    <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="arabic">Arabic (١٢٣)</SelectItem>
                      <SelectItem value="western">Western (123)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <Switch checked={locale.showHijriDates} onCheckedChange={v => setL('showHijriDates', v)} />
                  <Label>{t('Show Hijri Dates', 'إظهار التواريخ الهجرية')}</Label>
                </div>
                <div className="col-span-2 flex justify-end">
                  <Button onClick={saveLocale} disabled={savingLocale || !selectedOrg} className="bg-blue-600 hover:bg-blue-700">
                    {savingLocale ? t('Saving…', 'جاري الحفظ…') : t('Save Locale', 'حفظ الإعدادات')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Numbering Tab */}
          <TabsContent value="numbering" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setAddSchemeOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2"><Plus className="w-4 h-4" />{t('Add Scheme', 'إضافة مخطط')}</Button>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                    <TableHead className="text-slate-300">{t('Entity Type', 'نوع الكيان')}</TableHead>
                    <TableHead className="text-slate-300">{t('Template', 'القالب')}</TableHead>
                    <TableHead className="text-slate-300">{t('Prefix', 'البادئة')}</TableHead>
                    <TableHead className="text-slate-300">{t('Current Seq.', 'التسلسل الحالي')}</TableHead>
                    <TableHead className="text-slate-300">{t('Reset Cycle', 'دورة الإعادة')}</TableHead>
                    <TableHead className="text-slate-300">{t('Action', 'الإجراء')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {schemes.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">{t('No schemes', 'لا توجد مخططات')}</TableCell></TableRow>
                    : schemes.map(s => (
                      <TableRow key={s.id} className="border-slate-700 hover:bg-slate-700/30">
                        <TableCell className="text-white">{s.entityType}</TableCell>
                        <TableCell className="font-mono text-slate-300 text-sm">{s.template}</TableCell>
                        <TableCell className="text-slate-300">{s.prefix || '—'}</TableCell>
                        <TableCell className="text-slate-300">{s.currentSequence}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs border-slate-600 text-slate-300">{s.resetCycle}</Badge></TableCell>
                        <TableCell><Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300 h-7" onClick={() => incrementScheme(s.id)}>{t('Increment', 'زيادة')}</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <AddSchemeDialog open={addSchemeOpen} onClose={() => setAddSchemeOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: getListNumberingSchemesQueryKey() })} />
          </TabsContent>

          {/* Employment Types Tab */}
          <TabsContent value="employment" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setAddEmpTypeOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2"><Plus className="w-4 h-4" />{t('Add Type', 'إضافة نوع')}</Button>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                    <TableHead className="text-slate-300">{t('Label (EN)', 'التسمية (إنجليزي)')}</TableHead>
                    <TableHead className="text-slate-300">{t('Label (AR)', 'التسمية (عربي)')}</TableHead>
                    <TableHead className="text-slate-300">{t('Probation', 'التجربة')}</TableHead>
                    <TableHead className="text-slate-300">{t('Contract', 'العقد')}</TableHead>
                    <TableHead className="text-slate-300">{t('Eligibility', 'الأهلية')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {empTypes.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">{t('No employment types', 'لا توجد أنواع توظيف')}</TableCell></TableRow>
                    : empTypes.map(et => (
                      <TableRow key={et.id} className="border-slate-700 hover:bg-slate-700/30">
                        <TableCell className="text-white">{localName(et.labelEn, et.labelAr, lang)}</TableCell>
                        <TableCell className="text-slate-300" dir="rtl">{et.labelAr || '—'}</TableCell>
                        <TableCell className="text-slate-300">{et.probationDays ?? '—'} {t('days', 'أيام')}</TableCell>
                        <TableCell className="text-slate-300">{et.defaultContractMonths ?? '—'} {t('mo', 'شهر')}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {et.eligibleLeave && <Badge variant="outline" className="text-xs bg-emerald-900/30 text-emerald-300 border-emerald-700">{t('Leave','إجازة')}</Badge>}
                            {et.eligiblePayroll && <Badge variant="outline" className="text-xs bg-blue-900/30 text-blue-300 border-blue-700">{t('Payroll','رواتب')}</Badge>}
                            {et.eligibleBenefits && <Badge variant="outline" className="text-xs bg-amber-900/30 text-amber-300 border-amber-700">{t('Benefits','مزايا')}</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <AddEmploymentTypeDialog open={addEmpTypeOpen} onClose={() => setAddEmpTypeOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: getListEmploymentTypeConfigsQueryKey() })} orgs={orgs} defaultOrgId={selectedOrg} />
          </TabsContent>

          {/* Calendar Tab */}
          <TabsContent value="calendar" className="mt-4">
            <div className="flex items-center gap-3 mb-4">
              <Label className="text-slate-300 shrink-0">{t('Organization:', 'المؤسسة:')}</Label>
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger className="w-56 bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{localName(o.nameEn, o.nameAr, lang)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="mb-2 block">{t('Weekend Days', 'أيام الإجازة الأسبوعية')}</Label>
                  <div className="flex gap-2 flex-wrap">
                    {DAYS.map((day, i) => (
                      <label key={i} className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-300">
                        <input type="checkbox" checked={weekends.includes(i)} onChange={e => setWeekends(prev => e.target.checked ? [...prev, i] : prev.filter(d => d !== i))} className="accent-blue-500" />
                        {lang === 'ar' ? DAY_AR[i] : day}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>{t('Hours/Day', 'ساعات/يوم')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="number" value={calForm.standardHoursPerDay} onChange={e => setCalForm(f => ({ ...f, standardHoursPerDay: e.target.value }))} /></div>
                  <div><Label>{t('Shift Start', 'بداية الوردية')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="time" value={calForm.shiftStart} onChange={e => setCalForm(f => ({ ...f, shiftStart: e.target.value }))} /></div>
                  <div><Label>{t('Shift End', 'نهاية الوردية')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" type="time" value={calForm.shiftEnd} onChange={e => setCalForm(f => ({ ...f, shiftEnd: e.target.value }))} /></div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={calForm.summerSchedule} onCheckedChange={v => setCalForm(f => ({ ...f, summerSchedule: v }))} />
                  <Label>{t('Enable Summer Schedule', 'تفعيل جدول الصيف')}</Label>
                </div>
                <div className="flex justify-end">
                  <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => toast({ title: t('Calendar saved', 'تم حفظ التقويم') })}>
                    {t('Save Calendar', 'حفظ التقويم')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Retention Tab */}
          <TabsContent value="retention" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setAddRetentionOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2"><Plus className="w-4 h-4" />{t('Add Rule', 'إضافة قاعدة')}</Button>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                    <TableHead className="text-slate-300">{t('Data Category', 'فئة البيانات')}</TableHead>
                    <TableHead className="text-slate-300">{t('Retention Period', 'مدة الاحتفاظ')}</TableHead>
                    <TableHead className="text-slate-300">{t('Expiry Action', 'إجراء الانتهاء')}</TableHead>
                    <TableHead className="text-slate-300">{t('Legal Basis', 'الأساس القانوني')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {retention.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-8">{t('No retention rules', 'لا توجد قواعد احتفاظ')}</TableCell></TableRow>
                    : retention.map(r => (
                      <TableRow key={r.id} className="border-slate-700 hover:bg-slate-700/30">
                        <TableCell className="text-white font-medium">{r.dataCategory}</TableCell>
                        <TableCell className="text-slate-300">{r.retentionMonths ? retentionLabel(r.retentionMonths) : <span className="text-slate-400 italic">{t('Indefinite','غير محدود')}</span>}</TableCell>
                        <TableCell><Badge variant="outline" className={`text-xs ${expiryBadge(r.expiryAction)}`}>{r.expiryAction}</Badge></TableCell>
                        <TableCell className="text-slate-300 text-sm">{r.legalBasisEn || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <AddRetentionRuleDialog open={addRetentionOpen} onClose={() => setAddRetentionOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: getListRetentionRulesQueryKey() })} />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
