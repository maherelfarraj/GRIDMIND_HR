import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEnterpriseDocuments,
  useCreateEnterpriseDocument,
  useUpdateEnterpriseDocument,
  useListDocumentCategories,
  useCreateDocumentCategory,
  useUpdateDocumentCategory,
  useListDocumentTemplates,
  useGenerateDocumentFromTemplate,
  usePlaceLegalHold,
  useRemoveLegalHold,
  useAcknowledgeDocument,
  useListEmployees,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  FileText, FolderOpen, Shield, Lock, Eye, Download, CheckCircle,
  Plus, AlertTriangle, Layers,
} from 'lucide-react';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CLASS_COLORS: Record<string, string> = {
  public:       'bg-emerald-100 text-emerald-700 border-emerald-200',
  internal:     'bg-blue-100 text-blue-700 border-blue-200',
  confidential: 'bg-amber-100 text-amber-700 border-amber-200',
  secret:       'bg-red-100 text-red-700 border-red-200',
};

function ClassBadge({ level }: { level: string }) {
  return (
    <Badge variant="outline" className={cn('capitalize text-xs', CLASS_COLORS[level] ?? '')}>
      {level}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active:   'bg-emerald-100 text-emerald-700 border-emerald-200',
    expired:  'bg-red-100 text-red-700 border-red-200',
    revoked:  'bg-gray-100 text-gray-500 border-gray-200',
    draft:    'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-xs', colors[status] ?? '')}>
      {status}
    </Badge>
  );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [catFilter, setCatFilter]       = useState('all');
  const [classFilter, setClassFilter]   = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch]             = useState('');
  const [newOpen, setNewOpen]           = useState(false);
  const [busy, setBusy]                 = useState<number | null>(null);

  const { data: docs, isLoading }      = useListEnterpriseDocuments(undefined as any);
  const { data: cats }                 = useListDocumentCategories(undefined as any);
  const { data: empData }              = useListEmployees({ limit: 500 } as any);
  const placeLegalHold                 = usePlaceLegalHold();
  const removeLegalHold                = useRemoveLegalHold();
  const acknowledgeDoc                 = useAcknowledgeDocument();

  const employees = empData?.data ?? [];
  const categories = cats ?? [];

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  const allDocs = docs ?? [];

  const filtered = useMemo(() => {
    return allDocs.filter(d => {
      if (catFilter !== 'all' && String((d as any).categoryId) !== catFilter) return false;
      if (classFilter !== 'all' && (d as any).classificationLevel !== classFilter) return false;
      if (statusFilter !== 'all' && (d as any).status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (d as any).titleEn?.toLowerCase().includes(q) ||
          (d as any).documentNumber?.toLowerCase().includes(q) ||
          (d as any).employeeNameEn?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allDocs, catFilter, classFilter, statusFilter, search]);

  const stats = useMemo(() => ({
    total:    allDocs.length,
    active:   allDocs.filter(d => (d as any).status === 'active').length,
    expiring: allDocs.filter(d => {
      const exp = (d as any).expiresAt;
      if (!exp) return false;
      const diff = new Date(exp).getTime() - now;
      return diff > 0 && diff < thirtyDays;
    }).length,
    legalHold: allDocs.filter(d => (d as any).onLegalHold).length,
  }), [allDocs, now, thirtyDays]);

  async function handleToggleLegalHold(id: number, onHold: boolean) {
    setBusy(id);
    try {
      if (onHold) {
        await removeLegalHold.mutateAsync({ id });
        toast({ title: t('Legal hold removed', 'تمت إزالة الحجز القانوني') });
      } else {
        await placeLegalHold.mutateAsync({ id, data: { reason: 'Manual hold' } });
        toast({ title: t('Legal hold placed', 'تم وضع الحجز القانوني') });
      }
      qc.invalidateQueries({ queryKey: ['/api/enterprise-documents'] });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function handleAcknowledge(id: number) {
    setBusy(id);
    try {
      await acknowledgeDoc.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ['/api/enterprise-documents'] });
      toast({ title: t('Document acknowledged', 'تم الإقرار بالمستند') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('Total Documents', 'إجمالي المستندات'), value: stats.total, icon: FileText, color: 'text-blue-400' },
          { label: t('Active', 'نشط'), value: stats.active, icon: CheckCircle, color: 'text-emerald-400' },
          { label: t('Expiring Soon', 'ينتهي قريباً'), value: stats.expiring, icon: AlertTriangle, color: 'text-amber-400' },
          { label: t('Legal Hold', 'حجز قانوني'), value: stats.legalHold, icon: Shield, color: 'text-red-400' },
        ].map(s => (
          <Card key={s.label} className="bg-slate-800 border-slate-700">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={cn('w-8 h-8', s.color)} />
              <div>
                <p className="text-xs text-slate-400">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder={t('Category', 'الفئة')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Categories', 'كل الفئات')}</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{(c as any).nameEn ?? (c as any).code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder={t('Classification', 'التصنيف')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Levels', 'كل المستويات')}</SelectItem>
              {['public','internal','confidential','secret'].map(c => (
                <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder={t('Status', 'الحالة')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Statuses', 'كل الحالات')}</SelectItem>
              {['draft','active','expired','revoked'].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={t('Search…', 'بحث…')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-52 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
          />
        </div>
        <Button
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          {t('New Document', 'مستند جديد')}
        </Button>
      </div>

      {/* Table */}
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700 hover:bg-slate-700/50">
                <TableHead className="text-slate-400">{t('Doc #', 'رقم المستند')}</TableHead>
                <TableHead className="text-slate-400">{t('Title', 'العنوان')}</TableHead>
                <TableHead className="text-slate-400">{t('Category', 'الفئة')}</TableHead>
                <TableHead className="text-slate-400">{t('Classification', 'التصنيف')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Issued', 'أصدر')}</TableHead>
                <TableHead className="text-slate-400">{t('Expires', 'ينتهي')}</TableHead>
                <TableHead className="text-slate-400">{t('Actions', 'إجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : filtered.map(doc => {
                    const d = doc as any;
                    const isBusy = busy === d.id;
                    const catName = categories.find(c => c.id === d.categoryId);
                    return (
                      <TableRow key={d.id} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="font-mono text-xs text-amber-400">{d.documentNumber}</TableCell>
                        <TableCell className="text-white font-medium">{d.titleEn}</TableCell>
                        <TableCell>
                          {catName && (
                            <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                              {(catName as any).nameEn ?? (catName as any).code}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell><ClassBadge level={d.classificationLevel ?? 'internal'} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <StatusBadge status={d.status ?? 'draft'} />
                            {d.onLegalHold && (
                              <Badge variant="outline" className="text-xs bg-red-900/40 text-red-300 border-red-700">
                                <Lock className="w-3 h-3 mr-1" />{t('Hold', 'محجوز')}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtDate(d.issuedAt)}</TableCell>
                        <TableCell className="text-slate-300 text-sm">{fmtDate(d.expiresAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white h-7 px-2">
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white h-7 px-2">
                              <Download className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isBusy}
                              className={cn('h-7 px-2', d.onLegalHold ? 'text-red-400 hover:text-red-300' : 'text-slate-300 hover:text-white')}
                              onClick={() => handleToggleLegalHold(d.id, !!d.onLegalHold)}
                            >
                              <Shield className="w-3 h-3 mr-1" />
                              {d.onLegalHold ? t('Remove Hold', 'إزالة') : t('Legal Hold', 'حجز')}
                            </Button>
                            {d.requiresAcknowledgement && !d.acknowledgedAt && (
                              <Button
                                size="sm"
                                disabled={isBusy}
                                className="h-7 px-2 bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs"
                                onClick={() => handleAcknowledge(d.id)}
                              >
                                {t('Acknowledge', 'إقرار')}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && filtered.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={8} className="text-center py-10 text-slate-500">
                    {t('No documents found', 'لا توجد مستندات')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewDocumentDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        categories={categories}
        employees={employees}
      />
    </div>
  );
}

// ── New Document Dialog ───────────────────────────────────────────────────────

function NewDocumentDialog({
  open, onClose, categories, employees,
}: {
  open: boolean;
  onClose: () => void;
  categories: any[];
  employees: any[];
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    categoryId: '',
    scope: 'company',
    titleEn: '',
    titleAr: '',
    classificationLevel: 'internal',
    employeeId: '',
    issuedAt: '',
    expiresAt: '',
  });
  const [saving, setSaving] = useState(false);
  const createDoc = useCreateEnterpriseDocument();

  function setF(k: string, v: string) {
    setForm(p => ({ ...p, [k]: v }));
  }

  async function handleSave() {
    if (!form.titleEn || !form.categoryId || !form.issuedAt) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة ناقصة'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createDoc.mutateAsync({
        data: {
          categoryId: Number(form.categoryId),
          scope: form.scope as any,
          titleEn: form.titleEn,
          titleAr: form.titleAr || null,
          classificationLevel: form.classificationLevel as any,
          employeeId: form.employeeId ? Number(form.employeeId) : null,
          issuedAt: form.issuedAt,
          expiresAt: form.expiresAt || null,
        } as any,
      });
      qc.invalidateQueries({ queryKey: ['/api/enterprise-documents'] });
      toast({ title: t('Document created', 'تم إنشاء المستند') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New Document', 'مستند جديد')}</DialogTitle>
          <DialogDescription>{t('Fill in document details', 'أدخل تفاصيل المستند')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Title (EN)', 'العنوان (EN)')}</label>
            <Input value={form.titleEn} onChange={e => setF('titleEn', e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Title (AR)', 'العنوان (AR)')}</label>
            <Input value={form.titleAr} onChange={e => setF('titleAr', e.target.value)} dir="rtl" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Category', 'الفئة')}</label>
            <Select value={form.categoryId} onValueChange={v => setF('categoryId', v)}>
              <SelectTrigger><SelectValue placeholder={t('Select category', 'اختر الفئة')} /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{(c as any).nameEn ?? (c as any).code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Scope', 'النطاق')}</label>
              <Select value={form.scope} onValueChange={v => setF('scope', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['company','department','employee','public'].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Classification', 'التصنيف')}</label>
              <Select value={form.classificationLevel} onValueChange={v => setF('classificationLevel', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['public','internal','confidential','secret'].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Employee (optional)', 'الموظف (اختياري)')}</label>
            <Select value={form.employeeId} onValueChange={v => setF('employeeId', v)}>
              <SelectTrigger><SelectValue placeholder={t('None', 'لا يوجد')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('None', 'لا يوجد')}</SelectItem>
                {employees.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Issued At', 'تاريخ الإصدار')}</label>
              <Input type="date" value={form.issuedAt} onChange={e => setF('issuedAt', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Expires At', 'تاريخ الانتهاء')}</label>
              <Input type="date" value={form.expiresAt} onChange={e => setF('expiresAt', e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Templates Tab ─────────────────────────────────────────────────────────────

function TemplatesTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates, isLoading } = useListDocumentTemplates(undefined as any);
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const generateMut = useGenerateDocumentFromTemplate();

  const [genDialog, setGenDialog] = useState<{ open: boolean; templateId: number | null }>({ open: false, templateId: null });
  const [employeeId, setEmployeeId] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [generating, setGenerating] = useState(false);

  const employees = empData?.data ?? [];
  const allTemplates = templates ?? [];

  async function handleGenerate() {
    if (!genDialog.templateId || !employeeId) {
      toast({ title: t('Employee required', 'الموظف مطلوب'), variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const result = await generateMut.mutateAsync({
        id: genDialog.templateId,
        data: { employeeId: Number(employeeId), language } as any,
      });
      qc.invalidateQueries({ queryKey: ['/api/enterprise-documents'] });
      toast({
        title: t('Document generated', 'تم إنشاء المستند'),
        description: t(
          `Document number: ${(result as any).documentNumber}`,
          `رقم المستند: ${(result as any).documentNumber}`
        ),
      });
      setGenDialog({ open: false, templateId: null });
      setEmployeeId('');
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4 bg-slate-700" />
                <Skeleton className="h-4 w-1/3 bg-slate-700" />
                <Skeleton className="h-12 w-full bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allTemplates.map(tmpl => {
            const tpl = tmpl as any;
            return (
              <Card key={tpl.id} className="bg-slate-800 border-slate-700 flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base text-white">{tpl.nameEn ?? tpl.name}</CardTitle>
                    <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 shrink-0 capitalize">
                      {tpl.templateType ?? tpl.type ?? 'document'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-2">
                  <p className="text-xs text-slate-400 line-clamp-3">
                    {tpl.bodyHtml
                      ? tpl.bodyHtml.replace(/<[^>]+>/g, ' ').slice(0, 150) + '…'
                      : t('No preview available', 'لا يوجد معاينة')}
                  </p>
                </CardContent>
                <div className="px-6 pb-4">
                  <Button
                    size="sm"
                    className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                    onClick={() => { setGenDialog({ open: true, templateId: tpl.id }); setEmployeeId(''); setLanguage('en'); }}
                  >
                    {t('Generate Document', 'إنشاء مستند')}
                  </Button>
                </div>
              </Card>
            );
          })}
          {allTemplates.length === 0 && (
            <div className="col-span-3 text-center py-12 text-slate-500">
              {t('No templates found', 'لا توجد قوالب')}
            </div>
          )}
        </div>
      )}

      <Dialog open={genDialog.open} onOpenChange={v => !v && setGenDialog({ open: false, templateId: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Generate Document', 'إنشاء مستند')}</DialogTitle>
            <DialogDescription>{t('Select employee and language', 'اختر الموظف واللغة')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Employee', 'الموظف')}</label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder={t('Select employee', 'اختر موظفاً')} /></SelectTrigger>
                <SelectContent>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Language', 'اللغة')}</label>
              <Select value={language} onValueChange={v => setLanguage(v as 'en' | 'ar')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenDialog({ open: false, templateId: null })}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
            >
              {generating ? t('Generating…', 'جاري الإنشاء…') : t('Generate', 'إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────

function CategoriesTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [newOpen, setNewOpen] = useState(false);
  const { data: cats, isLoading } = useListDocumentCategories(undefined as any);
  const updateCat = useUpdateDocumentCategory();

  const categories = cats ?? [];

  async function handleToggleActive(id: number, current: boolean) {
    try {
      await updateCat.mutateAsync({ id, data: { isActive: !current } as any });
      qc.invalidateQueries({ queryKey: ['/api/document-categories'] });
      toast({ title: t('Updated', 'تم التحديث') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          {t('New Category', 'فئة جديدة')}
        </Button>
      </div>
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Code', 'الرمز')}</TableHead>
                <TableHead className="text-slate-400">{t('Name', 'الاسم')}</TableHead>
                <TableHead className="text-slate-400">{t('Type', 'النوع')}</TableHead>
                <TableHead className="text-slate-400">{t('Classification', 'التصنيف')}</TableHead>
                <TableHead className="text-slate-400">{t('Retention (yrs)', 'الاحتفاظ (سنوات)')}</TableHead>
                <TableHead className="text-slate-400">{t('Download', 'تنزيل')}</TableHead>
                <TableHead className="text-slate-400">{t('Ack. Required', 'إقرار مطلوب')}</TableHead>
                <TableHead className="text-slate-400">{t('Active', 'نشط')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : categories.map(cat => {
                    const c = cat as any;
                    return (
                      <TableRow key={c.id} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="font-mono text-amber-400 text-xs">{c.code}</TableCell>
                        <TableCell className="text-white font-medium">{c.nameEn ?? c.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 capitalize">
                            {c.categoryType ?? c.type ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell><ClassBadge level={c.defaultClassification ?? c.classificationLevel ?? 'internal'} /></TableCell>
                        <TableCell className="text-slate-300">{c.retentionYears ?? '—'}</TableCell>
                        <TableCell>
                          {c.allowDownload
                            ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                            : <span className="text-slate-600">—</span>}
                        </TableCell>
                        <TableCell>
                          {c.requiresAcknowledgement
                            ? <CheckCircle className="w-4 h-4 text-amber-400" />
                            : <span className="text-slate-600">—</span>}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={!!c.isActive}
                            onCheckedChange={() => handleToggleActive(c.id, !!c.isActive)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && categories.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={8} className="text-center py-10 text-slate-500">
                    {t('No categories found', 'لا توجد فئات')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <NewCategoryDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function NewCategoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createCat = useCreateDocumentCategory();

  const [form, setForm] = useState({
    code: '', nameEn: '', nameAr: '', categoryType: 'policy',
    defaultClassification: 'internal', retentionYears: '',
    allowDownload: true, requiresAcknowledgement: false, isActive: true,
  });
  const [saving, setSaving] = useState(false);

  function setF(k: string, v: string | boolean) {
    setForm(p => ({ ...p, [k]: v }));
  }

  async function handleSave() {
    if (!form.code || !form.nameEn) {
      toast({ title: t('Code and name required', 'الرمز والاسم مطلوبان'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createCat.mutateAsync({
        data: {
          ...form,
          retentionYears: form.retentionYears ? Number(form.retentionYears) : null,
        } as any,
      });
      qc.invalidateQueries({ queryKey: ['/api/document-categories'] });
      toast({ title: t('Category created', 'تم إنشاء الفئة') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Category', 'فئة جديدة')}</DialogTitle>
          <DialogDescription>{t('Define a document category', 'تعريف فئة مستند')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Code', 'الرمز')}</label>
              <Input value={form.code} onChange={e => setF('code', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Type', 'النوع')}</label>
              <Select value={form.categoryType} onValueChange={v => setF('categoryType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['policy','contract','certificate','report','form','other'].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Name (EN)', 'الاسم (EN)')}</label>
            <Input value={form.nameEn} onChange={e => setF('nameEn', e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Name (AR)', 'الاسم (AR)')}</label>
            <Input value={form.nameAr} onChange={e => setF('nameAr', e.target.value)} dir="rtl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Classification', 'التصنيف')}</label>
              <Select value={form.defaultClassification} onValueChange={v => setF('defaultClassification', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['public','internal','confidential','secret'].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Retention (years)', 'الاحتفاظ (سنوات)')}</label>
              <Input type="number" value={form.retentionYears} onChange={e => setF('retentionYears', e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={form.allowDownload} onCheckedChange={v => setF('allowDownload', v)} />
              {t('Allow Download', 'السماح بالتنزيل')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={form.requiresAcknowledgement} onCheckedChange={v => setF('requiresAcknowledgement', v)} />
              {t('Requires Ack.', 'يتطلب إقراراً')}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocumentManagement() {
  const { t } = useLanguage();

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 bg-slate-900 min-h-screen">
        <div className="flex items-center gap-3">
          <FolderOpen className="w-7 h-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Document Management', 'إدارة المستندات')}</h1>
            <p className="text-slate-400 text-sm">{t('Manage enterprise documents, templates, and categories', 'إدارة مستندات المؤسسة والقوالب والفئات')}</p>
          </div>
        </div>

        <Tabs defaultValue="documents">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="documents" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <FileText className="w-4 h-4 mr-1" />
              {t('Documents', 'المستندات')}
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Layers className="w-4 h-4 mr-1" />
              {t('Templates', 'القوالب')}
            </TabsTrigger>
            <TabsTrigger value="categories" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <FolderOpen className="w-4 h-4 mr-1" />
              {t('Categories', 'الفئات')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="mt-4">
            <DocumentsTab />
          </TabsContent>
          <TabsContent value="templates" className="mt-4">
            <TemplatesTab />
          </TabsContent>
          <TabsContent value="categories" className="mt-4">
            <CategoriesTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
