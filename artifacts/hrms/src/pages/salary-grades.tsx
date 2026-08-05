import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListSalaryGrades, useCreateSalaryGrade, useUpdateSalaryGrade, useDeleteSalaryGrade,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Wallet, Building2, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const ORG_TYPES = [
  { value: 'commercial', labelEn: 'Commercial', labelAr: 'تجاري' },
  { value: 'government', labelEn: 'Government', labelAr: 'حكومي' },
  { value: 'military',   labelEn: 'Military',   labelAr: 'عسكري' },
];

const ORG_ICONS: Record<string, React.ElementType> = {
  commercial: Building2,
  government: Shield,
  military: Shield,
};

const ORG_COLORS: Record<string, string> = {
  commercial: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  government: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  military:   'bg-rose-500/10 text-rose-400 border-rose-500/20',
};

function fmt(val: string | number) {
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_FORM = {
  gradeCode: '', nameEn: '', nameAr: '', step: 1,
  baseSalary: '', housingAllowancePct: '25', transportAllowancePct: '10',
  currency: 'SAR', organizationType: 'commercial', isActive: true,
};

export default function SalaryGrades() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();

  const [orgFilter, setOrgFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: grades = [], isLoading } = useListSalaryGrades(
    orgFilter !== 'all' ? { organizationType: orgFilter } : {}
  );
  const { mutateAsync: create } = useCreateSalaryGrade();
  const { mutateAsync: update } = useUpdateSalaryGrade();
  const { mutateAsync: remove } = useDeleteSalaryGrade();

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  }

  function openEdit(g: typeof grades[0]) {
    setEditId(g.id);
    setForm({
      gradeCode: g.gradeCode,
      nameEn: g.nameEn,
      nameAr: g.nameAr,
      step: g.step,
      baseSalary: g.baseSalary,
      housingAllowancePct: g.housingAllowancePct,
      transportAllowancePct: g.transportAllowancePct,
      currency: g.currency,
      organizationType: g.organizationType,
      isActive: g.isActive,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        step: Number(form.step),
        baseSalary: Number(form.baseSalary),
        housingAllowancePct: Number(form.housingAllowancePct),
        transportAllowancePct: Number(form.transportAllowancePct),
      };
      if (editId) {
        await update({ id: editId, data: payload });
      } else {
        await create({ data: payload });
      }
      qc.invalidateQueries({ queryKey: ['salary-grades'] });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    await remove({ id: deleteId });
    qc.invalidateQueries({ queryKey: ['salary-grades'] });
    setDeleteId(null);
  }

  // Group by org type for display
  const grouped = (grades as typeof grades).reduce<Record<string, typeof grades>>((acc, g) => {
    const k = g.organizationType;
    if (!acc[k]) acc[k] = [];
    acc[k].push(g);
    return acc;
  }, {});

  const totalGrades = grades.length;
  const avgBase = grades.length ? grades.reduce((s, g) => s + parseFloat(g.baseSalary), 0) / grades.length : 0;
  const maxBase = grades.length ? Math.max(...grades.map(g => parseFloat(g.baseSalary))) : 0;

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary" />
              {t('Salary Grades', 'الدرجات الوظيفية')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('Configure grade structures, base salaries and allowance percentages', 'إعداد هياكل الدرجات والرواتب الأساسية ونسب البدلات')}
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('Add Grade', 'إضافة درجة')}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: t('Total Grades', 'إجمالي الدرجات'), value: totalGrades, icon: Wallet },
            { label: t('Avg Base Salary', 'متوسط الراتب الأساسي'), value: `SAR ${fmt(avgBase)}`, icon: Wallet },
            { label: t('Highest Grade', 'أعلى راتب'), value: `SAR ${fmt(maxBase)}`, icon: Wallet },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{t('Filter:', 'تصفية:')}</span>
          <div className="flex gap-2">
            {['all', ...ORG_TYPES.map(o => o.value)].map(v => (
              <Button
                key={v}
                variant={orgFilter === v ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOrgFilter(v)}
              >
                {v === 'all' ? t('All', 'الكل') : localName(ORG_TYPES.find(o => o.value === v)?.labelEn, ORG_TYPES.find(o => o.value === v)?.labelAr, lang)}
              </Button>
            ))}
          </div>
        </div>

        {/* Tables per org type */}
        {isLoading ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">{t('Loading…', 'جارٍ التحميل…')}</CardContent></Card>
        ) : (
          Object.entries(grouped).map(([org, rows]) => {
            const OrgIcon = ORG_ICONS[org] ?? Building2;
            const _orgType = ORG_TYPES.find(o => o.value === org);
            const orgLabel = localName(_orgType?.labelEn ?? org, _orgType?.labelAr, lang);
            return (
              <Card key={org}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <OrgIcon className="w-4 h-4" />
                    {orgLabel}
                    <Badge variant="outline" className={cn('text-xs', ORG_COLORS[org])}>
                      {rows.length} {t('grades', 'درجة')}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Code', 'الرمز')}</TableHead>
                        <TableHead>{t('Name', 'الاسم')}</TableHead>
                        <TableHead>{t('Step', 'المرحلة')}</TableHead>
                        <TableHead className="text-end">{t('Base Salary', 'الراتب الأساسي')}</TableHead>
                        <TableHead className="text-end">{t('Housing %', 'السكن %')}</TableHead>
                        <TableHead className="text-end">{t('Transport %', 'المواصلات %')}</TableHead>
                        <TableHead className="text-end">{t('Gross Est.', 'الإجمالي المقدر')}</TableHead>
                        <TableHead>{t('Status', 'الحالة')}</TableHead>
                        <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(g => {
                        const base = parseFloat(g.baseSalary);
                        const housing = base * (parseFloat(g.housingAllowancePct) / 100);
                        const transport = base * (parseFloat(g.transportAllowancePct) / 100);
                        const gross = base + housing + transport;
                        return (
                          <TableRow key={g.id} className={!g.isActive ? 'opacity-50' : ''}>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{g.gradeCode}</code></TableCell>
                            <TableCell>
                              <div className="font-medium text-sm">{localName(g.nameEn, g.nameAr, lang)}</div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{g.step}</TableCell>
                            <TableCell className="text-end font-mono text-sm">{g.currency} {fmt(g.baseSalary)}</TableCell>
                            <TableCell className="text-end text-sm">{g.housingAllowancePct}%</TableCell>
                            <TableCell className="text-end text-sm">{g.transportAllowancePct}%</TableCell>
                            <TableCell className="text-end font-mono text-sm font-semibold text-emerald-500">{g.currency} {fmt(gross)}</TableCell>
                            <TableCell>
                              <Badge variant={g.isActive ? 'default' : 'secondary'} className="text-xs">
                                {g.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(g.id)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editId ? t('Edit Salary Grade', 'تعديل الدرجة الوظيفية') : t('Add Salary Grade', 'إضافة درجة وظيفية')}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label>{t('Grade Code', 'رمز الدرجة')}</Label>
                <Input value={form.gradeCode} onChange={e => setForm(f => ({ ...f, gradeCode: e.target.value }))} placeholder="G1-S1" disabled={!!editId} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Step', 'المرحلة')}</Label>
                <Input type="number" min={1} value={form.step} onChange={e => setForm(f => ({ ...f, step: parseInt(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Name (EN)', 'الاسم (إنجليزي)')}</Label>
                <Input value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Name (AR)', 'الاسم (عربي)')}</Label>
                <Input value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} dir="rtl" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Base Salary', 'الراتب الأساسي')}</Label>
                <Input type="number" min={0} step="0.01" value={form.baseSalary} onChange={e => setForm(f => ({ ...f, baseSalary: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Currency', 'العملة')}</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['SAR', 'USD', 'AED', 'KWD', 'BHD'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('Housing Allowance %', 'نسبة بدل السكن %')}</Label>
                <Input type="number" min={0} max={100} step="0.5" value={form.housingAllowancePct} onChange={e => setForm(f => ({ ...f, housingAllowancePct: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Transport Allowance %', 'نسبة بدل المواصلات %')}</Label>
                <Input type="number" min={0} max={100} step="0.5" value={form.transportAllowancePct} onChange={e => setForm(f => ({ ...f, transportAllowancePct: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>{t('Organization Type', 'نوع المنظمة')}</Label>
                <Select value={form.organizationType} onValueChange={v => setForm(f => ({ ...f, organizationType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORG_TYPES.map(o => <SelectItem key={o.value} value={o.value}>{t(o.labelEn, o.labelAr)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
              <Button onClick={handleSave} disabled={saving || !form.gradeCode || !form.nameEn || !form.baseSalary}>
                {saving ? t('Saving…', 'جارٍ الحفظ…') : t('Save', 'حفظ')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Delete Salary Grade?', 'حذف الدرجة الوظيفية؟')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('This will permanently remove this grade. Employees with this grade will need reassignment.', 'سيؤدي ذلك إلى حذف هذه الدرجة نهائياً. سيحتاج الموظفون إلى إعادة تعيين.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('Cancel', 'إلغاء')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                {t('Delete', 'حذف')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AnimatedPage>
  );
}
