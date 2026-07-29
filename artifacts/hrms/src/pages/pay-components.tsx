import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPayComponents, useCreatePayComponent, useUpdatePayComponent, useDeletePayComponent,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Receipt, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_META: Record<string, { labelEn: string; labelAr: string; color: string; icon: React.ElementType }> = {
  earning:   { labelEn: 'Earning',   labelAr: 'مستحق',   color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: TrendingUp },
  deduction: { labelEn: 'Deduction', labelAr: 'استقطاع', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20',       icon: TrendingDown },
  benefit:   { labelEn: 'Benefit',   labelAr: 'مزية',    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',        icon: Minus },
};

const CALC_METHODS = [
  { value: 'fixed',      labelEn: 'Fixed Amount',        labelAr: 'مبلغ ثابت' },
  { value: 'percentage', labelEn: 'Percentage',          labelAr: 'نسبة مئوية' },
  { value: 'per_day',    labelEn: 'Per Working Day',     labelAr: 'لكل يوم عمل' },
  { value: 'per_hour',   labelEn: 'Per Hour',            labelAr: 'لكل ساعة' },
];

const EMPTY_FORM = {
  codeEn: '', nameEn: '', nameAr: '', type: 'earning',
  calculationMethod: 'fixed', value: '', percentageBase: '',
  isTaxable: false, isMandatory: false, applicableTo: 'all',
  isActive: true, sortOrder: 0, notes: '',
};

export default function PayComponents() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();

  const [typeFilter, setTypeFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: components = [], isLoading } = useListPayComponents(
    typeFilter !== 'all' ? { type: typeFilter } : {}
  );

  const { mutateAsync: create } = useCreatePayComponent();
  const { mutateAsync: update } = useUpdatePayComponent();
  const { mutateAsync: remove } = useDeletePayComponent();

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  }

  function openEdit(c: typeof components[0]) {
    setEditId(c.id);
    setForm({
      codeEn: c.codeEn, nameEn: c.nameEn, nameAr: c.nameAr, type: c.type,
      calculationMethod: c.calculationMethod, value: c.value,
      percentageBase: c.percentageBase ?? '', isTaxable: c.isTaxable,
      isMandatory: c.isMandatory, applicableTo: c.applicableTo,
      isActive: c.isActive, sortOrder: c.sortOrder, notes: c.notes ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        value: Number(form.value),
        sortOrder: Number(form.sortOrder),
        percentageBase: form.percentageBase || null,
        notes: form.notes || null,
      };
      if (editId) {
        await update({ id: editId, data: payload });
      } else {
        await create({ data: payload });
      }
      qc.invalidateQueries({ queryKey: ['pay-components'] });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    await remove({ id: deleteId });
    qc.invalidateQueries({ queryKey: ['pay-components'] });
    setDeleteId(null);
  }

  const earnings = components.filter(c => c.type === 'earning');
  const deductions = components.filter(c => c.type === 'deduction');
  const benefits = components.filter(c => c.type === 'benefit');

  const filtered = typeFilter === 'all' ? components : components.filter(c => c.type === typeFilter);

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Receipt className="w-6 h-6 text-primary" />
              {t('Pay Components', 'مكونات الراتب')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('Configure earnings, deductions and benefits applied during payroll calculation', 'إعداد المستحقات والاستقطاعات والمزايا المطبقة أثناء احتساب الرواتب')}
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('Add Component', 'إضافة مكون')}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('Earnings', 'المستحقات'), count: earnings.length, icon: TrendingUp, color: 'text-emerald-400' },
            { label: t('Deductions', 'الاستقطاعات'), count: deductions.length, icon: TrendingDown, color: 'text-rose-400' },
            { label: t('Benefits', 'المزايا'), count: benefits.length, icon: Minus, color: 'text-blue-400' },
          ].map(({ label, count, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-4">
                <Icon className={cn('w-8 h-8', color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          {['all', 'earning', 'deduction', 'benefit'].map(v => (
            <Button key={v} variant={typeFilter === v ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(v)}>
              {v === 'all' ? t('All', 'الكل') : t(TYPE_META[v]?.labelEn ?? v, TYPE_META[v]?.labelAr ?? v)}
            </Button>
          ))}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Code', 'الرمز')}</TableHead>
                  <TableHead>{t('Name', 'الاسم')}</TableHead>
                  <TableHead>{t('Type', 'النوع')}</TableHead>
                  <TableHead>{t('Method', 'طريقة الاحتساب')}</TableHead>
                  <TableHead className="text-end">{t('Value', 'القيمة')}</TableHead>
                  <TableHead>{t('Flags', 'العلامات')}</TableHead>
                  <TableHead>{t('Applies To', 'ينطبق على')}</TableHead>
                  <TableHead>{t('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{t('Loading…', 'جارٍ التحميل…')}</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{t('No components found', 'لا توجد مكونات')}</TableCell></TableRow>
                ) : filtered.map(c => {
                  const meta = TYPE_META[c.type];
                  const Icon = meta?.icon ?? Minus;
                  const calcLabel = CALC_METHODS.find(m => m.value === c.calculationMethod)?.[lang === 'ar' ? 'labelAr' : 'labelEn'] ?? c.calculationMethod;
                  const valueDisplay = c.calculationMethod === 'percentage'
                    ? `${c.value}%${c.percentageBase ? ` of ${c.percentageBase === 'base_salary' ? 'Base' : 'Gross'}` : ''}`
                    : `SAR ${parseFloat(c.value).toFixed(2)}`;
                  return (
                    <TableRow key={c.id} className={!c.isActive ? 'opacity-50' : ''}>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.codeEn}</code></TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{lang === 'ar' ? c.nameAr : c.nameEn}</div>
                        <div className="text-xs text-muted-foreground">{lang === 'ar' ? c.nameEn : c.nameAr}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('gap-1 text-xs', meta?.color)}>
                          <Icon className="w-3 h-3" />
                          {t(meta?.labelEn ?? c.type, meta?.labelAr ?? c.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{calcLabel}</TableCell>
                      <TableCell className="text-end font-mono text-sm">{valueDisplay}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {c.isMandatory && <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">{t('Mandatory', 'إلزامي')}</Badge>}
                          {c.isTaxable && <Badge variant="outline" className="text-xs bg-violet-500/10 text-violet-400 border-violet-500/20">{t('Taxable', 'خاضع للضريبة')}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground capitalize">{c.applicableTo}</TableCell>
                      <TableCell>
                        <Badge variant={c.isActive ? 'default' : 'secondary'} className="text-xs">
                          {c.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(c.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editId ? t('Edit Pay Component', 'تعديل مكون الراتب') : t('Add Pay Component', 'إضافة مكون راتب')}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label>{t('Code', 'الرمز')}</Label>
                <Input value={form.codeEn} onChange={e => setForm(f => ({ ...f, codeEn: e.target.value.toUpperCase() }))} placeholder="MEAL_ALLOW" disabled={!!editId} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Type', 'النوع')}</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_META).map(([v, m]) => <SelectItem key={v} value={v}>{t(m.labelEn, m.labelAr)}</SelectItem>)}
                  </SelectContent>
                </Select>
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
                <Label>{t('Calculation Method', 'طريقة الاحتساب')}</Label>
                <Select value={form.calculationMethod} onValueChange={v => setForm(f => ({ ...f, calculationMethod: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CALC_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{t(m.labelEn, m.labelAr)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{form.calculationMethod === 'percentage' ? t('Percentage %', 'النسبة %') : t('Amount (SAR)', 'المبلغ (ر.س)')}</Label>
                <Input type="number" min={0} step={form.calculationMethod === 'percentage' ? '0.01' : '1'} value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
              </div>
              {form.calculationMethod === 'percentage' && (
                <div className="space-y-1.5 col-span-2">
                  <Label>{t('Percentage Base', 'أساس النسبة')}</Label>
                  <Select value={form.percentageBase} onValueChange={v => setForm(f => ({ ...f, percentageBase: v }))}>
                    <SelectTrigger><SelectValue placeholder={t('Select base…', 'اختر الأساس…')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="base_salary">{t('Base Salary', 'الراتب الأساسي')}</SelectItem>
                      <SelectItem value="gross_salary">{t('Gross Salary', 'الراتب الإجمالي')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t('Applies To', 'ينطبق على')}</Label>
                <Select value={form.applicableTo} onValueChange={v => setForm(f => ({ ...f, applicableTo: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('All', 'الكل')}</SelectItem>
                    <SelectItem value="commercial">{t('Commercial', 'تجاري')}</SelectItem>
                    <SelectItem value="government">{t('Government', 'حكومي')}</SelectItem>
                    <SelectItem value="military">{t('Military', 'عسكري')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('Sort Order', 'ترتيب العرض')}</Label>
                <Input type="number" min={0} value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="flex items-center gap-3 col-span-2 pt-1">
                <Switch checked={form.isMandatory} onCheckedChange={v => setForm(f => ({ ...f, isMandatory: v }))} id="mandatory" />
                <Label htmlFor="mandatory">{t('Mandatory (auto-applied)', 'إلزامي (يُطبق تلقائياً)')}</Label>
              </div>
              <div className="flex items-center gap-3 col-span-2">
                <Switch checked={form.isTaxable} onCheckedChange={v => setForm(f => ({ ...f, isTaxable: v }))} id="taxable" />
                <Label htmlFor="taxable">{t('Taxable', 'خاضع للضريبة')}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
              <Button onClick={handleSave} disabled={saving || !form.codeEn || !form.nameEn || !form.type}>
                {saving ? t('Saving…', 'جارٍ الحفظ…') : t('Save', 'حفظ')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Delete Pay Component?', 'حذف مكون الراتب؟')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('This component will be removed from future payroll calculations.', 'سيتم إزالة هذا المكون من احتسابات الرواتب المستقبلية.')}
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
