import { useState } from 'react';
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
import {
  Upload, AlertTriangle, CheckCircle, XCircle, RotateCcw, Trash2,
} from 'lucide-react';

const IMPORT_TYPES = [
  { value: 'employees',       label: 'Employees',         labelAr: 'الموظفون' },
  { value: 'salary_grades',   label: 'Salary Grades',     labelAr: 'درجات الراتب' },
  { value: 'pay_components',  label: 'Pay Components',    labelAr: 'مكونات الراتب' },
  { value: 'leave_balances',  label: 'Leave Balances',    labelAr: 'أرصدة الإجازات' },
  { value: 'public_holidays', label: 'Public Holidays',   labelAr: 'العطل الرسمية' },
];

const EMPLOYEE_FIELDS = ['employee_code', 'full_name_en', 'full_name_ar', 'national_id', 'email', 'department', 'grade', 'hire_date'];

const SAMPLE_CSV_HEADER = 'code,name_english,name_arabic,nid,email,dept,grade,start_date';
const SAMPLE_CSV_ROWS = [
  '10001,Ahmed Al-Qahtani,أحمد القحطاني,1234567890,ahmed@example.com,Operations,G5,2023-01-01',
  '10002,Fatima Al-Harbi,فاطمة الحربي,0987654321,fatima@example.com,Finance,G4,2022-06-15',
  '10003,Mohammed Al-Ghamdi,محمد الغامدي,1122334455,mohammed@example.com,IT,G6,2024-03-10',
];
const SAMPLE_CSV = [SAMPLE_CSV_HEADER, ...SAMPLE_CSV_ROWS].join('\n');

const SOURCE_COLS = ['code', 'name_english', 'name_arabic', 'nid', 'email', 'dept', 'grade', 'start_date'];

const HISTORY_DATA = [
  { id: 1, type: 'employees', status: 'completed', total: 142, valid: 140, errors: 2, duplicates: 0, date: '2025-07-10 09:15', rollbackable: false },
  { id: 2, type: 'leave_balances', status: 'completed', total: 142, valid: 142, errors: 0, duplicates: 0, date: '2025-07-10 09:30', rollbackable: true },
  { id: 3, type: 'salary_grades', status: 'failed', total: 15, valid: 12, errors: 3, duplicates: 0, date: '2025-07-08 14:00', rollbackable: false },
  { id: 4, type: 'public_holidays', status: 'completed', total: 12, valid: 12, errors: 0, duplicates: 0, date: '2025-07-05 11:00', rollbackable: true },
];

const TEMPLATES = [
  { id: 1, name: 'Standard Employee Import', type: 'employees' },
  { id: 2, name: 'Annual Leave Balance Reset', type: 'leave_balances' },
];

