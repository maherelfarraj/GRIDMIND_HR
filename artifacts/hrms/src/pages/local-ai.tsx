import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiConfig, useUpdateAiConfig, useListAiQueries,
  useAiPolicySearch, useAiReportQuery, useAiClassifyDocument, useUpdateDocument,
  getGetAiConfigQueryKey,
} from '@workspace/api-client-react';
import type {
  AiConfig, AiConfigInput, AiQuery,
  AiPolicySearch200ResultsItem, AiReportQuery200, AiReportQuery200PreviewRowsItem,
  AiClassifyDocument200,
} from '@workspace/api-client-react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Brain, Search, AlertTriangle, CheckCircle, ShieldCheck,
  FileText, BarChart2, Tag, Settings2, Zap, Cloud, AlertCircle,
} from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function parseFeatures(enabledFeatures: string | null | undefined): string[] {
  if (!enabledFeatures) return [];
  try {
    const parsed = JSON.parse(enabledFeatures);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return enabledFeatures.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/** Amber badge shown when the response fell back to simulation */
function SimBadge() {
  return (
    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs ms-2">
      ⚠ Simulated
    </Badge>
  );
}

/** Green badge shown when a real OpenAI response was returned */
function LiveBadge({ model }: { model?: string | null }) {
  return (
    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs ms-2">
      <Zap className="w-3 h-3 me-1" />
      {model ? model : 'Live AI'}
    </Badge>
  );
}

function RelevanceBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-[#1e3a5f] rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8 text-end">{Math.round(pct)}%</span>
    </div>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score * 100));
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8 text-end">{Math.round(pct)}%</span>
    </div>
  );
}

// ─── AI Status Banner ─────────────────────────────────────────────────────────

function AiBanner({ config }: { config: (AiConfig & { integrationProvisioned?: boolean }) | null | undefined }) {
  const { t } = useLanguage();

  const provisioned = (config as any)?.integrationProvisioned ?? false;
  const enabled = !!config?.isEnabled;
  const model = config?.modelName || 'gpt-5.6-terra';

  if (!provisioned) {
    return (
      <div className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm bg-red-950 border-red-700 text-red-300">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium">{t('OpenAI integration not provisioned', 'تكامل OpenAI غير مُهيَّأ')}</p>
          <p className="text-red-400 text-xs mt-0.5">
            {t(
              'The AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY environment variables are missing. Contact your system administrator.',
              'متغيرات البيئة AI_INTEGRATIONS_OPENAI_BASE_URL و AI_INTEGRATIONS_OPENAI_API_KEY غير موجودة. تواصل مع مسؤول النظام.',
            )}
          </p>
        </div>
        <Badge className="bg-red-100 text-red-800 border-red-300 shrink-0">⚠ {t('Not configured', 'غير مُهيَّأ')}</Badge>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
      enabled
        ? 'bg-sky-950 border-sky-700 text-sky-300'
        : 'bg-slate-800 border-slate-600 text-slate-400'
    }`}>
      <Cloud className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {enabled
          ? t(
              `AI requests are processed by ${model} via the OpenAI cloud API. HR data sent to the model is minimised to only what each feature requires.`,
              `تتم معالجة طلبات الذكاء الاصطناعي بواسطة ${model} عبر واجهة OpenAI السحابية. يُرسل الحد الأدنى من بيانات الموارد البشرية اللازمة لكل ميزة فحسب.`,
            )
          : t('AI is disabled. Enable it in the Configuration tab to start using live AI features.', 'الذكاء الاصطناعي معطّل. فعّله في تبويب الإعدادات لبدء استخدام ميزات الذكاء الاصطناعي المباشرة.')}
      </span>
      <Badge className={enabled
        ? 'bg-sky-100 text-sky-800 border-sky-300 shrink-0'
        : 'bg-slate-700 text-slate-300 border-slate-500 shrink-0'
      }>
        {enabled ? `✅ ${model}` : t('Disabled', 'معطّل')}
      </Badge>
    </div>
  );
}

// ─── Error banner for feature-level API errors ────────────────────────────────

function AiErrorBanner({ message }: { message: string }) {
  const isConfig = message.toLowerCase().includes('not provisioned') || message.toLowerCase().includes('environment');
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
      isConfig
        ? 'bg-red-950 border-red-700 text-red-300'
        : 'bg-amber-950 border-amber-700 text-amber-300'
    }`}>
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">{isConfig ? 'Configuration error' : 'AI request failed'}</p>
        <p className="text-xs mt-0.5 opacity-80">{message}</p>
      </div>
    </div>
  );
}

