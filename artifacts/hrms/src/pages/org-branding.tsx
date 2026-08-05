import { useState, useEffect } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Palette, Plus, Eye } from 'lucide-react';

function AddTemplateDialog({ open, onClose, onSaved, orgId }: { open: boolean; onClose: () => void; onSaved: () => void; orgId: string }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nameEn: '', templateType: '', paperSize: 'A4', defaultExportFormat: 'pdf', isDefault: false });
  function set(k: string, v: string | boolean) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/org-report-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': String(orgId) },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: t('Template created', 'تم إنشاء القالب') });
      onSaved(); onClose();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>{t('Add Report Template', 'إضافة قالب تقرير')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Name (English)', 'الاسم بالإنجليزية')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.nameEn} onChange={e => set('nameEn', e.target.value)} /></div>
          <div><Label>{t('Template Type', 'نوع القالب')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.templateType} onChange={e => set('templateType', e.target.value)} placeholder="payslip, contract, letter..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Paper Size', 'حجم الورق')}</Label>
              <Select value={form.paperSize} onValueChange={v => set('paperSize', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['A4','A3','Letter','Legal'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('Export Format', 'صيغة التصدير')}</Label>
              <Select value={form.defaultExportFormat} onValueChange={v => set('defaultExportFormat', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['pdf','docx','xlsx'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
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

export default function OrgBranding() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [branding, setBranding] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [form, setForm] = useState({
    displayNameEn: '', displayNameAr: '', taglineEn: '', taglineAr: '',
    primaryColor: '#3b82f6', accentColor: '#6366f1', defaultTheme: 'dark',
    logoUrl: '', loginMessageEn: '', loginMessageAr: '', customCssSnippet: '',
    footerTextEn: '', footerTextAr: '',
  });

  function setF(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  useEffect(() => {
    fetch('/api/organizations').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : (d.organizations ?? []);
      setOrgs(list);
      if (list.length > 0) setSelectedOrg(String(list[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedOrg) return;
    setLoadingBranding(true);
    fetch(`/api/org-branding/${selectedOrg}`)
      .then(r => r.json())
      .then(d => { setBranding(d); setForm(f => ({ ...f, ...d })); })
      .catch(() => {})
      .finally(() => setLoadingBranding(false));

    setLoadingTemplates(true);
    fetch(`/api/org-report-templates`, { headers: { 'X-Org-Id': String(selectedOrg) } })
      .then(r => r.json())
      .then(d => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [selectedOrg]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/org-branding/${selectedOrg}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: t('Branding saved', 'تم حفظ الهوية البصرية') });
    } catch {
      toast({ title: t('Error saving', 'خطأ في الحفظ'), variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Palette className="w-7 h-7 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('White-Label Administration', 'إدارة الهوية البصرية')}</h1>
            <p className="text-slate-400 text-sm">{t('Customize branding and report templates per organization', 'تخصيص الهوية البصرية وقوالب التقارير لكل مؤسسة')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Label className="text-slate-300 shrink-0">{t('Organization:', 'المؤسسة:')}</Label>
          <Select value={selectedOrg} onValueChange={setSelectedOrg}>
            <SelectTrigger className="w-64 bg-slate-700 border-slate-600 text-white"><SelectValue placeholder={t('Select org', 'اختر مؤسسة')} /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nameEn}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="branding">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="branding" className="data-[state=active]:bg-slate-700">{t('Branding', 'الهوية البصرية')}</TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-slate-700">{t('Templates', 'القوالب')}</TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="mt-4">
            {loadingBranding ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle className="text-white text-sm">{t('Display Names & Taglines', 'الأسماء المعروضة والشعارات')}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>{t('Display Name (EN)', 'الاسم المعروض (إنجليزي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.displayNameEn} onChange={e => setF('displayNameEn', e.target.value)} /></div>
                        <div><Label>{t('Display Name (AR)', 'الاسم المعروض (عربي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" dir="rtl" value={form.displayNameAr} onChange={e => setF('displayNameAr', e.target.value)} /></div>
                        <div><Label>{t('Tagline (EN)', 'الشعار (إنجليزي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.taglineEn} onChange={e => setF('taglineEn', e.target.value)} /></div>
                        <div><Label>{t('Tagline (AR)', 'الشعار (عربي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" dir="rtl" value={form.taglineAr} onChange={e => setF('taglineAr', e.target.value)} /></div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle className="text-white text-sm">{t('Colors & Theme', 'الألوان والمظهر')}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label>{t('Primary Color', 'اللون الأساسي')}</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <input type="color" value={form.primaryColor} onChange={e => setF('primaryColor', e.target.value)} className="w-10 h-9 rounded border border-slate-600 bg-transparent cursor-pointer" />
                            <Input className="bg-slate-700 border-slate-600 font-mono text-sm" value={form.primaryColor} onChange={e => setF('primaryColor', e.target.value)} />
                          </div>
                        </div>
                        <div>
                          <Label>{t('Accent Color', 'اللون المميز')}</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <input type="color" value={form.accentColor} onChange={e => setF('accentColor', e.target.value)} className="w-10 h-9 rounded border border-slate-600 bg-transparent cursor-pointer" />
                            <Input className="bg-slate-700 border-slate-600 font-mono text-sm" value={form.accentColor} onChange={e => setF('accentColor', e.target.value)} />
                          </div>
                        </div>
                        <div>
                          <Label>{t('Default Theme', 'المظهر الافتراضي')}</Label>
                          <div className="mt-1 space-y-1">
                            {['dark','light','high_contrast'].map(th => (
                              <label key={th} className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                                <input type="radio" name="theme" value={th} checked={form.defaultTheme === th} onChange={() => setF('defaultTheme', th)} className="accent-blue-500" />
                                {th === 'dark' ? t('Dark','داكن') : th === 'light' ? t('Light','فاتح') : t('High Contrast','تباين عالٍ')}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle className="text-white text-sm">{t('Logo & Messages', 'الشعار والرسائل')}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div><Label>{t('Logo URL', 'رابط الشعار')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.logoUrl} onChange={e => setF('logoUrl', e.target.value)} placeholder="https://..." /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>{t('Login Message (EN)', 'رسالة تسجيل الدخول (إنجليزي)')}</Label><Textarea className="mt-1 bg-slate-700 border-slate-600 h-20 resize-none" value={form.loginMessageEn} onChange={e => setF('loginMessageEn', e.target.value)} /></div>
                        <div><Label>{t('Login Message (AR)', 'رسالة تسجيل الدخول (عربي)')}</Label><Textarea className="mt-1 bg-slate-700 border-slate-600 h-20 resize-none" dir="rtl" value={form.loginMessageAr} onChange={e => setF('loginMessageAr', e.target.value)} /></div>
                        <div><Label>{t('Footer Text (EN)', 'نص التذييل (إنجليزي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.footerTextEn} onChange={e => setF('footerTextEn', e.target.value)} /></div>
                        <div><Label>{t('Footer Text (AR)', 'نص التذييل (عربي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" dir="rtl" value={form.footerTextAr} onChange={e => setF('footerTextAr', e.target.value)} /></div>
                      </div>
                      <div>
                        <Label className="flex items-center gap-2">{t('Custom CSS', 'CSS مخصص')} <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /></Label>
                        <p className="text-xs text-amber-400 mb-1">{t('Custom CSS may affect system stability. Use with caution.', 'قد يؤثر CSS المخصص على استقرار النظام. استخدمه بحذر.')}</p>
                        <Textarea className="mt-1 bg-slate-700 border-slate-600 font-mono text-xs h-24 resize-none" value={form.customCssSnippet} onChange={e => setF('customCssSnippet', e.target.value)} placeholder="/* custom styles */" />
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                      {saving ? t('Saving…', 'جاري الحفظ…') : t('Save Branding', 'حفظ الهوية البصرية')}
                    </Button>
                  </div>
                </div>

                {/* Live Preview */}
                <div className="space-y-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />{t('Live Preview', 'معاينة مباشرة')}</p>
                  <Card className="border-2" style={{ borderColor: form.primaryColor, backgroundColor: '#0f172a' }}>
                    <CardContent className="p-4 text-center space-y-3">
                      {form.logoUrl ? (
                        <img src={form.logoUrl} alt="logo" className="h-12 mx-auto object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="w-12 h-12 rounded mx-auto flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: form.primaryColor }}>
                          {form.displayNameEn.slice(0, 1) || 'O'}
                        </div>
                      )}
                      <div>
                        <p className="text-white font-bold text-sm">{form.displayNameEn || 'Organization Name'}</p>
                        <p className="text-slate-400 text-xs">{form.taglineEn || 'Tagline here'}</p>
                      </div>
                      <div className="rounded p-2 text-xs text-slate-300" style={{ backgroundColor: form.accentColor + '33', borderColor: form.accentColor, border: '1px solid' }}>
                        {form.loginMessageEn || t('Welcome! Please sign in.', 'مرحبًا! يرجى تسجيل الدخول.')}
                      </div>
                      <button className="w-full py-1.5 rounded text-white text-xs font-semibold" style={{ backgroundColor: form.primaryColor }}>
                        {t('Sign In', 'تسجيل الدخول')}
                      </button>
                      <p className="text-slate-500 text-xs">{form.footerTextEn || '© Organization'}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4 space-y-4">
            <div className="rounded-md border border-amber-700/50 bg-amber-900/30 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-amber-400 text-sm">{t('Report template rendering requires a PDF engine configured on the server.', 'يتطلب تصيير قوالب التقارير محرك PDF مضبوطًا على الخادم.')}</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setAddTemplateOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2" disabled={!selectedOrg}>
                <Plus className="w-4 h-4" />{t('Add Template', 'إضافة قالب')}
              </Button>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loadingTemplates ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700 bg-slate-700/50">
                        <TableHead className="text-slate-300">{t('Name', 'الاسم')}</TableHead>
                        <TableHead className="text-slate-300">{t('Type', 'النوع')}</TableHead>
                        <TableHead className="text-slate-300">{t('Paper Size', 'حجم الورق')}</TableHead>
                        <TableHead className="text-slate-300">{t('Format', 'الصيغة')}</TableHead>
                        <TableHead className="text-slate-300">{t('Default', 'افتراضي')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">{t('No templates found', 'لا توجد قوالب')}</TableCell></TableRow>
                      ) : templates.map(tp => (
                        <TableRow key={tp.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-white">{tp.nameEn}</TableCell>
                          <TableCell className="text-slate-300 text-sm">{tp.templateType}</TableCell>
                          <TableCell className="text-slate-300">{tp.paperSize}</TableCell>
                          <TableCell className="text-slate-300 uppercase text-xs">{tp.defaultExportFormat}</TableCell>
                          <TableCell>{tp.isDefault ? <Badge variant="outline" className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs">{t('Default','افتراضي')}</Badge> : <span className="text-slate-500 text-xs">—</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <AddTemplateDialog open={addTemplateOpen} onClose={() => setAddTemplateOpen(false)} onSaved={() => { /* reload */ }} orgId={selectedOrg} />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
