import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListImportJobs, useCreateImportJob, useConfirmImportPreview,
  useExecuteImportJob, useRollbackImportJob,
  useListImportMappingTemplates, useCreateImportMappingTemplate,
  useDeleteImportMappingTemplate, useMarkImportMappingTemplateUsed,
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
import { Input } from '@/components/ui/input';
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
import * as XLSX from 'xlsx';

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

/** Parse CSV text into an array of cell arrays, honoring quoted fields (RFC 4180-style). */
export function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      row.push(cell); cell = ''; sawAny = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      if (sawAny || cell !== '') { row.push(cell); rows.push(row); }
      row = []; cell = ''; sawAny = false;
    } else {
      cell += ch;
      sawAny = true;
    }
  }
  if (sawAny || cell !== '') { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Extract trimmed header cells from CSV text. */
export function parseCsvHeaders(csvText: string): string[] {
  const rows = parseCsv(csvText);
  return (rows[0] ?? []).map(h => h.trim()).filter(Boolean);
}

/**
 * Convert one worksheet of a workbook to CSV text and derive the column mapping,
 * keeping any previous mapping for headers that still exist and auto-mapping
 * known defaults. Empty sheets yield `{ text: '', mapping: {} }`.
 */
export function extractSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string,
  prevMapping: Record<string, string>,
): { text: string; mapping: Record<string, string> } {
  const sheet = workbook.Sheets[sheetName];
  const text = sheet ? XLSX.utils.sheet_to_csv(sheet) : '';
  if (!text.trim()) return { text: '', mapping: {} };
  const headers = parseCsvHeaders(text);
  const mapping: Record<string, string> = {};
  headers.forEach(h => {
    const target = prevMapping[h] ?? DEFAULT_MAPPING[h];
    if (target) mapping[h] = target;
  });
  return { text, mapping };
}

