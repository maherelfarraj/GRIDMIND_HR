import { apiFetch } from '@/lib/api';
import { useState, useEffect } from 'react';
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
  Brain, Search, AlertTriangle, CheckCircle, ShieldOff,
  FileText, BarChart2, Tag, Settings2,
} from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function SimBadge() {
  return (
    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs ms-2">
      ⚠ Simulated
    </Badge>
  );
}

function RelevanceBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#1e3a5f] rounded-full"
          style={{ width: `${pct}%` }}
        />
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

// ─── AI Banner ────────────────────────────────────────────────────────────────

function AiBanner({ config }: { config: any }) {
  const { t } = useLanguage();
  const isConnected = config?.modelEndpoint && config?.isEnabled;
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
      isConnected
        ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
        : 'bg-amber-950 border-amber-700 text-amber-300'
    }`}>
      <ShieldOff className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {t(
          'All AI features use customer-hosted models only. No data is sent to external cloud services.',
          'جميع ميزات الذكاء الاصطناعي تستخدم النماذج المستضافة من قبل العميل فقط. لا يتم إرسال أي بيانات إلى خدمات سحابية خارجية.',
        )}
      </span>
      <Badge className={isConnected
        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
        : 'bg-amber-100 text-amber-800 border-amber-300'
      }>
        {isConnected
          ? `✅ ${t('Connected to:', 'متصل بـ:')} ${config?.modelName ?? '—'}`
          : `⚠ ${t('Simulated Mode', 'وضع المحاكاة')}`}
      </Badge>
    </div>
  );
}

// ─── Policy Search Tab ────────────────────────────────────────────────────────

function PolicySearchTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [wasSimulated, setWasSimulated] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setResults([]);
    try {
      const res = await apiFetch('/api/ai/policy-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : data?.results ?? []);
      setWasSimulated(data?.wasSimulated ?? true);
    } catch {
      toast({ title: t('Search failed', 'فشل البحث'), variant: 'destructive' });
    } finally {
      setLoading(false);
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
          {wasSimulated && results.length > 0 && <SimBadge />}
        </Button>
      </div>

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

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map((r: any, i: number) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-white font-medium text-sm">{r.documentTitle ?? r.title ?? '—'}</span>
                  </div>
                  {r.documentName && (
                    <a href="#" className="text-xs text-sky-400 hover:underline shrink-0">
                      {t('Open Document', 'فتح المستند')}
                    </a>
                  )}
                </div>
                <p className="text-slate-300 text-sm mb-2"
                  dangerouslySetInnerHTML={{ __html: r.excerpt ?? r.snippet ?? '' }}
                />
                <RelevanceBar score={r.relevanceScore ?? r.score ?? 0.5} />
                {(r.documentName || r.page) && (
                  <p className="text-xs text-slate-500 mt-1">
                    {r.documentName}{r.page ? ` — ${t('Page', 'صفحة')} ${r.page}` : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && query && (
        <p className="text-center text-slate-500 py-8">{t('No results found', 'لم يتم العثور على نتائج')}</p>
      )}
    </div>
  );
}

// ─── Report Query Tab ─────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  { en: 'How many employees joined last month?', ar: 'كم عدد الموظفين الذين انضموا الشهر الماضي؟' },
  { en: 'Show attendance rate by department', ar: 'عرض معدل الحضور حسب الإدارة' },
  { en: 'Who has the most overtime hours?', ar: 'من لديه أكثر ساعات إضافية؟' },
];

function ReportQueryTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apiFetch('/api/ai/report-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      toast({ title: t('Query failed', 'فشل الاستعلام'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  const previewRows: any[] = result?.previewData ?? result?.rows ?? [];
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
        <Button
          className="mt-2 bg-[#1e3a5f] hover:bg-[#1e3a5f]/80 text-white"
          onClick={handleAsk}
          disabled={loading || !question.trim()}
        >
          <Brain className="w-4 h-4 me-1" />
          {t('Ask', 'اسأل')}
          <SimBadge />
        </Button>
      </div>

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
              <CardTitle className="text-white text-sm">{t('Interpretation', 'التفسير')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-300 text-sm">{result.interpretation ?? result.message ?? '—'}</p>
              {result.suggestedReportName && (
                <p className="text-xs text-amber-400 mt-2">
                  {t('Suggested report:', 'التقرير المقترح:')} <span className="font-medium">{result.suggestedReportName}</span>
                </p>
              )}
            </CardContent>
          </Card>

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
                      {previewRows.slice(0, 5).map((row: any, i: number) => (
                        <TableRow key={i} className="border-slate-700">
                          {cols.map(c => (
                            <TableCell key={c} className="text-slate-300 text-xs">{String(row[c] ?? '—')}</TableCell>
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
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handleClassify() {
    if (!title.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apiFetch('/api/ai/classify-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: content || undefined, documentId: documentId || undefined }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      toast({ title: t('Classification failed', 'فشل التصنيف'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!result || !documentId) return;
    try {
      await apiFetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: result.category }),
      });
      toast({ title: t('Category applied', 'تم تطبيق الفئة') });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <Label className="text-slate-300">{t('Document Title', 'عنوان المستند')}</Label>
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
      <Button
        className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/80 text-white"
        onClick={handleClassify}
        disabled={loading || !title.trim()}
      >
        <Tag className="w-4 h-4 me-1" />
        {t('Classify', 'تصنيف')}
        <SimBadge />
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
              <Badge className="bg-[#1e3a5f] text-white capitalize">{result.category ?? '—'}</Badge>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">{t('Confidence', 'مستوى الثقة')}</p>
              <ConfidenceBar score={result.confidence ?? result.score ?? 0.5} />
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
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queries, setQueries] = useState<any[]>([]);
  const [queriesLoading, setQueriesLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/ai/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => setConfig({}))
      .finally(() => setLoading(false));

    apiFetch('/api/ai/queries')
      .then(r => r.json())
      .then(d => setQueries(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => setQueries([]))
      .finally(() => setQueriesLoading(false));
  }, []);

  function setF(k: string, v: unknown) {
    setConfig((p: any) => ({ ...p, [k]: v }));
  }

  function toggleFeature(feat: string) {
    const current: string[] = config?.enabledFeatures ?? [];
    const updated = current.includes(feat)
      ? current.filter(f => f !== feat)
      : [...current, feat];
    setF('enabledFeatures', updated);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch('/api/ai/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      toast({ title: t('Configuration saved', 'تم حفظ الإعدادات') });
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-64 w-full bg-slate-700" />;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            {t('AI Configuration', 'إعدادات الذكاء الاصطناعي')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={!!config?.isEnabled}
              onCheckedChange={v => setF('isEnabled', v)}
            />
            <Label className="text-slate-300">{t('AI Enabled', 'تفعيل الذكاء الاصطناعي')}</Label>
          </div>
          <Separator className="bg-slate-700" />
          <div>
            <Label className="text-slate-300">{t('Model Endpoint', 'نقطة نهاية النموذج')}</Label>
            <Input
              className="bg-slate-700 border-slate-600 text-white mt-1"
              value={config?.modelEndpoint ?? ''}
              onChange={e => setF('modelEndpoint', e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
          <div>
            <Label className="text-slate-300">{t('Model Name', 'اسم النموذج')}</Label>
            <Input
              className="bg-slate-700 border-slate-600 text-white mt-1"
              value={config?.modelName ?? ''}
              onChange={e => setF('modelName', e.target.value)}
              placeholder="llama3"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-300">{t('Max Tokens', 'أقصى عدد رموز')}</Label>
              <Input
                className="bg-slate-700 border-slate-600 text-white mt-1"
                type="number"
                value={config?.maxTokens ?? ''}
                onChange={e => setF('maxTokens', Number(e.target.value))}
                placeholder="2048"
              />
            </div>
            <div>
              <Label className="text-slate-300">
                {t('Temperature', 'درجة الحرارة')} ({(config?.temperature ?? 0.7).toFixed(1)})
              </Label>
              <input
                type="range"
                min="0" max="1" step="0.1"
                className="mt-2 w-full accent-amber-500"
                value={config?.temperature ?? 0.7}
                onChange={e => setF('temperature', parseFloat(e.target.value))}
              />
            </div>
          </div>
          <div>
            <Label className="text-slate-300 mb-2 block">{t('Enabled Features', 'الميزات المفعّلة')}</Label>
            <div className="space-y-2">
              {FEATURE_KEYS.map(feat => (
                <div key={feat} className="flex items-center gap-3">
                  <Switch
                    checked={(config?.enabledFeatures ?? []).includes(feat)}
                    onCheckedChange={() => toggleFeature(feat)}
                  />
                  <Label className="text-slate-300 capitalize">{feat.replace(/_/g, ' ')}</Label>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={!!config?.auditAllQueries}
              onCheckedChange={v => setF('auditAllQueries', v)}
            />
            <Label className="text-slate-300">{t('Audit All Queries', 'تدقيق جميع الاستعلامات')}</Label>
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
                <TableHead className="text-slate-400">{t('Duration', 'المدة')}</TableHead>
                <TableHead className="text-slate-400">{t('When', 'الوقت')}</TableHead>
                <TableHead className="text-slate-400">{t('Sim', 'محاكاة')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queriesLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-700">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : queries.length === 0
                  ? (
                    <TableRow className="border-slate-700">
                      <TableCell colSpan={6} className="text-center text-slate-500 py-6">
                        {t('No queries logged', 'لا توجد استعلامات مسجلة')}
                      </TableCell>
                    </TableRow>
                  )
                  : queries.map((q: any, i: number) => (
                    <TableRow key={i} className="border-slate-700 hover:bg-slate-700/40">
                      <TableCell>
                        <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 capitalize">
                          {(q.featureType ?? q.feature ?? '—').replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs max-w-[200px] truncate">
                        {q.query ?? q.queryText ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">{q.modelUsed ?? q.model ?? '—'}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{q.durationMs != null ? `${q.durationMs}ms` : '—'}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{fmtDate(q.createdAt ?? q.timestamp)}</TableCell>
                      <TableCell>
                        {(q.wasSimulated || q.simulated) && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">⚠</Badge>}
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
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/ai/config')
      .then(r => r.json())
      .then(setAiConfig)
      .catch(() => setAiConfig(null))
      .finally(() => setConfigLoading(false));
  }, []);

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

  if (aiConfig?.isEnabled === false) {
    return (
      <AnimatedPage>
        <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center gap-6">
          <div className="text-center">
            <ShieldOff className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">
              {t('Local AI is Disabled', 'الذكاء الاصطناعي المحلي معطّل')}
            </h2>
            <p className="text-slate-400 max-w-md">
              {t(
                'Enable AI in the Configuration tab, then configure the model endpoint and name.',
                'فعّل الذكاء الاصطناعي في تبويب الإعدادات، ثم قم بتكوين نقطة نهاية النموذج واسمه.',
              )}
            </p>
          </div>
          <AlertTriangle className="text-amber-500 w-8 h-8" />
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="w-6 h-6 text-amber-400" />
            {t('Local AI Assistant', 'مساعد الذكاء الاصطناعي المحلي')}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {t('On-premise AI — no external data sharing', 'ذكاء اصطناعي محلي — لا مشاركة بيانات خارجية')}
          </p>
        </div>

        <AiBanner config={aiConfig} />

        <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 text-amber-400 px-3 py-2 rounded-lg text-sm mb-4"><AlertTriangle className="w-4 h-4 shrink-0" />{t("AI analysis is not implemented; responses are illustrative placeholders and do not reflect real inference.", "تحليل الذكاء الاصطناعي غير مُطبَّق؛ الاستجابات نماذج توضيحية ولا تعكس استنتاجًا فعليًا.")}</div>

        <Tabs defaultValue="policy-search">
          <TabsList className="bg-slate-800 border border-slate-700 flex-wrap h-auto">
            <TabsTrigger value="policy-search" className="data-[state=active]:bg-slate-700">
              <Search className="w-3 h-3 me-1" />
              {t('Policy Search', 'بحث السياسات')}
            </TabsTrigger>
            <TabsTrigger value="report-query" className="data-[state=active]:bg-slate-700">
              <BarChart2 className="w-3 h-3 me-1" />
              {t('Report Query', 'استعلام التقرير')}
            </TabsTrigger>
            <TabsTrigger value="classify" className="data-[state=active]:bg-slate-700">
              <Tag className="w-3 h-3 me-1" />
              {t('Document Classification', 'تصنيف المستندات')}
            </TabsTrigger>
            <TabsTrigger value="config" className="data-[state=active]:bg-slate-700">
              <Settings2 className="w-3 h-3 me-1" />
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
