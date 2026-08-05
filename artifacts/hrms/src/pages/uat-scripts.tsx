import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListUatScripts,
  useListUatTestRuns,
  useCreateUatTestRun,
  useUpdateUatTestRunStep,
  useCompleteUatTestRun,
  useGetUatTestRunsSummary,
  getListUatTestRunsQueryKey,
  getGetUatTestRunsSummaryQueryKey,
} from '@workspace/api-client-react';
import type { UatScript, UatTestRun } from '@workspace/api-client-react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardCheck, PlayCircle, ChevronDown, ChevronRight, CheckCircle, XCircle, SkipForward, AlertTriangle, RefreshCw } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
import { localName } from '@/lib/localise';
interface UATStep { stepNumber: number; actionEn: string; actionAr: string; expectedResultEn: string; expectedResultAr: string; inputData?: string; navigateTo?: string; }
interface StepResult { stepNumber: number; result: 'pass' | 'fail' | 'skip'; notes: string; }

function parseSteps(script: UatScript): UATStep[] {
  try {
    const parsed = JSON.parse(script.stepsJson ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ResultBadge({ result }: { result: string }) {
  const map: Record<string, string> = { pass: 'bg-emerald-900 text-emerald-300', fail: 'bg-red-900 text-red-300', skip: 'bg-slate-700 text-slate-300', partial: 'bg-amber-900 text-amber-300' };
  return <Badge className={`text-xs ${map[result] ?? 'bg-slate-700 text-slate-300'}`}>{result}</Badge>;
}

const ROLES = ['HR Admin', 'Payroll Admin', 'Line Manager', 'Employee', 'Attendance Supervisor', 'Auditor', 'Security Admin', 'Government User', 'Defense User'];
const MODULES = ['Attendance', 'Leave', 'Payroll', 'Security', 'Recruitment', 'Training', 'Performance', 'Reports'];

// ─── Step Execution Dialog ────────────────────────────────────────────────────
function ScriptRunDialog({ script, open, onClose, onComplete }: { script: UatScript | null; open: boolean; onClose: () => void; onComplete: () => void }) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [tester, setTester] = useState('');
  const [env, setEnv] = useState('demo');
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [note, setNote] = useState('');
  const [finishing, setFinishing] = useState(false);

  const createRunMut = useCreateUatTestRun();
  const updateStepMut = useUpdateUatTestRunStep();
  const completeRunMut = useCompleteUatTestRun();

  useEffect(() => { if (open) { setStep(0); setResults([]); setNote(''); } }, [open]);

  if (!script) return null;
  const scriptId = script.id;
  const steps = parseSteps(script);
  const currentStep = steps[step];
  const progress = steps.length > 0 ? Math.round((step / steps.length) * 100) : 0;

  function recordStep(result: 'pass' | 'fail' | 'skip') {
    const newResults = [...results, { stepNumber: currentStep.stepNumber, result, notes: note }];
    setResults(newResults);
    setNote('');
    if (step + 1 >= steps.length) {
      finishRun(newResults);
    } else {
      setStep(s => s + 1);
    }
  }

  async function finishRun(finalResults: StepResult[]) {
    setFinishing(true);
    try {
      const run = await createRunMut.mutateAsync({
        data: { scriptId, testerNameEn: tester || null, environment: env },
      });
      for (const sr of finalResults) {
        await updateStepMut.mutateAsync({
          id: run.id,
          stepNumber: sr.stepNumber,
          data: { result: sr.result, notes: sr.notes || null },
        });
      }
      await completeRunMut.mutateAsync({ id: run.id });
      toast({ title: t('Test run completed', 'اكتمل تشغيل الاختبار') });
      onComplete();
      onClose();
    } catch { toast({ title: t('Error saving run', 'خطأ في حفظ التشغيل'), variant: 'destructive' }); }
    finally { setFinishing(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
        <DialogHeader><DialogTitle className="text-white">{t(script.titleEn, script.titleAr)}</DialogTitle></DialogHeader>
        {step === 0 && results.length === 0 && (
          <div className="flex gap-3 mb-4">
            <Input placeholder={t('Tester name', 'اسم المختبر')} className="bg-slate-700 border-slate-600 text-white" value={tester} onChange={e => setTester(e.target.value)} />
            <select className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm" value={env} onChange={e => setEnv(e.target.value)}>
              {['demo', 'staging', 'production'].map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        )}
        {currentStep ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>{t('Step', 'خطوة')} {step + 1} / {steps.length}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-slate-600 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4 space-y-2">
              <div className="font-semibold text-white">{localName(currentStep.actionEn, currentStep.actionAr, lang)}</div>
              <div className="text-sm text-emerald-300">{t('Expected:', 'المتوقع:')} {localName(currentStep.expectedResultEn, currentStep.expectedResultAr, lang)}</div>
              {currentStep.inputData && <div className="text-xs text-blue-300 bg-blue-900/20 rounded p-2">{t('Input:', 'المدخل:')} {currentStep.inputData}</div>}
              {currentStep.navigateTo && (
                <a href={currentStep.navigateTo} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 underline">
                  {t('Navigate to:', 'انتقل إلى:')} {currentStep.navigateTo}
                </a>
              )}
            </div>
            <Textarea placeholder={t('Notes (optional)', 'ملاحظات (اختياري)')} className="bg-slate-700 border-slate-600 text-white text-sm" value={note} onChange={e => setNote(e.target.value)} rows={2} />
            <div className="flex gap-2">
              <Button onClick={() => recordStep('pass')} className="bg-emerald-700 hover:bg-emerald-800 flex-1" disabled={finishing}>
                <CheckCircle className="w-4 h-4 mr-1" />{t('Pass', 'نجاح')}
              </Button>
              <Button onClick={() => recordStep('fail')} className="bg-red-700 hover:bg-red-800 flex-1" disabled={finishing}>
                <XCircle className="w-4 h-4 mr-1" />{t('Fail', 'فشل')}
              </Button>
              <Button onClick={() => recordStep('skip')} variant="outline" className="border-slate-600 text-slate-300 flex-1" disabled={finishing}>
                <SkipForward className="w-4 h-4 mr-1" />{t('Skip', 'تخطي')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-slate-400 text-center py-8">{t('No steps defined for this script.', 'لا توجد خطوات لهذا البرنامج النصي.')}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Coverage Matrix ──────────────────────────────────────────────────────────
function CoverageMatrix({ runs, scripts }: { runs: UatTestRun[]; scripts: UatScript[] }) {
  const { t } = useLanguage();
  const scriptById = new Map(scripts.map(s => [s.id, s]));
  const matrix: Record<string, Record<string, { count: number; result: string }>> = {};
  ROLES.forEach(r => { matrix[r] = {}; MODULES.forEach(m => { matrix[r][m] = { count: 0, result: '' }; }); });
  runs.forEach(run => {
    const script = scriptById.get(run.scriptId);
    const role = run.testerRole ?? script?.targetRole ?? '';
    const mod = script?.module;
    if (!mod || !matrix[role]?.[mod]) return;
    matrix[role][mod].count++;
    if (run.result === 'fail') matrix[role][mod].result = 'fail';
    else if (!matrix[role][mod].result) matrix[role][mod].result = run.result;
  });
  const completeRoles = ROLES.filter(r => MODULES.every(m => matrix[r][m].count > 0)).length;

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">{completeRoles} / {ROLES.length} {t('roles have complete UAT coverage', 'أدوار لديها تغطية UAT كاملة')}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-slate-400 text-left py-2 pr-4">{t('Role', 'الدور')}</th>
              {MODULES.map(m => <th key={m} className="text-slate-400 text-center px-2 py-2">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROLES.map(role => (
              <tr key={role} className="border-b border-slate-700/50">
                <td className="text-white py-2 pr-4 whitespace-nowrap">{role}</td>
                {MODULES.map(mod => {
                  const cell = matrix[role][mod];
                  const color = cell.count === 0 ? 'bg-slate-700/30' : cell.result === 'fail' ? 'bg-red-900/50' : cell.result === 'pass' ? 'bg-emerald-900/50' : 'bg-amber-900/50';
                  return (
                    <td key={mod} className="text-center px-2 py-2">
                      <div className={`rounded text-center mx-auto w-8 h-6 flex items-center justify-center text-xs ${color}`}>
                        {cell.count > 0 ? cell.count : '—'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function UATScripts() {
  const { t, lang } = useLanguage();
  const queryClient = useQueryClient();
  const { data: scripts = [], isLoading: scriptsLoading } = useListUatScripts();
  const { data: runs = [], isLoading: runsLoading } = useListUatTestRuns();
  const { data: summary } = useGetUatTestRunsSummary();
  const loading = scriptsLoading || runsLoading;
  const [runScript, setRunScript] = useState<UatScript | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [runFilters, setRunFilters] = useState({ result: '', role: '', module: '' });

  const scriptById = new Map(scripts.map(s => [s.id, s]));

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListUatTestRunsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUatTestRunsSummaryQueryKey() });
  }

  const filteredScripts = scripts.filter(s => {
    if (roleFilter && s.targetRole !== roleFilter) return false;
    if (moduleFilter && s.module !== moduleFilter) return false;
    return true;
  });

  const filteredRuns = runs.filter(r => {
    const role = r.testerRole ?? scriptById.get(r.scriptId)?.targetRole ?? '';
    if (runFilters.result && r.result !== runFilters.result) return false;
    if (runFilters.role && role !== runFilters.role) return false;
    return true;
  });

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <ClipboardCheck className="w-8 h-8 text-blue-400" />
            {t('UAT Scripts', 'نصوص قبول المستخدم')}
          </h1>
          <p className="text-slate-400 mt-1 text-sm">{t('User Acceptance Testing hub — scripts, runs, and coverage', 'مركز اختبار قبول المستخدم — النصوص والتشغيلات والتغطية')}</p>
        </div>
      </div>

      <Tabs defaultValue="scripts">
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="scripts" className="data-[state=active]:bg-slate-700">{t('Scripts', 'النصوص')}</TabsTrigger>
          <TabsTrigger value="runs" className="data-[state=active]:bg-slate-700">{t('Test Runs', 'تشغيلات الاختبار')}</TabsTrigger>
          <TabsTrigger value="coverage" className="data-[state=active]:bg-slate-700">{t('Coverage Report', 'تقرير التغطية')}</TabsTrigger>
        </TabsList>

        {/* Scripts Tab */}
        <TabsContent value="scripts" className="mt-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <select className="bg-slate-700 border border-slate-600 text-slate-300 rounded px-3 py-1.5 text-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="">{t('All Roles', 'كل الأدوار')}</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="bg-slate-700 border border-slate-600 text-slate-300 rounded px-3 py-1.5 text-sm" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
              <option value="">{t('All Modules', 'كل الوحدات')}</option>
              {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array(6).fill(0).map((_, i) => <div key={i} className="h-40 bg-slate-700/50 rounded-lg animate-pulse" />)}</div>
          ) : filteredScripts.length === 0 ? (
            <div className="text-slate-500 text-center py-16">{t('No scripts found', 'لا توجد نصوص')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredScripts.map(sc => (
                <Card key={sc.id} className="bg-slate-800 border-slate-700">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <Badge className="bg-slate-700 text-slate-300 text-xs font-mono">{sc.scriptCode}</Badge>
                    </div>
                    <div className="font-semibold text-white text-sm">{localName(sc.titleEn, sc.titleAr, lang)}</div>
                    <div className="flex gap-1 flex-wrap">
                      <Badge className="bg-blue-900 text-blue-300 text-xs">{sc.targetRole}</Badge>
                      <Badge className="bg-purple-900 text-purple-300 text-xs">{sc.module}</Badge>
                    </div>
                    <div className="text-xs text-slate-400">
                      {sc.estimatedMinutes} {t('min', 'دقيقة')} · {parseSteps(sc).length} {t('steps', 'خطوات')}
                    </div>
                    <Button size="sm" className="w-full bg-blue-700 hover:bg-blue-800 mt-2" onClick={() => setRunScript(sc)}>
                      <PlayCircle className="w-4 h-4 mr-1" />{t('Run Script', 'تشغيل البرنامج')}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Test Runs Tab */}
        <TabsContent value="runs" className="mt-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <select className="bg-slate-700 border border-slate-600 text-slate-300 rounded px-3 py-1.5 text-sm" value={runFilters.result} onChange={e => setRunFilters(f => ({ ...f, result: e.target.value }))}>
              <option value="">{t('All Results', 'كل النتائج')}</option>
              {['pass','fail','partial'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="bg-slate-700 border border-slate-600 text-slate-300 rounded px-3 py-1.5 text-sm" value={runFilters.role} onChange={e => setRunFilters(f => ({ ...f, role: e.target.value }))}>
              <option value="">{t('All Roles', 'كل الأدوار')}</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">{t('Script', 'البرنامج')}</TableHead>
                  <TableHead className="text-slate-400">{t('Tester', 'المختبر')}</TableHead>
                  <TableHead className="text-slate-400">{t('Role', 'الدور')}</TableHead>
                  <TableHead className="text-slate-400">{t('Result', 'النتيجة')}</TableHead>
                  <TableHead className="text-slate-400">{t('P/F/S', 'ن/ف/ت')}</TableHead>
                  <TableHead className="text-slate-400">{t('Date', 'التاريخ')}</TableHead>
                  <TableHead className="text-slate-400"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-8">{t('Loading…', 'جارٍ التحميل…')}</TableCell></TableRow>
                ) : filteredRuns.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-8">{t('No test runs found', 'لا توجد تشغيلات')}</TableCell></TableRow>
                ) : filteredRuns.map(run => {
                  const script = scriptById.get(run.scriptId);
                  const role = run.testerRole ?? script?.targetRole ?? '—';
                  return (
                  <>
                    <TableRow key={run.id} className="border-slate-700">
                      <TableCell><Badge className="bg-slate-700 text-slate-300 text-xs font-mono">{script?.scriptCode ?? `#${run.scriptId}`}</Badge></TableCell>
                      <TableCell className="text-white text-sm">{run.testerNameEn || '—'}</TableCell>
                      <TableCell><Badge className="bg-blue-900 text-blue-300 text-xs">{role}</Badge></TableCell>
                      <TableCell><ResultBadge result={run.result} /></TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        <span className="text-emerald-400">{run.passedSteps}P</span> / <span className="text-red-400">{run.failedSteps}F</span> / <span className="text-slate-400">{run.skippedSteps}S</span>
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">{new Date(run.startedAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400" onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                          {expandedRun === run.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedRun === run.id && (
                      <TableRow key={`${run.id}-detail`} className="border-slate-700">
                        <TableCell colSpan={7} className="bg-slate-900/50 p-4">
                          <div className="space-y-1 text-xs text-slate-400">
                            <div>{t('Environment', 'البيئة')}: <span className="text-white">{run.environment}</span></div>
                            <div>{t('Steps', 'الخطوات')}: <span className="text-white">{run.currentStep} / {run.totalSteps}</span></div>
                            {run.overallNotes && <div>{t('Notes', 'ملاحظات')}: <span className="text-white">{run.overallNotes}</span></div>}
                            {run.completedAt && <div>{t('Completed', 'اكتمل')}: <span className="text-white">{new Date(run.completedAt).toLocaleString()}</span></div>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Coverage Report Tab */}
        <TabsContent value="coverage" className="mt-4 space-y-4">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-slate-800 border-slate-700"><CardContent className="p-4"><div className="text-xs text-slate-400">{t('Total Runs', 'إجمالي التشغيلات')}</div><div className="text-2xl font-bold text-white">{summary.totalRuns}</div></CardContent></Card>
              <Card className="bg-slate-800 border-slate-700"><CardContent className="p-4"><div className="text-xs text-slate-400">{t('Passed', 'ناجحة')}</div><div className="text-2xl font-bold text-emerald-400">{summary.passed}</div></CardContent></Card>
              <Card className="bg-slate-800 border-slate-700"><CardContent className="p-4"><div className="text-xs text-slate-400">{t('Failed', 'فاشلة')}</div><div className="text-2xl font-bold text-red-400">{summary.failed}</div></CardContent></Card>
              <Card className="bg-slate-800 border-slate-700"><CardContent className="p-4"><div className="text-xs text-slate-400">{t('Roles Covered', 'الأدوار المغطاة')}</div><div className="text-2xl font-bold text-white">{summary.rolesCovered.length}</div></CardContent></Card>
            </div>
          )}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" />{t('Coverage Matrix', 'مصفوفة التغطية')}</CardTitle></CardHeader>
            <CardContent>{loading ? <div className="h-40 bg-slate-700/50 rounded animate-pulse" /> : <CoverageMatrix runs={runs} scripts={scripts} />}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ScriptRunDialog script={runScript} open={!!runScript} onClose={() => setRunScript(null)} onComplete={refresh} />
    </AnimatedPage>
  );
}