/** Parse CSV text into objects keyed by the mapped target fields. */
function parseCsvRows(csvText: string, mapping: Record<string, string>): Record<string, string>[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
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
  const markUsedMut = useMarkImportMappingTemplateUsed();
  const { data: templates = [] } = useListImportMappingTemplates();
  const [importType, setImportType] = useState('employees');
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [mapping, setMapping] = useState<Record<string, string>>(DEFAULT_MAPPING);
  const [job, setJob] = useState<CreateImportJob201 | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileFormat, setFileFormat] = useState<'csv' | 'xlsx'>('csv');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const sourceCols = parseCsvHeaders(csvText);
  const submitting = createJobMut.isPending || confirmMut.isPending || executeMut.isPending;
  const typeTemplates = templates.filter(tpl => tpl.importType === importType);

  function handleApplyTemplate(templateId: string) {
    const tpl = typeTemplates.find(x => String(x.id) === templateId);
    if (!tpl) return;
    let saved: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(tpl.columnMappingJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape');
      saved = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>;
    } catch {
      toast({ title: t('This template could not be read', 'تعذر قراءة هذا القالب'), variant: 'destructive' });
      return;
    }
    const headers = parseCsvHeaders(csvText);
    const next: Record<string, string> = {};
    let applied = 0;
    headers.forEach(h => {
      const target = saved[h];
      if (target) { next[h] = target; applied++; }
    });
    setMapping(next);
    setJob(null);
    // Record the use server-side so admins can see which templates are active.
    markUsedMut.mutate(
      { id: tpl.id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListImportMappingTemplatesQueryKey() }) },
    );
    toast({
      title: applied > 0
        ? t(`Template applied — ${applied} of ${headers.length} columns mapped`, `تم تطبيق القالب — تم تعيين ${applied} من ${headers.length} أعمدة`)
        : t('Template applied, but none of its columns match the file headers', 'تم تطبيق القالب، لكن لا يطابق أي من أعمدته رؤوس الملف'),
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXlsx = /\.xlsx$/i.test(file.name);

    function applyParsedText(text: string, format: 'csv' | 'xlsx') {
      if (!text.trim()) {
        toast({ title: t('The file is empty', 'الملف فارغ'), variant: 'destructive' });
        return false;
      }
      setCsvText(text);
      setFileName(file!.name);
      setFileFormat(format);
      setJob(null);
      // Auto-map any headers that match the default mapping; keep others unmapped.
      const headers = parseCsvHeaders(text);
      setMapping(prev => {
        const next: Record<string, string> = {};
        headers.forEach(h => {
          const target = prev[h] ?? DEFAULT_MAPPING[h];
          if (target) next[h] = target;
        });
        return next;
      });
      return true;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (isXlsx) {
        try {
          const wb = XLSX.read(reader.result, { type: 'array' });
          const firstSheetName = wb.SheetNames[0];
          if (!firstSheetName) {
            toast({ title: t('The workbook has no worksheets', 'لا يحتوي المصنف على أوراق عمل'), variant: 'destructive' });
            return;
          }
          const multiSheet = wb.SheetNames.length > 1;
          if (!multiSheet) {
            const { text } = extractSheetData(wb, firstSheetName, {});
            if (applyParsedText(text, 'xlsx')) {
              setWorkbook(null);
              setSelectedSheet(null);
            }
            return;
          }
          // Multi-sheet workbook: always keep the workbook and show the picker,
          // even if the first sheet is empty (e.g. a cover sheet).
          const { text, mapping: nextMapping } = extractSheetData(wb, firstSheetName, mapping);
          setWorkbook(wb);
          setSelectedSheet(firstSheetName);
          setFileName(file.name);
          setFileFormat('xlsx');
          setJob(null);
          setCsvText(text);
          setMapping(nextMapping);
          if (!text.trim()) {
            toast({ title: t('The first worksheet is empty — pick another sheet below', 'ورقة العمل الأولى فارغة — اختر ورقة أخرى أدناه') });
          }
        } catch {
          toast({ title: t('Could not parse the Excel file', 'تعذر تحليل ملف Excel'), variant: 'destructive' });
        }
      } else {
        if (applyParsedText(typeof reader.result === 'string' ? reader.result : '', 'csv')) {
          setWorkbook(null);
          setSelectedSheet(null);
        }
      }
    };
    reader.onerror = () => {
      toast({ title: t('Could not read the file', 'تعذر قراءة الملف'), variant: 'destructive' });
    };
    if (isXlsx) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
    // Allow re-selecting the same file.
    e.target.value = '';
  }

  function handleSheetChange(sheetName: string) {
    if (!workbook || !workbook.Sheets[sheetName]) return;
    const { text, mapping: nextMapping } = extractSheetData(workbook, sheetName, mapping);
    setSelectedSheet(sheetName);
    setCsvText(text);
    setMapping(nextMapping);
    setJob(null);
    if (!text.trim()) {
      toast({ title: t('This worksheet is empty', 'ورقة العمل هذه فارغة'), variant: 'destructive' });
    }
  }

  async function handleValidate() {
    const rows = parseCsvRows(csvText, mapping);
    if (rows.length === 0) {
      toast({ title: t('No data rows found', 'لم يتم العثور على صفوف بيانات'), variant: 'destructive' });
      return;
    }
    try {
      const created = await createJobMut.mutateAsync({
        data: { importType, fileFormat, rowsJson: rows, columnMappingJson: mapping, originalFilename: fileName },
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

  function handleSaveTemplate() {
    setTemplateName(`${importType} mapping ${new Date().toISOString().slice(0, 10)}`);
    setSaveDialogOpen(true);
  }

  async function handleConfirmSaveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    try {
      await createTemplateMut.mutateAsync({
        data: { name, importType, columnMappingJson: mapping },
      });
      setSaveDialogOpen(false);
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
        <div>
          <Label className="text-slate-300">{t('Apply Saved Template', 'تطبيق قالب محفوظ')}</Label>
          <Select value="" onValueChange={handleApplyTemplate} disabled={typeTemplates.length === 0}>
            <SelectTrigger className="mt-1 bg-slate-800 border-slate-600 text-white" data-testid="select-mapping-template">
              <SelectValue placeholder={typeTemplates.length === 0
                ? t('No templates for this type', 'لا توجد قوالب لهذا النوع')
                : t('Choose a template…', 'اختر قالبًا…')} />
            </SelectTrigger>
            <SelectContent>
              {typeTemplates.map(tpl => (
                <SelectItem key={tpl.id} value={String(tpl.id)}>{tpl.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-slate-300">{t('CSV or Excel File', 'ملف CSV أو Excel')}</Label>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="input-csv-file"
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            className="border-slate-600 text-slate-300"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-upload-csv"
          >
            <Upload className="w-4 h-4 mr-2" />
            {t('Upload CSV / Excel File', 'رفع ملف CSV / Excel')}
          </Button>
          {fileName && (
            <span className="text-slate-400 text-sm font-mono" data-testid="text-uploaded-filename">{fileName}</span>
          )}
        </div>
      </div>

      {workbook && workbook.SheetNames.length > 1 && (
        <div>
          <Label className="text-slate-300">{t('Worksheet', 'ورقة العمل')}</Label>
          <Select value={selectedSheet ?? undefined} onValueChange={handleSheetChange}>
            <SelectTrigger className="mt-1 bg-slate-800 border-slate-600 text-white md:w-72" data-testid="select-worksheet">
              <SelectValue placeholder={t('Choose a worksheet…', 'اختر ورقة عمل…')} />
            </SelectTrigger>
            <SelectContent>
              {workbook.SheetNames.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-slate-500 text-xs mt-1">
            {t('This workbook has multiple sheets — pick the one to import.', 'يحتوي هذا المصنف على عدة أوراق — اختر الورقة المراد استيرادها.')}
          </p>
        </div>
      )}

      <div>
        <Label className="text-slate-300">{t('CSV Preview (or paste data here)', 'معاينة CSV (أو الصق البيانات هنا)')}</Label>
        <textarea
          className="mt-1 w-full h-28 bg-slate-800 border border-slate-600 rounded p-2 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-primary"
          value={csvText}
          onChange={e => { setCsvText(e.target.value); setFileName(null); setFileFormat('csv'); setJob(null); setWorkbook(null); setSelectedSheet(null); }}
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

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Save Mapping Template', 'حفظ قالب التعيين')}</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="template-name" className="text-slate-300">{t('Template Name', 'اسم القالب')}</Label>
            <Input
              id="template-name"
              className="mt-1 bg-slate-700 border-slate-600 text-white"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && templateName.trim() && !createTemplateMut.isPending) handleConfirmSaveTemplate(); }}
              autoFocus
              data-testid="input-template-name"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-600 text-slate-300"
              onClick={() => setSaveDialogOpen(false)}
            >
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleConfirmSaveTemplate}
              disabled={!templateName.trim() || createTemplateMut.isPending}
              data-testid="button-confirm-save-template"
            >
              {createTemplateMut.isPending ? t('Saving…', 'جاري الحفظ…') : t('Save', 'حفظ')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <div className="text-slate-400 text-xs mt-0.5" data-testid={`text-template-usage-${tpl.id}`}>
              {tpl.usageCount === 0
                ? t('Never used', 'لم يُستخدم أبدًا')
                : `${t('Used', 'استُخدم')} ${tpl.usageCount} ${t(tpl.usageCount === 1 ? 'time' : 'times', tpl.usageCount === 1 ? 'مرة' : 'مرات')}${tpl.lastUsedAt ? ` — ${t('last used', 'آخر استخدام')} ${new Date(tpl.lastUsedAt).toLocaleDateString()}` : ''}`}
            </div>
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
