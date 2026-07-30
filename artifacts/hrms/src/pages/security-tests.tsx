import { apiFetch } from '@/lib/api';
import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldAlert, RefreshCw, AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight, Info } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SecurityScenario {
  id: number; scenarioCode: string; titleEn: string; titleAr: string;
  attackVector: string; severity: string; strideCategory: string;
  targetEndpoint: string; executionType: string; lastResult?: string;
}
interface SecurityFinding {
  id: number; result: string; scenarioCode: string;
  actualStatusCode: number; expectedStatusCode: number;
  auditLogFound: boolean; alertTriggered: boolean;
  findingDescription: string; remediationHint?: string; isGoLiveBlocker?: boolean;
}
interface SecurityRun {
  id: number; label: string; runType: string; status: string; startedAt: string;
  passedCount: number; failedCount: number; warnedCount: number; skippedCount: number;
  overallPosture: string; findings?: SecurityFinding[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const VECTOR_COLORS: Record<string, string> = {
  auth_bypass: 'bg-red-900 text-red-300',
  idor: 'bg-purple-900 text-purple-300',
  privilege_escalation: 'bg-orange-900 text-orange-300',
  xss: 'bg-pink-900 text-pink-300',
  sqli: 'bg-yellow-900 text-yellow-300',
  csrf: 'bg-indigo-900 text-indigo-300',
  rate_limit: 'bg-cyan-900 text-cyan-300',
  session: 'bg-teal-900 text-teal-300',
  information_disclosure: 'bg-slate-700 text-slate-300',
};

function AttackVectorBadge({ vector }: { vector: string }) {
  return <Badge className={`text-xs ${VECTOR_COLORS[vector] ?? 'bg-slate-700 text-slate-300'}`}>{vector?.replace(/_/g, ' ')}</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = { critical: 'bg-red-900 text-red-300', high: 'bg-amber-900 text-amber-300', medium: 'bg-blue-900 text-blue-300', low: 'bg-slate-700 text-slate-300' };
  return <Badge className={`text-xs ${map[severity] ?? 'bg-slate-700 text-slate-300'}`}>{severity}</Badge>;
}

function ResultBadge({ result }: { result: string }) {
  const map: Record<string, string> = { pass: 'bg-emerald-900 text-emerald-300', fail: 'bg-red-900 text-red-300', warn: 'bg-amber-900 text-amber-300', skip: 'bg-slate-700 text-slate-300' };
  return <Badge className={`text-xs ${map[result] ?? 'bg-slate-700 text-slate-300'}`}>{result}</Badge>;
}

function PostureBadge({ posture }: { posture: string }) {
  const map: Record<string, string> = { secure: 'bg-emerald-900 text-emerald-300', at_risk: 'bg-amber-900 text-amber-300', critical_failure: 'bg-red-900 text-red-300' };
  return <Badge className={`text-sm px-3 py-1 ${map[posture] ?? 'bg-slate-700 text-slate-300'}`}>{posture?.replace(/_/g, ' ')}</Badge>;
}

// ─── Demo Mode Gaps Table ─────────────────────────────────────────────────────
const DEMO_GAPS = [
  { gap: 'Authentication guards', currentBehavior: 'Demo users auto-authenticated', requiredForProduction: 'Keycloak OIDC + session middleware' },
  { gap: 'Authorization (RBAC)', currentBehavior: 'Basic role checks on some routes', requiredForProduction: 'Role-based middleware on all routes' },
  { gap: 'Cross-org isolation', currentBehavior: 'OrgId filter partial', requiredForProduction: 'OrgId filter on all tenant queries (Task #43)' },
  { gap: 'Session fixation', currentBehavior: 'Session not invalidated on auth', requiredForProduction: 'Session invalidation on auth' },
  { gap: 'Rate limiting', currentBehavior: 'No rate limiting implemented', requiredForProduction: 'Express rate-limit middleware' },
];

// ─── Findings Modal ───────────────────────────────────────────────────────────
function FindingsModal({ run, open, onClose }: { run: SecurityRun | null; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  if (!run) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('Findings', 'النتائج')}: {run.label}</DialogTitle></DialogHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Result', 'النتيجة')}</TableHead>
                <TableHead className="text-slate-400">{t('Scenario', 'السيناريو')}</TableHead>
                <TableHead className="text-slate-400">{t('Actual/Expected', 'الفعلي/المتوقع')}</TableHead>
                <TableHead className="text-slate-400">{t('Audit', 'تدقيق')}</TableHead>
                <TableHead className="text-slate-400">{t('Alert', 'تنبيه')}</TableHead>
                <TableHead className="text-slate-400">{t('Description', 'الوصف')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(run.findings ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-8">{t('No findings', 'لا توجد نتائج')}</TableCell></TableRow>
              ) : (run.findings ?? []).map(f => (
                <TableRow key={f.id} className="border-slate-700">
                  <TableCell><ResultBadge result={f.result} /></TableCell>
                  <TableCell><Badge className="bg-slate-700 text-slate-300 text-xs font-mono">{f.scenarioCode}</Badge></TableCell>
                  <TableCell className="text-xs">
                    <span className="text-red-400">{f.actualStatusCode}</span> / <span className="text-emerald-400">{f.expectedStatusCode}</span>
                  </TableCell>
                  <TableCell>{f.auditLogFound ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}</TableCell>
                  <TableCell>{f.alertTriggered ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}</TableCell>
                  <TableCell className="text-slate-300 text-xs max-w-xs">{f.findingDescription}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SecurityTests() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [scenarios, setScenarios] = useState<SecurityScenario[]>([]);
  const [runs, setRuns] = useState<SecurityRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const [viewRun, setViewRun] = useState<SecurityRun | null>(null);
  const [expandedVectors, setExpandedVectors] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const [sc, ru] = await Promise.allSettled([
        apiFetch('/api/security-test-scenarios').then(r => r.json()),
        apiFetch('/api/security-test-runs').then(r => r.json()),
      ]);
      if (sc.status === 'fulfilled') setScenarios(Array.isArray(sc.value) ? sc.value : sc.value.scenarios ?? []);
      if (ru.status === 'fulfilled') setRuns(Array.isArray(ru.value) ? ru.value : ru.value.runs ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleRunAll() {
    setRunningAll(true);
    try {
      await apiFetch('/api/security-test-runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runType: 'automated' }) });
      toast({ title: t('Security tests triggered', 'تم تشغيل اختبارات الأمان') });
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setRunningAll(false); }
  }

  async function loadFindings(run: SecurityRun) {
    try {
      const data = await apiFetch(`/api/security-test-runs/${run.id}`).then(r => r.json());
      setViewRun({ ...run, findings: data.findings ?? data ?? [] });
    } catch { setViewRun(run); }
  }

  const latestRun = runs[0];

  // Group scenarios by attackVector for Findings Summary
  const byVector = scenarios.reduce<Record<string, SecurityScenario[]>>((acc, s) => {
    if (!acc[s.attackVector]) acc[s.attackVector] = [];
    acc[s.attackVector].push(s);
    return acc;
  }, {});

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-red-400" />
            {t('Security Tests', 'اختبارات الأمان')}
          </h1>
          <p className="text-slate-400 mt-1 text-sm">{t('Security test scenario management and findings tracking', 'إدارة سيناريوهات اختبار الأمان وتتبع النتائج')}</p>
        </div>
      </div>

      <Tabs defaultValue="scenarios">
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="scenarios" className="data-[state=active]:bg-slate-700">{t('Scenarios', 'السيناريوهات')}</TabsTrigger>
          <TabsTrigger value="runs" className="data-[state=active]:bg-slate-700">{t('Test Runs', 'تشغيلات الاختبار')}</TabsTrigger>
          <TabsTrigger value="summary" className="data-[state=active]:bg-slate-700">{t('Findings Summary', 'ملخص النتائج')}</TabsTrigger>
        </TabsList>

        {/* Scenarios Tab */}
        <TabsContent value="scenarios" className="mt-4 space-y-4">
          <div className="bg-amber-950/60 border border-amber-700 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-amber-300 text-sm">
              {t(
                'Automated security tests in DEMO MODE document expected behavior vs. actual behavior. Scenarios marked WARN indicate controls that require real session middleware, Keycloak integration, or org isolation before go-live.',
                'تختبارات الأمان الآلية في الوضع التجريبي توثق السلوك المتوقع مقابل الفعلي. السيناريوهات المحددة بـ WARN تشير إلى ضوابط تتطلب وسيط جلسة حقيقي أو تكامل Keycloak أو عزل المؤسسة قبل الإطلاق.'
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleRunAll} disabled={runningAll} className="bg-red-700 hover:bg-red-800">
              {runningAll ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <ShieldAlert className="w-4 h-4 mr-2" />}
              {t('Run All', 'تشغيل الكل')}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">{t('Code', 'الرمز')}</TableHead>
                  <TableHead className="text-slate-400">{t('Attack Vector', 'ناقل الهجوم')}</TableHead>
                  <TableHead className="text-slate-400">{t('Title', 'العنوان')}</TableHead>
                  <TableHead className="text-slate-400">{t('Severity', 'الخطورة')}</TableHead>
                  <TableHead className="text-slate-400">{t('STRIDE', 'STRIDE')}</TableHead>
                  <TableHead className="text-slate-400">{t('Endpoint', 'النقطة الطرفية')}</TableHead>
                  <TableHead className="text-slate-400">{t('Type', 'النوع')}</TableHead>
                  <TableHead className="text-slate-400">{t('Last Result', 'آخر نتيجة')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">{t('Loading…', 'جارٍ التحميل…')}</TableCell></TableRow>
                ) : scenarios.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">{t('No scenarios found', 'لا توجد سيناريوهات')}</TableCell></TableRow>
                ) : scenarios.map(s => (
                  <TableRow key={s.id} className="border-slate-700">
                    <TableCell><Badge className="bg-slate-700 text-slate-300 text-xs font-mono">{s.scenarioCode}</Badge></TableCell>
                    <TableCell><AttackVectorBadge vector={s.attackVector} /></TableCell>
                    <TableCell className="text-white text-sm">{lang === 'ar' ? s.titleAr : s.titleEn}</TableCell>
                    <TableCell><SeverityBadge severity={s.severity} /></TableCell>
                    <TableCell className="text-slate-400 text-xs">{s.strideCategory}</TableCell>
                    <TableCell className="text-slate-400 text-xs font-mono max-w-xs truncate">{s.targetEndpoint}</TableCell>
                    <TableCell><Badge className={`text-xs ${s.executionType === 'automated' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>{s.executionType}</Badge></TableCell>
                    <TableCell>{s.lastResult ? <ResultBadge result={s.lastResult} /> : <span className="text-slate-600 text-xs">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Test Runs Tab */}
        <TabsContent value="runs" className="mt-4 space-y-4">
          <div className="space-y-3">
            {loading ? Array(3).fill(0).map((_, i) => <div key={i} className="h-24 bg-slate-700/50 rounded-lg animate-pulse" />) :
              runs.length === 0 ? <div className="text-slate-500 text-center py-16">{t('No test runs found', 'لا توجد تشغيلات')}</div> :
              runs.map(run => (
                <Card key={run.id} className="bg-slate-800 border-slate-700">
                  <CardContent className="p-4 flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white">{run.label}</span>
                        <Badge className={`text-xs ${run.runType === 'automated' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300'}`}>{run.runType}</Badge>
                        <Badge className={`text-xs ${run.status === 'complete' ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'}`}>{run.status}</Badge>
                      </div>
                      <div className="text-xs text-slate-400">{new Date(run.startedAt).toLocaleString()}</div>
                      <div className="flex gap-3 mt-1 text-xs">
                        <span className="text-emerald-400">{run.passedCount} {t('passed', 'ناجح')}</span>
                        <span className="text-red-400">{run.failedCount} {t('failed', 'فاشل')}</span>
                        <span className="text-amber-400">{run.warnedCount} {t('warned', 'تحذير')}</span>
                        <span className="text-slate-400">{run.skippedCount} {t('skipped', 'متخطى')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <PostureBadge posture={run.overallPosture} />
                      <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => loadFindings(run)}>
                        {t('View Findings', 'عرض النتائج')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            }
          </div>
        </TabsContent>

        {/* Findings Summary Tab */}
        <TabsContent value="summary" className="mt-4 space-y-4">
          {/* Overall posture */}
          {latestRun && (
            <Card className={`border-2 ${latestRun.overallPosture === 'secure' ? 'bg-emerald-900/20 border-emerald-600' : latestRun.overallPosture === 'at_risk' ? 'bg-amber-900/20 border-amber-600' : 'bg-red-900/20 border-red-600'}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold">{t('Overall Security Posture (Latest Run)', 'الوضع الأمني العام (آخر تشغيل)')}</div>
                  <div className="text-slate-400 text-sm mt-1">{latestRun.label} · {new Date(latestRun.startedAt).toLocaleDateString()}</div>
                </div>
                <PostureBadge posture={latestRun.overallPosture} />
              </CardContent>
            </Card>
          )}

          {/* By attack vector accordion */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white">{t('Findings by Attack Vector', 'النتائج حسب ناقل الهجوم')}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(byVector).map(([vector, vecScenarios]) => {
                const isExp = expandedVectors[vector] !== false;
                const failCount = vecScenarios.filter(s => s.lastResult === 'fail').length;
                const warnCount = vecScenarios.filter(s => s.lastResult === 'warn').length;
                const passCount = vecScenarios.filter(s => s.lastResult === 'pass').length;
                return (
                  <div key={vector} className="border border-slate-600 rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-slate-700/50 hover:bg-slate-700 transition-colors text-left"
                      onClick={() => setExpandedVectors(p => ({ ...p, [vector]: !isExp }))}
                    >
                      <span className="flex items-center gap-2">
                        <AttackVectorBadge vector={vector} />
                        <span className="text-slate-400 text-xs">{vecScenarios.length} {t('scenarios', 'سيناريوهات')}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {failCount > 0 && <span className="text-xs text-red-400">{failCount} {t('fail', 'فشل')}</span>}
                        {warnCount > 0 && <span className="text-xs text-amber-400">{warnCount} {t('warn', 'تحذير')}</span>}
                        {passCount > 0 && <span className="text-xs text-emerald-400">{passCount} {t('pass', 'نجاح')}</span>}
                        {isExp ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                      </span>
                    </button>
                    {isExp && (
                      <div className="px-4 py-3 space-y-2">
                        {vecScenarios.map(s => (
                          <div key={s.id} className="flex items-center gap-3 text-sm">
                            <Badge className="bg-slate-700 text-slate-300 text-xs font-mono w-28 shrink-0">{s.scenarioCode}</Badge>
                            <span className="text-white flex-1">{lang === 'ar' ? s.titleAr : s.titleEn}</span>
                            <SeverityBadge severity={s.severity} />
                            {s.lastResult && <ResultBadge result={s.lastResult} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {scenarios.length === 0 && !loading && (
                <div className="text-slate-500 text-center py-8">{t('No scenarios', 'لا توجد سيناريوهات')}</div>
              )}
            </CardContent>
          </Card>

          {/* Demo Mode Gaps */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-400" />
                {t('DEMO MODE Gaps — Required for Production', 'فجوات الوضع التجريبي — مطلوبة للإنتاج')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-400">{t('Gap', 'الفجوة')}</TableHead>
                      <TableHead className="text-slate-400">{t('Current Behavior', 'السلوك الحالي')}</TableHead>
                      <TableHead className="text-slate-400">{t('Required for Production', 'مطلوب للإنتاج')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DEMO_GAPS.map(gap => (
                      <TableRow key={gap.gap} className="border-slate-700">
                        <TableCell className="text-white font-medium text-sm">{gap.gap}</TableCell>
                        <TableCell className="text-amber-400 text-sm">{gap.currentBehavior}</TableCell>
                        <TableCell className="text-emerald-400 text-sm">{gap.requiredForProduction}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FindingsModal run={viewRun} open={!!viewRun} onClose={() => setViewRun(null)} />
    </AnimatedPage>
  );
}
