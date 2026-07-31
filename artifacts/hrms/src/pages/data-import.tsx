import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListImportJobs, useCreateImportJob, useConfirmImportPreview,
  useExecuteImportJob, useRollbackImportJob,
  useListImportMappingTemplates, useCreateImportMappingTemplate,
  useDeleteImportMappingTemplate,
  getListImportJobsQueryKey, getListImportMappingTemplatesQueryKey,
} from '@workspace/api-client-react';
import type {
  CreateImportJob201, CreateImportJob201ValidatedRowsItem,
  DataImportJob, ImportMappingTemplate,
} from '@workspace/api-client-react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, RotateCcw, Trash2 } from 'lucide-react';

const IMPORT_TYPES = [
  { value: 'employees',       label: 'Employees',         labelAr: 'الموظفون' },
  { value: 'salary_grades',   label: 'Salary Grades',     labelAr: 'درجات الراتب' },
  { value: 'pay_components',  label: 'Pay Components',    labelAr: 'مكونات الراتب' },
  { value: 'leave_balances',  label: 'Leave Balances',    labelAr: 'أرصدة الإجازات' },
  { value: 'public_holidays', label: 'Public Holidays',   labelAr: 'العطل الرسمية' },
];

const EMPLOYEE_FIELDS = ['employeeNumber', 'firstNameEn', 'lastNameEn', 'firstNameAr', 'lastNameAr', 'nationalId', 'email', 'departmentId', 'jobTitleEn', 'hireDate'];

const SAMPLE_CSV_HEADER = 'code,first_name_en,last_name_en,nid,email,start_date';
const SAMPLE_CSV_ROWS = [
  '10001,Ahmed,Al-Qahtani,1234567890,ahmed@example.com,2023-01-01',
  '10002,Fatima,Al-Harbi,0987654321,fatima@example.com,2022-06-15',
  '10003,Mohammed,Al-Ghamdi,1122334455,mohammed@example.com,2024-03-10',
];
const SAMPLE_CSV = [SAMPLE_CSV_HEADER, ...SAMPLE_CSV_ROWS].join('\n');

