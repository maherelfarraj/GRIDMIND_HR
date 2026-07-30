import { useState, useEffect, useCallback } from 'react';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Cpu, Users, Mail, MessageSquare, Building2, FolderOpen, Plug,
  CheckCircle, XCircle, AlertTriangle, Circle, RefreshCw, Trash2,
  Network, ArrowUp, ArrowDown,
} from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function connectorIcon(type: string): React.ComponentType<{ className?: string }> {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    attendance_device: Cpu,
    active_directory: Users,
    ldap: Users,
    email_gateway: Mail,
    sms_gateway: MessageSquare,
    erp_finance: Building2,
    file_exchange: FolderOpen,
    custom: Plug,
  };
  return map[type] ?? Plug;
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    healthy: 'text-emerald-500',
    degraded: 'text-amber-500',
    error: 'text-red-500',
    unconfigured: 'text-slate-400',
    disabled: 'text-slate-500',
  };
  return <Circle className={`w-3 h-3 fill-current ${map[status] ?? 'text-slate-400'}`} />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    healthy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    degraded: 'bg-amber-100 text-amber-700 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
    unconfigured: 'bg-slate-100 text-slate-700 border-slate-200',
    disabled: 'bg-slate-200 text-slate-500 border-slate-300',
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    processing: 'bg-blue-100 text-blue-700 border-blue-200',
    completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    failed: 'bg-red-100 text-red-700 border-red-200',
    abandoned: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${map[status] ?? 'border-slate-300 text-slate-600'}`}>
      {status}
    </Badge>
  );
}

// ─── Configure Dialog ─────────────────────────────────────────────────────────

function ConfigureDialog({ open, connector, onClose, onSaved }: {
  open: boolean;
  connector: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [endpoint, setEndpoint] = useState(connector?.endpoint ?? '');
  const [port, setPort] = useState(String(connector?.port ?? ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEndpoint(connector?.endpoint ?? '');
    setPort(String(connector?.port ?? ''));
  }, [connector]);

  async function handleSave() {
    if (!connector) return;
    setSaving(true);
    try {
      await fetch(`/api/integration-connectors/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, port: port ? Number(port) : undefined }),
      });
      toast({ title: t('Saved', 'تم الحفظ') });
      onSaved();
      onClose();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Configure Connector', 'تكوين الموصل')}</DialogTitle>
          <DialogDescription>{connector?.name ?? ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>{t('Endpoint', 'نقطة النهاية')}</Label>
            <Input className="mt-1" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label>{t('Port', 'المنفذ')}</Label>
            <Input className="mt-1" type="number" value={port} onChange={e => setPort(e.target.value)} placeholder="443" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Save', 'حفظ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Connectors Tab ───────────────────────────────────────────────────────────

function ConnectorsTab({ connectors, loading, onRefresh }: {
  connectors: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [configConnector, setConfigConnector] = useState<any>(null);
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set());

  async function handleTest(id: number) {
    setTestingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/integration-connectors/${id}/test`, { method: 'POST' });
      const data = await res.json();
      const latency = data?.latencyMs ?? data?.latency ?? '?';
      const simulated = data?.simulated || data?.wasSimulated;
      toast({
        title: t('Connection test result', 'نتيجة اختبار الاتصال'),
        description: `${data?.success ? '✅' : '❌'} ${latency}ms${simulated ? ' ⚠ Simulated' : ''}`,
      });
    } catch {
      toast({ title: t('Test failed', 'فشل الاختبار'), variant: 'destructive' });
    } finally {
      setTestingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 me-1" />
          {t('Refresh', 'تحديث')}
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4 bg-slate-700" />
                <Skeleton className="h-4 w-1/2 bg-slate-700" />
                <Skeleton className="h-9 w-full bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : connectors.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Network className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{t('No connectors configured', 'لا توجد موصلات مكوّنة')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connectors.map((c: any) => {
            const Icon = connectorIcon(c.connectorType ?? '');
            return (
              <Card key={c.id} className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-700 rounded-lg flex items-center justify-center">
                      <Icon className="w-5 h-5 text-slate-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusDot status={c.status ?? 'unconfigured'} />
                        <span className="text-white font-medium text-sm truncate">{c.name ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 capitalize">
                          {c.protocol ?? c.connectorType ?? '—'}
                        </Badge>
                        {c.simulatedLabel && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
                            ⚠ {c.simulatedLabel}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <StatusBadge status={c.status ?? 'unconfigured'} />
                  {c.endpoint && (
                    <p className="text-xs text-slate-500 mt-1 truncate font-mono">{c.endpoint}</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 border-slate-600 text-slate-300 text-xs"
                      onClick={() => handleTest(c.id)}
                      disabled={testingIds.has(c.id)}
                    >
                      {testingIds.has(c.id) ? (
                        <RefreshCw className="w-3 h-3 me-1 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3 h-3 me-1" />
                      )}
                      {t('Test', 'اختبار')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="border-slate-600 text-slate-300 text-xs"
                      onClick={() => setConfigConnector(c)}
                    >
                      {t('Configure', 'تكوين')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfigureDialog
        open={!!configConnector}
        connector={configConnector}
        onClose={() => setConfigConnector(null)}
        onSaved={onRefresh}
      />
    </div>
  );
}

// ─── Health Monitor Tab ───────────────────────────────────────────────────────

function HealthMonitorTab({ connectors }: { connectors: any[] }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>('');
  const [health, setHealth] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingAll, setTestingAll] = useState(false);

  useEffect(() => {
    if (connectors.length > 0 && !selectedId) {
      setSelectedId(String(connectors[0].id));
    }
  }, [connectors, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetch(`/api/integration-connectors/${selectedId}/health`)
      .then(r => r.json())
      .then(d => setHealth(Array.isArray(d) ? d : d?.tests ?? d?.history ?? []))
      .catch(() => setHealth([]))
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function handleTestAll() {
    setTestingAll(true);
    let ok = 0;
    let fail = 0;
    await Promise.allSettled(
      connectors.map(c =>
        fetch(`/api/integration-connectors/${c.id}/test`, { method: 'POST' })
          .then(() => ok++)
          .catch(() => fail++)
      )
    );
    toast({ title: t('Test All complete', 'اكتمل اختبار الكل'), description: `✅ ${ok}  ❌ ${fail}` });
    setTestingAll(false);
  }

  const maxLatency = Math.max(...health.map((h: any) => h.latencyMs ?? 0), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-64 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('Select connector', 'اختر موصل')} />
          </SelectTrigger>
          <SelectContent>
            {connectors.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-300"
          onClick={handleTestAll}
          disabled={testingAll}
        >
          {testingAll ? <RefreshCw className="w-4 h-4 me-1 animate-spin" /> : <RefreshCw className="w-4 h-4 me-1" />}
          {t('Test All', 'اختبار الكل')}
        </Button>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-4 space-y-2">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full bg-slate-700" />)
          ) : health.length === 0 ? (
            <p className="text-center text-slate-500 py-8">{t('No health history', 'لا يوجد سجل صحة')}</p>
          ) : (
            health.map((h: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-700 last:border-0">
                {h.success ? (
                  <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300 text-xs">{fmtDate(h.testedAt ?? h.timestamp)}</span>
                    {h.errorMessage && (
                      <span className="text-red-400 text-xs truncate">{h.errorMessage}</span>
                    )}
                  </div>
                  {h.latencyMs != null && (
                    <div className="mt-1 h-2 bg-slate-700 rounded-full overflow-hidden w-48">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${Math.min(100, (h.latencyMs / maxLatency) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                {h.latencyMs != null && (
                  <span className="text-slate-400 text-xs shrink-0">{h.latencyMs}ms</span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Retry Queue Tab ──────────────────────────────────────────────────────────

function RetryQueueTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  function loadItems() {
    setLoading(true);
    fetch('/api/integration-retry-queue')
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadItems(); }, []);

  async function handleRetry(id: number) {
    try {
      await fetch(`/api/integration-retry-queue/${id}/retry`, { method: 'POST' });
      toast({ title: t('Retry queued', 'تمت إعادة المحاولة') });
      loadItems();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  async function handleAbandon(id: number) {
    try {
      await fetch(`/api/integration-retry-queue/${id}`, { method: 'DELETE' });
      toast({ title: t('Abandoned', 'تم التخلي') });
      loadItems();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  async function handleClearAbandoned() {
    try {
      await fetch('/api/integration-retry-queue/clear-abandoned', { method: 'POST' });
      toast({ title: t('Cleared abandoned items', 'تم مسح العناصر المتروكة') });
      loadItems();
    } catch {
      toast({ title: t('Error', 'خطأ'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={handleClearAbandoned}>
          <Trash2 className="w-4 h-4 me-1" />
          {t('Clear Abandoned', 'مسح المتروكة')}
        </Button>
        <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={loadItems}>
          <RefreshCw className="w-4 h-4 me-1" />
          {t('Refresh', 'تحديث')}
        </Button>
      </div>
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Connector', 'الموصل')}</TableHead>
                <TableHead className="text-slate-400">{t('Operation', 'العملية')}</TableHead>
                <TableHead className="text-slate-400">{t('Attempts', 'المحاولات')}</TableHead>
                <TableHead className="text-slate-400">{t('Next Retry', 'إعادة المحاولة')}</TableHead>
                <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-700">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : items.length === 0
                  ? (
                    <TableRow className="border-slate-700">
                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                        {t('Retry queue is empty', 'قائمة إعادة المحاولة فارغة')}
                      </TableCell>
                    </TableRow>
                  )
                  : items.map((item: any) => (
                    <TableRow key={item.id} className="border-slate-700 hover:bg-slate-700/40">
                      <TableCell className="text-white">{item.connectorName ?? item.connector ?? '—'}</TableCell>
                      <TableCell className="text-slate-300 text-sm">{item.operation ?? '—'}</TableCell>
                      <TableCell className="text-slate-300">{item.attempts ?? 0}</TableCell>
                      <TableCell className="text-slate-300 text-sm">{fmtDate(item.nextRetryAt)}</TableCell>
                      <TableCell><StatusBadge status={item.status ?? 'pending'} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="text-amber-400 h-7 px-2" onClick={() => handleRetry(item.id)}>
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-400 h-7 px-2" onClick={() => handleAbandon(item.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
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

// ─── Event Log Tab ────────────────────────────────────────────────────────────

function EventLogTab({ connectors }: { connectors: any[] }) {
  const { t } = useLanguage();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectorFilter, setConnectorFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const loadEvents = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (connectorFilter !== 'all') params.set('connectorId', connectorFilter);
    if (typeFilter !== 'all') params.set('eventType', typeFilter);
    fetch(`/api/integration-events?${params}`)
      .then(r => r.json())
      .then(d => setEvents(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [connectorFilter, typeFilter]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const eventTypes = [...new Set(events.map((e: any) => e.eventType).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={connectorFilter} onValueChange={setConnectorFilter}>
          <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('All Connectors', 'كل الموصلات')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Connectors', 'كل الموصلات')}</SelectItem>
            {connectors.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('All Types', 'كل الأنواع')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Types', 'كل الأنواع')}</SelectItem>
            {eventTypes.map(tp => (
              <SelectItem key={tp} value={tp} className="capitalize">{tp}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Timestamp', 'الوقت')}</TableHead>
                <TableHead className="text-slate-400">{t('Connector', 'الموصل')}</TableHead>
                <TableHead className="text-slate-400">{t('Event Type', 'نوع الحدث')}</TableHead>
                <TableHead className="text-slate-400">{t('Dir', 'الاتجاه')}</TableHead>
                <TableHead className="text-slate-400">{t('Success', 'نجاح')}</TableHead>
                <TableHead className="text-slate-400">{t('Message', 'الرسالة')}</TableHead>
                <TableHead className="text-slate-400">{t('Duration', 'المدة')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-700">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : events.length === 0
                  ? (
                    <TableRow className="border-slate-700">
                      <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                        {t('No events found', 'لا توجد أحداث')}
                      </TableCell>
                    </TableRow>
                  )
                  : events.map((ev: any, i: number) => (
                    <TableRow key={i} className="border-slate-700 hover:bg-slate-700/40">
                      <TableCell className="text-slate-300 text-xs">{fmtDate(ev.timestamp ?? ev.createdAt)}</TableCell>
                      <TableCell className="text-white text-sm">{ev.connectorName ?? '—'}</TableCell>
                      <TableCell className="text-slate-300 text-sm capitalize">{ev.eventType ?? '—'}</TableCell>
                      <TableCell>
                        {ev.direction === 'inbound' || ev.direction === 'in'
                          ? <ArrowDown className="w-4 h-4 text-sky-400" />
                          : <ArrowUp className="w-4 h-4 text-amber-400" />}
                      </TableCell>
                      <TableCell>
                        {ev.success
                          ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                          : <XCircle className="w-4 h-4 text-red-500" />}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs max-w-[200px] truncate">{ev.message ?? '—'}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{ev.durationMs != null ? `${ev.durationMs}ms` : '—'}</TableCell>
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

export default function IntegrationCenter() {
  const { t } = useLanguage();
  const [connectors, setConnectors] = useState<any[]>([]);
  const [connLoading, setConnLoading] = useState(true);

  function loadConnectors() {
    setConnLoading(true);
    fetch('/api/integration-connectors')
      .then(r => r.json())
      .then(d => setConnectors(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => setConnectors([]))
      .finally(() => setConnLoading(false));
  }

  useEffect(() => { loadConnectors(); }, []);

  return (
    <AnimatedPage>
      <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t('Integration Center', 'مركز التكامل')}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {t('Manage connectors, monitor health, and track events', 'إدارة الموصلات ومراقبة الصحة وتتبع الأحداث')}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 text-amber-400 px-3 py-2 rounded-lg text-sm mb-4"><AlertTriangle className="w-4 h-4 shrink-0" />{t("OIDC/SAML connection tests are not implemented; connection test results are simulated. LDAP/SMTP/device adapters are real.", "اختبارات اتصال OIDC/SAML غير مُطبَّقة؛ نتائج الاختبار محاكاة. محولات LDAP/SMTP/الأجهزة حقيقية.")}</div>

        <Tabs defaultValue="connectors">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="connectors" className="data-[state=active]:bg-slate-700">
              {t('Connectors', 'الموصلات')}
            </TabsTrigger>
            <TabsTrigger value="health" className="data-[state=active]:bg-slate-700">
              {t('Health Monitor', 'مراقبة الصحة')}
            </TabsTrigger>
            <TabsTrigger value="retry" className="data-[state=active]:bg-slate-700">
              {t('Retry Queue', 'قائمة إعادة المحاولة')}
            </TabsTrigger>
            <TabsTrigger value="events" className="data-[state=active]:bg-slate-700">
              {t('Event Log', 'سجل الأحداث')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connectors" className="mt-4">
            <ConnectorsTab connectors={connectors} loading={connLoading} onRefresh={loadConnectors} />
          </TabsContent>

          <TabsContent value="health" className="mt-4">
            <HealthMonitorTab connectors={connectors} />
          </TabsContent>

          <TabsContent value="retry" className="mt-4">
            <RetryQueueTab />
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <EventLogTab connectors={connectors} />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