const PREVIEW_ROWS = [
  { row: 1, status: 'valid', code: '10001', name: 'Ahmed Al-Qahtani', note: '' },
  { row: 2, status: 'valid', code: '10002', name: 'Fatima Al-Harbi', note: '' },
  { row: 3, status: 'error', code: '10003', name: 'Mohammed Al-Ghamdi', note: 'Grade G6 not found' },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    valid: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-700',
    duplicate: 'bg-amber-100 text-amber-700',
    completed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    processing: 'bg-blue-100 text-blue-700',
  };
  return <Badge className={`text-xs ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>{status}</Badge>;
}

function NewImportTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [importType, setImportType] = useState('employees');
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [mapping, setMapping] = useState<Record<string, string>>({
    code: 'employee_code', name_english: 'full_name_en', name_arabic: 'full_name_ar',
    nid: 'national_id', email: 'email', dept: 'department', grade: 'grade', start_date: 'hire_date',
  });
  const [validated, setValidated] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleValidate() {
    setValidating(true);
    await new Promise(r => setTimeout(r, 800));
    setValidated(true);
    setValidating(false);
    toast({ title: t('Validation complete — 2 errors found', 'اكتمل التحقق — تم العثور على خطأين') });
  }

  async function handleImport() {
    setSubmitting(true);
    try {
      const rows = csvText.split('\n').slice(1).filter(Boolean).map(r => r.split(','));
      await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importType, fileFormat: 'csv', rowsJson: rows, columnMappingJson: mapping }),
      });
      toast({ title: t('Import submitted', 'تم تقديم الاستيراد') });
    } catch {
      toast({ title: t('Import failed', 'فشل الاستيراد'), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-slate-300">{t('Import Type', 'نوع الاستيراد')}</Label>
          <Select value={importType} onValueChange={setImportType}>
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
          onChange={e => setCsvText(e.target.value)}
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
              {SOURCE_COLS.map(col => (
                <TableRow key={col} className="border-slate-700 hover:bg-slate-700/30">
                  <TableCell className="font-mono text-slate-300 text-xs">{col}</TableCell>
                  <TableCell>
                    <Select value={mapping[col] ?? ''} onValueChange={v => setMapping(m => ({ ...m, [col]: v }))}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-200 h-8 text-xs w-48">
                        <SelectValue placeholder={t('-- skip --', '-- تخطي --')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{t('-- skip --', '-- تخطي --')}</SelectItem>
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
        <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() =>
          toast({ title: t('Template saved', 'تم حفظ القالب') })
        }>{t('Save Mapping Template', 'حفظ قالب التعيين')}</Button>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleValidate} disabled={validating}>
          {validating ? t('Validating…', 'جاري التحقق…') : t('Validate', 'تحقق')}
        </Button>
        {validated && (
          <Button className="bg-primary hover:bg-primary/90" onClick={handleImport} disabled={submitting}>
            {submitting ? t('Importing…', 'جاري الاستيراد…') : t('Run Import', 'تشغيل الاستيراد')}
          </Button>
        )}
      </div>

      {validated && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">{t('Preview Results', 'نتائج المعاينة')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 bg-slate-700/50">
                  <TableHead className="text-slate-400">{t('Row', 'الصف')}</TableHead>
                  <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-slate-400">{t('Code', 'الرمز')}</TableHead>
                  <TableHead className="text-slate-400">{t('Name', 'الاسم')}</TableHead>
                  <TableHead className="text-slate-400">{t('Note', 'ملاحظة')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PREVIEW_ROWS.map(r => (
                  <TableRow key={r.row} className="border-slate-700 hover:bg-slate-700/30">
                    <TableCell className="text-slate-300">{r.row}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-slate-300 font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-white">{r.name}</TableCell>
                    <TableCell className="text-red-400 text-xs">{r.note}</TableCell>
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
  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);

  function doRollback() {
    toast({ title: t('Rollback simulated — no production action taken', 'تم محاكاة التراجع — لم يتم اتخاذ أي إجراء إنتاجي') });
    setConfirmRollback(null);
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
            {HISTORY_DATA.map(row => (
              <TableRow key={row.id} className="border-slate-700 hover:bg-slate-700/30">
                <TableCell className="text-slate-300 text-xs font-mono">{row.type}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
                <TableCell className="text-slate-300">{row.total}</TableCell>
                <TableCell className="text-emerald-400">{row.valid}</TableCell>
                <TableCell className={row.errors > 0 ? 'text-red-400' : 'text-slate-400'}>{row.errors}</TableCell>
                <TableCell className="text-slate-400">{row.duplicates}</TableCell>
                <TableCell className="text-slate-400 text-xs">{row.date}</TableCell>
                <TableCell>
                  {row.rollbackable && (
                    <Button variant="ghost" size="sm" className="text-amber-400 hover:text-amber-300 h-7 text-xs"
                      onClick={() => setConfirmRollback(row.id)}>
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
          <p className="text-slate-400 text-sm">{t('This will undo the import job. Are you sure?', 'سيؤدي هذا إلى التراجع عن مهمة الاستيراد. هل أنت متأكد؟')}</p>
          <DialogFooter>
            <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => setConfirmRollback(null)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={doRollback}>
              {t('Rollback', 'تراجع')}
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
  const [templates, setTemplates] = useState(TEMPLATES);

  return (
    <div className="space-y-3">
      {templates.length === 0 && (
        <div className="text-center py-8 text-slate-400">{t('No saved templates.', 'لا توجد قوالب محفوظة.')}</div>
      )}
      {templates.map(tpl => (
        <div key={tpl.id} className="flex items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded">
          <div>
            <div className="text-white font-medium">{tpl.name}</div>
            <div className="text-slate-400 text-xs mt-0.5">{t('Type:', 'النوع:')} {tpl.type}</div>
          </div>
          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => {
            setTemplates(ts => ts.filter(t => t.id !== tpl.id));
            toast({ title: t('Template deleted', 'تم حذف القالب') });
          }}>
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
      {/* Prototype banner */}
      <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-3 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
        <span className="text-amber-300 font-semibold text-sm">
          {t('PROTOTYPE — Data import validation is simulated. Review all outputs carefully before using in production.',
             'نموذج أولي — التحقق من صحة استيراد البيانات هو محاكاة. راجع جميع المخرجات بعناية قبل الاستخدام في الإنتاج.')}
        </span>
      </div>

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