const DEFAULT_MAPPING: Record<string, string> = {
  code: 'employeeNumber', first_name_en: 'firstNameEn', last_name_en: 'lastNameEn',
  nid: 'nationalId', email: 'email', start_date: 'hireDate',
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    valid: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-700',
    duplicate: 'bg-amber-100 text-amber-700',
    complete: 'bg-emerald-100 text-emerald-700',
    preview: 'bg-blue-100 text-blue-700',
    validating: 'bg-blue-100 text-blue-700',
    importing: 'bg-blue-100 text-blue-700',
    rolled_back: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
  };
  return <Badge className={`text-xs ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>{status}</Badge>;
}

/** Parse CSV text into objects keyed by the mapped target fields. */
function parseCsvRows(csvText: string, mapping: Record<string, string>): Record<string, string>[] {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      const target = mapping[h];
      if (target) row[target] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function NewImportTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createJobMut = useCreateImportJob();
  const confirmMut = useConfirmImportPreview();
  const executeMut = useExecuteImportJob();
  const createTemplateMut = useCreateImportMappingTemplate();
  const [importType, setImportType] = useState('employees');
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [mapping, setMapping] = useState<Record<string, string>>(DEFAULT_MAPPING);
  const [job, setJob] = useState<CreateImportJob201 | null>(null);

  const sourceCols = (csvText.split('\n')[0] ?? '').split(',').map(c => c.trim()).filter(Boolean);
  const submitting = createJobMut.isPending || confirmMut.isPending || executeMut.isPending;

  async function handleValidate() {
    const rows = parseCsvRows(csvText, mapping);
    if (rows.length === 0) {
      toast({ title: t('No data rows found', 'لم يتم العثور على صفوف بيانات'), variant: 'destructive' });
      return;
    }
    try {
      const created = await createJobMut.mutateAsync({
        data: { importType, fileFormat: 'csv', rowsJson: rows, columnMappingJson: mapping },
      });
      setJob(created);
      const summary = t(
        `Validation complete — ${created.validRows} valid, ${created.errorRows} errors, ${created.duplicateRows} duplicates`,
        `اكتمل التحقق — ${created.validRows} صالح، ${created.errorRows} أخطاء، ${created.duplicateRows} مكرر`,
      );
      toast({ title: summary });
      queryClient.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
    } catch {
      toast({ title: t('Validation failed', 'فشل التحقق'), variant: 'destructive' });
    }
  }

  async function handleImport() {
    if (!job) return;
    try {
      await confirmMut.mutateAsync({ id: job.id });
      const executed = await executeMut.mutateAsync({ id: job.id });
      toast({ title: t(`Import complete — ${executed.imported} rows imported`, `اكتمل الاستيراد — تم استيراد ${executed.imported} صفوف`) });
      setJob(null);
      queryClient.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
    } catch {
      toast({ title: t('Import failed', 'فشل الاستيراد'), variant: 'destructive' });
    }
  }

  async function handleSaveTemplate() {
    try {
      await createTemplateMut.mutateAsync({
        data: { name: `${importType} mapping ${new Date().toISOString().slice(0, 10)}`, importType, columnMappingJson: mapping },
      });
      toast({ title: t('Template saved', 'تم حفظ القالب') });
      queryClient.invalidateQueries({ queryKey: getListImportMappingTemplatesQueryKey() });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  function previewNote(row: CreateImportJob201ValidatedRowsItem): string {
    if (!row.errorsJson) return row.isDuplicate ? t('Duplicate', 'مكرر') : '';
    try {
      const errs = JSON.parse(row.errorsJson) as { field: string; message: string }[];
      return errs.map(e => e.message).join('; ');
    } catch { return ''; }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-slate-300">{t('Import Type', 'نوع الاستيراد')}</Label>
          <Select value={importType} onValueChange={v => { setImportType(v); setJob(null); }}>
            <SelectTrigger className="mt-1 bg-slate-800 border-slate-600 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_TYPES.map(it => (
                <SelectItem key={it.value} value={it.value}>{t(it.label, it.labelAr)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-slate-300">{t('CSV Preview (paste data here)', 'معاينة CSV (الصق البيانات هنا)')}</Label>
        <textarea
          className="mt-1 w-full h-28 bg-slate-800 border border-slate-600 rounded p-2 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-primary"
          value={csvText}
          onChange={e => { setCsvText(e.target.value); setJob(null); }}
        />
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-base">{t('Column Mapping', 'تعيين الأعمدة')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Source Column', 'العمود المصدر')}</TableHead>
                <TableHead className="text-slate-400">{t('Target Field', 'الحقل الهدف')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceCols.map(col => (
                <TableRow key={col} className="border-slate-700 hover:bg-slate-700/30">
                  <TableCell className="font-mono text-slate-300 text-xs">{col}</TableCell>
                  <TableCell>
                    <Select value={mapping[col] ?? '__skip__'} onValueChange={v => setMapping(m => {
                      const next = { ...m };
                      if (v === '__skip__') delete next[col]; else next[col] = v;
                      return next;
                    })}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-200 h-8 text-xs w-48">
                        <SelectValue placeholder={t('-- skip --', '-- تخطي --')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">{t('-- skip --', '-- تخطي --')}</SelectItem>
                        {EMPLOYEE_FIELDS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-3 flex-wrap">
        <Button variant="outline" className="border-slate-600 text-slate-300" onClick={handleSaveTemplate} disabled={createTemplateMut.isPending}>
          {t('Save Mapping Template', 'حفظ قالب التعيين')}
        </Button>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleValidate} disabled={submitting}>
          {createJobMut.isPending ? t('Validating…', 'جاري التحقق…') : t('Validate', 'تحقق')}
        </Button>
        {job && (
          <Button className="bg-primary hover:bg-primary/90" onClick={handleImport} disabled={submitting || job.validRows === 0}>
            {(confirmMut.isPending || executeMut.isPending) ? t('Importing…', 'جاري الاستيراد…') : t('Run Import', 'تشغيل الاستيراد')}
          </Button>
        )}
      </div>

      {job && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">
              {t('Preview Results', 'نتائج المعاينة')} — {job.validRows} {t('valid', 'صالح')}, {job.errorRows} {t('errors', 'أخطاء')}, {job.duplicateRows} {t('duplicates', 'مكرر')}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 bg-slate-700/50">
                  <TableHead className="text-slate-400">{t('Row', 'الصف')}</TableHead>
                  <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Data', 'البيانات')}</TableHead>
                  <TableHead className="text-slate-400">{t('Note', 'ملاحظة')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {job.validatedRows.map(r => (
                  <TableRow key={r.rowNumber} className="border-slate-700 hover:bg-slate-700/30">
                    <TableCell className="text-slate-300">{r.rowNumber}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-slate-300 font-mono text-xs max-w-96 truncate">{r.rawDataJson ?? '—'}</TableCell>
                    <TableCell className="text-red-400 text-xs">{previewNote(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HistoryTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading } = useListImportJobs();
  const rollbackMut = useRollbackImportJob();
  const [confirmRollback, setConfirmRollback] = useState<DataImportJob | null>(null);

  async function doRollback() {
    if (!confirmRollback) return;
    try {
      const result = await rollbackMut.mutateAsync({ id: confirmRollback.id });
      toast({ title: t(`Rollback complete — ${result.rolledBack} rows reversed`, `اكتمل التراجع — تم عكس ${result.rolledBack} صفوف`) });
      queryClient.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
    } catch {
      toast({ title: t('Rollback failed', 'فشل التراجع'), variant: 'destructive' });
    } finally {
      setConfirmRollback(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border border-slate-700">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-700/50 border-slate-700">
              <TableHead className="text-slate-400">{t('Type', 'النوع')}</TableHead>
              <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
              <TableHead className="text-slate-400">{t('Total', 'المجموع')}</TableHead>
              <TableHead className="text-slate-400">{t('Valid', 'صالح')}</TableHead>
              <TableHead className="text-slate-400">{t('Errors', 'أخطاء')}</TableHead>
              <TableHead className="text-slate-400">{t('Dupes', 'مكرر')}</TableHead>
              <TableHead className="text-slate-400">{t('Date', 'التاريخ')}</TableHead>
              <TableHead className="text-slate-400">{t('Actions', 'إجراءات')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-8">{t('Loading…', 'جاري التحميل…')}</TableCell></TableRow>
            ) : jobs.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-8">{t('No imports yet', 'لا توجد عمليات استيراد بعد')}</TableCell></TableRow>
            ) : jobs.map(row => (
              <TableRow key={row.id} className="border-slate-700 hover:bg-slate-700/30">
                <TableCell className="text-slate-300 text-xs font-mono">{row.importType}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
                <TableCell className="text-slate-300">{row.totalRows}</TableCell>
                <TableCell className="text-emerald-400">{row.validRows}</TableCell>
                <TableCell className={row.errorRows > 0 ? 'text-red-400' : 'text-slate-400'}>{row.errorRows}</TableCell>
                <TableCell className="text-slate-400">{row.duplicateRows}</TableCell>
                <TableCell className="text-slate-400 text-xs">{new Date(row.createdAt).toLocaleString('en-GB')}</TableCell>
                <TableCell>
                  {row.isRollbackable && (
                    <Button variant="ghost" size="sm" className="text-amber-400 hover:text-amber-300 h-7 text-xs"
                      onClick={() => setConfirmRollback(row)}>
                      <RotateCcw className="w-3 h-3 mr-1" />{t('Rollback', 'تراجع')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmRollback !== null} onOpenChange={() => setConfirmRollback(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-white">{t('Confirm Rollback', 'تأكيد التراجع')}</DialogTitle>
          </DialogHeader>
          <p className="text-slate-400 text-sm">{t('This will undo the import job and delete the records it created. Are you sure?', 'سيؤدي هذا إلى التراجع عن مهمة الاستيراد وحذف السجلات التي أنشأتها. هل أنت متأكد؟')}</p>
          <DialogFooter>
            <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => setConfirmRollback(null)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={doRollback} disabled={rollbackMut.isPending}>
              {rollbackMut.isPending ? t('Rolling back…', 'جاري التراجع…') : t('Rollback', 'تراجع')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplatesTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: templates = [], isLoading } = useListImportMappingTemplates();
  const deleteMut = useDeleteImportMappingTemplate();

  async function handleDelete(tpl: ImportMappingTemplate) {
    try {
      await deleteMut.mutateAsync({ id: tpl.id });
      toast({ title: t('Template deleted', 'تم حذف القالب') });
      queryClient.invalidateQueries({ queryKey: getListImportMappingTemplatesQueryKey() });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="text-center py-8 text-slate-400">{t('Loading…', 'جاري التحميل…')}</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 text-slate-400">{t('No saved templates.', 'لا توجد قوالب محفوظة.')}</div>
      ) : templates.map(tpl => (
        <div key={tpl.id} className="flex items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded">
          <div>
            <div className="text-white font-medium">{tpl.name}</div>
            <div className="text-slate-400 text-xs mt-0.5">{t('Type:', 'النوع:')} {tpl.importType}</div>
          </div>
          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(tpl)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function DataImport() {
  const { t } = useLanguage();

  return (
    <AnimatedPage className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Upload className="w-8 h-8 text-primary" />
          {t('Data Import', 'استيراد البيانات')}
        </h1>
        <p className="text-slate-400 mt-1">{t('Import employees, balances, and reference data via CSV', 'استيراد الموظفين والأرصدة والبيانات المرجعية عبر CSV')}</p>
      </div>

      <Tabs defaultValue="new-import">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="new-import" className="data-[state=active]:bg-slate-700">
            {t('New Import', 'استيراد جديد')}
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-slate-700">
            {t('Import History', 'سجل الاستيراد')}
          </TabsTrigger>
          <TabsTrigger value="templates" className="data-[state=active]:bg-slate-700">
            {t('Mapping Templates', 'قوالب التعيين')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new-import" className="mt-4">
          <NewImportTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </AnimatedPage>
  );
}