// ─── Policy Search Tab ────────────────────────────────────────────────────────

function PolicySearchTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const searchMut = useAiPolicySearch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AiPolicySearch200ResultsItem[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [wasSimulated, setWasSimulated] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const loading = searchMut.isPending;

  async function handleSearch() {
    if (!query.trim()) return;
    setResults([]);
    setSummary(null);
    setError(null);
    setSearched(true);
    try {
      const data = await searchMut.mutateAsync({ data: { query } });
      setResults(data?.results ?? []);
      setSummary((data as any)?.summary ?? null);
      setWasSimulated(data?.simulated ?? false);
      setModel((data as any)?.model ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast({ title: t('Search failed', 'فشل البحث'), description: msg, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          className="bg-slate-800 border-slate-700 text-white flex-1"
          placeholder={t('Search HR policies, procedures, regulations…', 'البحث في سياسات الموارد البشرية والإجراءات واللوائح…')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <Button
          className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/80 text-white"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          <Search className="w-4 h-4 me-1" />
          {t('Search', 'بحث')}
          {!loading && searched && (wasSimulated ? <SimBadge /> : model ? <LiveBadge model={model} /> : null)}
        </Button>
      </div>

      {error && <AiErrorBanner message={error} />}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-5 w-2/3 bg-slate-700" />
                <Skeleton className="h-12 w-full bg-slate-700" />
                <Skeleton className="h-2 w-full bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && summary && (
        <Card className="bg-slate-700 border-slate-600">
          <CardContent className="p-4">
            <p className="text-slate-200 text-sm leading-relaxed">{summary}</p>
          </CardContent>
        </Card>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map((r, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-white font-medium text-sm">{r.title ?? '—'}</span>
                  </div>
                  {r.documentId != null && (
                    <span className="text-xs text-sky-400 shrink-0">{t('Doc ID', 'معرف المستند')}: {r.documentId}</span>
                  )}
                </div>
                <p className="text-slate-300 text-sm mb-2">{r.excerpt ?? ''}</p>
                <RelevanceBar score={r.relevanceScore ?? 0.5} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && searched && !error && (
        <p className="text-center text-slate-500 py-8">{t('No results found', 'لم يتم العثور على نتائج')}</p>
      )}
    </div>
  );
}

// ─── Report Query Tab ─────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  { en: 'How many active employees do we have?', ar: 'كم عدد الموظفين النشطين لدينا؟' },
  { en: 'Which department has the most headcount?', ar: 'أي قسم يضم أكبر عدد من الموظفين؟' },
  { en: 'Show me employees with expiring contracts', ar: 'أرني الموظفين الذين تنتهي عقودهم قريباً' },
  { en: 'Summarise our overtime situation', ar: 'لخّص وضع العمل الإضافي لدينا' },
];

function ReportQueryTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const reportMut = useAiReportQuery();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiReportQuery200 & { reasoning?: string; keyMetrics?: { label: string; value: string }[]; model?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = reportMut.isPending;

  async function handleAsk() {
    if (!question.trim()) return;
    setResult(null);
    setError(null);
    try {
      const data = await reportMut.mutateAsync({ data: { query: question } });
      setResult(data as typeof result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast({ title: t('Query failed', 'فشل الاستعلام'), description: msg, variant: 'destructive' });
    }
  }

  const previewRows: AiReportQuery200PreviewRowsItem[] = result?.previewRows ?? [];
  const cols = previewRows.length > 0 ? Object.keys(previewRows[0]) : [];

  return (
    <div className="space-y-4">
      <div>
        <Textarea
          className="bg-slate-800 border-slate-700 text-white resize-none"
          rows={3}
          placeholder={t('Ask a question about your workforce data…', 'اطرح سؤالاً حول بيانات القوى العاملة…')}
          value={question}
          onChange={e => setQuestion(e.target.value)}
        />
        <div className="flex items-center justify-between mt-2">
          <Button
            className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/80 text-white"
            onClick={handleAsk}
            disabled={loading || !question.trim()}
          >
            <Brain className="w-4 h-4 me-1" />
            {t('Ask', 'اسأل')}
            {result && (result.simulated ? <SimBadge /> : <LiveBadge model={result.model} />)}
          </Button>
          <p className="text-xs text-slate-500">
            {t('The model classifies your query — no database statements are generated.', 'يُصنّف النموذج استعلامك — لا تُولَّد أي عبارات قاعدة بيانات.')}
          </p>
        </div>
      </div>

      {error && <AiErrorBanner message={error} />}

      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-500">{t('Try:', 'جرب:')}</span>
        {EXAMPLE_QUERIES.map((q, i) => (
          <button
            key={i}
            className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 border border-slate-600"
            onClick={() => setQuestion(t(q.en, q.ar))}
          >
            {t(q.en, q.ar)}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-slate-700" />
          <Skeleton className="h-24 w-full bg-slate-700" />
        </div>
      )}

      {!loading && result && (
        <div className="space-y-3">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">{t('AI Interpretation', 'تفسير الذكاء الاصطناعي')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-slate-300 text-sm">{result.interpretation ?? '—'}</p>
              {result.reasoning && (
                <p className="text-xs text-slate-500 italic">{result.reasoning}</p>
              )}
              {result.suggestedReport && (
                <p className="text-xs text-amber-400 mt-1">
                  {t('Suggested report:', 'التقرير المقترح:')}{' '}
                  <span className="font-medium">{result.suggestedReport}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {result.keyMetrics && result.keyMetrics.length > 0 && (
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-sm">{t('Key Metrics', 'المقاييس الرئيسية')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {result.keyMetrics.map((m, i) => (
                    <div key={i} className="bg-slate-700 rounded p-3">
                      <p className="text-xs text-slate-400">{m.label}</p>
                      <p className="text-white font-semibold mt-1">{m.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {previewRows.length > 0 && (
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-sm">{t('Preview Data', 'بيانات المعاينة')}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        {cols.map(c => <TableHead key={c} className="text-slate-400 text-xs">{c}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.slice(0, 5).map((row, i) => (
                        <TableRow key={i} className="border-slate-700">
                          {cols.map(c => (
                            <TableCell key={c} className="text-slate-300 text-xs">{String((row as Record<string, unknown>)[c] ?? '—')}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Document Classification Tab ──────────────────────────────────────────────

function ClassifyDocumentTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const classifyMut = useAiClassifyDocument();
  const updateDocMut = useUpdateDocument();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [result, setResult] = useState<AiClassifyDocument200 & { model?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = classifyMut.isPending;

  async function handleClassify() {
    if (!title.trim()) return;
    setResult(null);
    setError(null);
    try {
      const data = await classifyMut.mutateAsync({
        data: {
          title,
          content: content || undefined,
          documentId: documentId ? Number(documentId) : undefined,
        },
      });
      setResult(data as typeof result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast({ title: t('Classification failed', 'فشل التصنيف'), description: msg, variant: 'destructive' });
    }
  }

  async function handleApply() {
    if (!result || !documentId) return;
    try {
      await updateDocMut.mutateAsync({
        id: Number(documentId),
        data: { category: result.suggestedCategory },
      });
      toast({ title: t('Category applied', 'تم تطبيق الفئة') });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <Label className="text-slate-300">{t('Document Title', 'عنوان المستند')} *</Label>
        <Input
          className="bg-slate-800 border-slate-700 text-white mt-1"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('Enter document title…', 'أدخل عنوان المستند…')}
        />
      </div>
      <div>
        <Label className="text-slate-300">{t('Content (optional)', 'المحتوى (اختياري)')}</Label>
        <Textarea
          className="bg-slate-800 border-slate-700 text-white mt-1 resize-none"
          rows={4}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={t('Paste document content here…', 'الصق محتوى المستند هنا…')}
        />
      </div>
      <div>
        <Label className="text-slate-300">{t('Document ID (optional)', 'معرف المستند (اختياري)')}</Label>
        <Input
          className="bg-slate-800 border-slate-700 text-white mt-1"
          value={documentId}
          onChange={e => setDocumentId(e.target.value)}
          placeholder="123"
        />
      </div>

      {error && <AiErrorBanner message={error} />}

      <Button
        className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/80 text-white"
        onClick={handleClassify}
        disabled={loading || !title.trim()}
      >
        <Tag className="w-4 h-4 me-1" />
        {t('Classify', 'تصنيف')}
        {result && (result.simulated ? <SimBadge /> : <LiveBadge model={result.model} />)}
      </Button>

      {loading && <Skeleton className="h-28 w-full bg-slate-700" />}

      {!loading && result && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm">{t('Classification Result', 'نتيجة التصنيف')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">{t('Suggested Category', 'الفئة المقترحة')}</p>
              <Badge className="bg-[#1e3a5f] text-white capitalize">{result.suggestedCategory ?? '—'}</Badge>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">{t('Confidence', 'مستوى الثقة')}</p>
              <ConfidenceBar score={result.confidence ?? 0.5} />
            </div>
            {result.reasoning && (
              <div>
                <p className="text-xs text-slate-500 mb-1">{t('Reasoning', 'التفسير')}</p>
                <p className="text-sm text-slate-300">{result.reasoning}</p>
              </div>
            )}
            {documentId && (
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                onClick={handleApply}
                disabled={updateDocMut.isPending}
              >
                <CheckCircle className="w-4 h-4 me-1" />
                {t('Apply to Document', 'تطبيق على المستند')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Configuration Tab ────────────────────────────────────────────────────────

const FEATURE_KEYS = ['policy_search', 'report_query', 'document_classify', 'anomaly_explain'];

function ConfigurationTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const configQuery = useGetAiConfig();
  const updateMut = useUpdateAiConfig();
  const queriesQuery = useListAiQueries();
  const [draft, setDraft] = useState<AiConfigInput | null>(null);

  const rawConfig = configQuery.data as (AiConfig & { integrationProvisioned?: boolean }) | undefined;
  const provisioned = rawConfig?.integrationProvisioned ?? false;

  const config: AiConfigInput = draft ?? {
    modelName: rawConfig?.modelName ?? 'gpt-5.6-terra',
    isEnabled: rawConfig?.isEnabled ?? false,
    enabledFeatures: rawConfig?.enabledFeatures ?? null,
    maxTokens: rawConfig?.maxTokens,
    temperatureX100: rawConfig?.temperatureX100,
    requireApprovalForBulk: rawConfig?.requireApprovalForBulk,
    auditAllQueries: rawConfig?.auditAllQueries,
  };

  const loading = configQuery.isLoading;
  const saving = updateMut.isPending;
  const queries: AiQuery[] = queriesQuery.data?.data ?? [];
  const queriesLoading = queriesQuery.isLoading;
  const features = parseFeatures(config.enabledFeatures);
  const isGpt5 = (config.modelName ?? '').startsWith('gpt-5');

  function setF<K extends keyof AiConfigInput>(k: K, v: AiConfigInput[K]) {
    setDraft(p => ({ ...(p ?? config), [k]: v }));
  }

  function toggleFeature(feat: string) {
    const updated = features.includes(feat) ? features.filter(f => f !== feat) : [...features, feat];
    setF('enabledFeatures', JSON.stringify(updated));
  }

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ data: config });
      queryClient.invalidateQueries({ queryKey: getGetAiConfigQueryKey() });
      toast({ title: t('Configuration saved', 'تم حفظ الإعدادات') });
      setDraft(null);
    } catch {
      toast({ title: t('Error saving configuration', 'خطأ في حفظ الإعدادات'), variant: 'destructive' });
    }
  }

  if (loading) return <Skeleton className="h-64 w-full bg-slate-700" />;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Integration status */}
      <Card className={`border ${provisioned ? 'bg-emerald-950 border-emerald-800' : 'bg-red-950 border-red-800'}`}>
        <CardContent className="p-4 flex items-center gap-3">
          {provisioned
            ? <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            : <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />}
          <div>
            <p className={`text-sm font-medium ${provisioned ? 'text-emerald-300' : 'text-red-300'}`}>
              {provisioned
                ? t('OpenAI integration provisioned', 'تم توفير تكامل OpenAI')
                : t('OpenAI integration not provisioned', 'تكامل OpenAI غير مُهيَّأ')}
            </p>
            <p className={`text-xs mt-0.5 ${provisioned ? 'text-emerald-500' : 'text-red-500'}`}>
              {provisioned
                ? t('AI_INTEGRATIONS_OPENAI_BASE_URL and API_KEY are set. Requests are routed via Replit AI Integrations.', 'متغيرات AI_INTEGRATIONS_OPENAI_BASE_URL و API_KEY مُهيَّأة. يتم توجيه الطلبات عبر Replit AI Integrations.')
                : t('Environment variables are missing. Contact your system administrator.', 'متغيرات البيئة مفقودة. تواصل مع مسؤول النظام.')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            {t('AI Configuration', 'إعدادات الذكاء الاصطناعي')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={!!config.isEnabled} onCheckedChange={v => setF('isEnabled', v)} />
            <Label className="text-slate-300">{t('AI Enabled', 'تفعيل الذكاء الاصطناعي')}</Label>
          </div>
          <Separator className="bg-slate-700" />
          <div>
            <Label className="text-slate-300">{t('Model Name', 'اسم النموذج')}</Label>
            <Input
              className="bg-slate-700 border-slate-600 text-white mt-1"
              value={config.modelName ?? ''}
              onChange={e => setF('modelName', e.target.value)}
              placeholder="gpt-5.6-terra"
            />
            <p className="text-xs text-slate-500 mt-1">
              {t('Default: gpt-5.6-terra. Other options: gpt-5.6-sol (most powerful), gpt-5.6-luna (cost-efficient).', 'الافتراضي: gpt-5.6-terra. خيارات أخرى: gpt-5.6-sol (الأقوى)، gpt-5.6-luna (فعّال من حيث التكلفة).')}
            </p>
          </div>
          <div>
            <Label className="text-slate-300">{t('Max Completion Tokens', 'الحد الأقصى لرموز الإكمال')}</Label>
            <Input
              className="bg-slate-700 border-slate-600 text-white mt-1"
              type="number"
              value={config.maxTokens ?? ''}
              onChange={e => setF('maxTokens', Number(e.target.value))}
              placeholder="8192"
            />
          </div>
          {!isGpt5 && (
            <div>
              <Label className="text-slate-300">
                {t('Temperature', 'درجة الحرارة')} ({((config.temperatureX100 ?? 70) / 100).toFixed(1)})
              </Label>
              <input
                type="range" min="0" max="1" step="0.1"
                className="mt-2 w-full accent-amber-500"
                value={(config.temperatureX100 ?? 70) / 100}
                onChange={e => setF('temperatureX100', Math.round(parseFloat(e.target.value) * 100))}
              />
              <p className="text-xs text-slate-500 mt-1">
                {t('Not applicable for gpt-5.x models (always 1).', 'لا ينطبق على نماذج gpt-5.x (دائماً 1).')}
              </p>
            </div>
          )}
          {isGpt5 && (
            <div className="rounded bg-slate-700/50 px-3 py-2 text-xs text-slate-400">
              ℹ {t('Temperature is fixed at 1 for gpt-5.x models and cannot be configured.', 'درجة الحرارة ثابتة عند 1 لنماذج gpt-5.x ولا يمكن تغييرها.')}
            </div>
          )}
          <Separator className="bg-slate-700" />
          <div>
            <Label className="text-slate-300 mb-2 block">{t('Enabled Features', 'الميزات المفعّلة')}</Label>
            <div className="space-y-2">
              {FEATURE_KEYS.map(feat => (
                <div key={feat} className="flex items-center gap-3">
                  <Switch checked={features.includes(feat)} onCheckedChange={() => toggleFeature(feat)} />
                  <Label className="text-slate-300 capitalize">{feat.replace(/_/g, ' ')}</Label>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={!!config.auditAllQueries} onCheckedChange={v => setF('auditAllQueries', v)} />
            <Label className="text-slate-300">{t('Audit All Queries', 'تدقيق جميع الاستعلامات')}</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={!!config.requireApprovalForBulk} onCheckedChange={v => setF('requireApprovalForBulk', v)} />
            <Label className="text-slate-300">{t('Require Approval for Bulk Operations', 'طلب موافقة على العمليات الجماعية')}</Label>
          </div>
          <Button
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Save Configuration', 'حفظ الإعدادات')}
          </Button>
        </CardContent>
      </Card>

      {/* Query Audit Log */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-sm">{t('Query Audit Log', 'سجل تدقيق الاستعلامات')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Feature', 'الميزة')}</TableHead>
                <TableHead className="text-slate-400">{t('Query', 'الاستعلام')}</TableHead>
                <TableHead className="text-slate-400">{t('Model', 'النموذج')}</TableHead>
                <TableHead className="text-slate-400">{t('Tokens', 'الرموز')}</TableHead>
                <TableHead className="text-slate-400">{t('Duration', 'المدة')}</TableHead>
                <TableHead className="text-slate-400">{t('When', 'الوقت')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queriesLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-700">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : queries.length === 0
                  ? (
                    <TableRow className="border-slate-700">
                      <TableCell colSpan={7} className="text-center text-slate-500 py-6">
                        {t('No queries logged yet', 'لا توجد استعلامات مسجلة بعد')}
                      </TableCell>
                    </TableRow>
                  )
                  : queries.map((q, i) => (
                    <TableRow key={i} className="border-slate-700 hover:bg-slate-700/40">
                      <TableCell>
                        <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 capitalize">
                          {(q.featureType ?? '—').replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs max-w-[180px] truncate">
                        {q.queryText ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">{q.modelUsed ?? '—'}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{q.tokensUsed ?? '—'}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{q.durationMs != null ? `${q.durationMs}ms` : '—'}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{fmtDate(q.createdAt)}</TableCell>
                      <TableCell>
                        {q.wasSimulated
                          ? <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">sim</Badge>
                          : q.success
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs"><Zap className="w-3 h-3 me-0.5" />live</Badge>
                            : <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">fail</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LocalAi() {
  const { t } = useLanguage();
  const configQuery = useGetAiConfig();
  const aiConfig = configQuery.data as (AiConfig & { integrationProvisioned?: boolean }) | undefined;
  const configLoading = configQuery.isLoading;

  if (configLoading) {
    return (
      <AnimatedPage>
        <div className="min-h-screen bg-slate-900 text-white p-6">
          <Skeleton className="h-10 w-64 bg-slate-700 mb-4" />
          <Skeleton className="h-16 w-full bg-slate-700" />
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Brain className="w-8 h-8 text-sky-400" />
            {t('AI Assistant', 'مساعد الذكاء الاصطناعي')}
          </h1>
          <p className="text-slate-400 mt-1">
            {t(
              'AI-powered HR intelligence powered by OpenAI. All queries are audited.',
              'ذكاء اصطناعي متقدم للموارد البشرية مدعوم بـ OpenAI. يتم تدقيق جميع الاستعلامات.',
            )}
          </p>
        </div>

        <AiBanner config={aiConfig} />

        <Tabs defaultValue="policy-search">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="policy-search" className="data-[state=active]:bg-slate-700 text-slate-300">
              <Search className="w-4 h-4 me-2" />
              {t('Policy Search', 'بحث السياسات')}
            </TabsTrigger>
            <TabsTrigger value="report-query" className="data-[state=active]:bg-slate-700 text-slate-300">
              <BarChart2 className="w-4 h-4 me-2" />
              {t('Report Query', 'استعلام التقارير')}
            </TabsTrigger>
            <TabsTrigger value="classify" className="data-[state=active]:bg-slate-700 text-slate-300">
              <Tag className="w-4 h-4 me-2" />
              {t('Classify Document', 'تصنيف المستندات')}
            </TabsTrigger>
            <TabsTrigger value="config" className="data-[state=active]:bg-slate-700 text-slate-300">
              <Settings2 className="w-4 h-4 me-2" />
              {t('Configuration', 'الإعدادات')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policy-search" className="mt-4">
            <PolicySearchTab />
          </TabsContent>
          <TabsContent value="report-query" className="mt-4">
            <ReportQueryTab />
          </TabsContent>
          <TabsContent value="classify" className="mt-4">
            <ClassifyDocumentTab />
          </TabsContent>
          <TabsContent value="config" className="mt-4">
            <ConfigurationTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
