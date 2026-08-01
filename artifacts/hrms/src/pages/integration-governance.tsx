import { apiFetch } from '@/lib/api';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, AlertTriangle, Network, Shield, Mail, MessageSquare, HardDrive, Database, FileSignature, Code2, RefreshCw, CheckCircle, XCircle, Clock, Loader2, User, Activity, HeartPulse, Settings2, Bot } from 'lucide-react';

function intTypeIcon(type: string): React.ComponentType<{ className?: string }> {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    ldap: Network, active_directory: Network, sso: Shield, oauth: Shield,
    smtp: Mail, sms: MessageSquare, attendance_device: HardDrive,
    finance_api: Database, document_signing: FileSignature, internal_api: Code2,
  };
  return map[type] ?? Network;
}

function envBadge(env: string) {
  if (env === 'production') return 'bg-red-900/40 text-red-300 border-red-700';
  if (env === 'staging') return 'bg-amber-900/40 text-amber-300 border-amber-700';
  if (env === 'development') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function statusBadge(status: string) {
  if (status === 'active') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
  if (status === 'error') return 'bg-red-900/40 text-red-300 border-red-700';
  if (status === 'pending_approval') return 'bg-amber-900/40 text-amber-300 border-amber-700';
  return 'bg-slate-700 text-slate-400 border-slate-600';
}

function permBadge(level: string) {
  if (level === 'required') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  if (level === 'allowed') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
  if (level === 'prohibited') return 'bg-red-900/40 text-red-300 border-red-700';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function outcomeBadge(outcome: string) {
  if (outcome === 'success') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
  if (outcome === 'failure' || outcome === 'error') return 'bg-red-900/40 text-red-300 border-red-700';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function AddProfileDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ profileName: '', integrationType: '', environment: 'development', baseUrl: '', description: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        profileName: form.profileName,
        profileNameAr: form.profileName,
        integrationType: form.integrationType,
        environment: form.environment,
        connectionParamsJson: JSON.stringify({ baseUrl: form.baseUrl, description: form.description }),
      };
      const res = await apiFetch('/api/integration-governance/connection-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      toast({ title: t('Profile created', 'تم إنشاء الملف الشخصي') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
        <DialogHeader><DialogTitle>{t('Add Connection Profile', 'إضافة ملف اتصال')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Profile Name', 'اسم الملف')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.profileName} onChange={e => set('profileName', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Integration Type', 'نوع التكامل')}</Label>
              <Select value={form.integrationType} onValueChange={v => set('integrationType', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue placeholder={t('Select', 'اختر')} /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['ldap','active_directory','sso','smtp','sms','attendance_device','finance_api','document_signing','internal_api'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('Environment', 'البيئة')}</Label>
              <Select value={form.environment} onValueChange={v => set('environment', v)}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {['development','staging','production'].map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>{t('Base URL', 'الرابط الأساسي')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} placeholder="https://..." /></div>
          <div><Label>{t('Description', 'الوصف')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.description} onChange={e => set('description', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Integration types backed by real connection adapters on the server
// (LDAP bind, SMTP test message, device health endpoint). All other types
// still return simulated test results.
const REAL_ADAPTER_TYPES = new Set(['ldap', 'active_directory', 'smtp', 'attendance_device']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) { return EMAIL_RE.test(v.trim()); }

function HealthSettingsDialog({ profile, onClose, onSaved }: { profile: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(!!profile?.isHealthMonitoringEnabled);
  const [interval, setIntervalMin] = useState<string>(String(profile?.healthCheckIntervalMinutes ?? 15));
  const [threshold, setThreshold] = useState<string>(String(profile?.alertOnFailureCount ?? 3));
  const intervalNum = parseInt(interval, 10);
  const thresholdNum = parseInt(threshold, 10);
  const intervalValid = Number.isInteger(intervalNum) && intervalNum >= 1 && intervalNum <= 1440;
  const thresholdValid = Number.isInteger(thresholdNum) && thresholdNum >= 1 && thresholdNum <= 100;
  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/integration-governance/connection-profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHealthMonitoringEnabled: enabled, healthCheckIntervalMinutes: intervalNum, alertOnFailureCount: thresholdNum }),
      });
      if (!res.ok) throw new Error();
      toast({ title: t('Health monitoring settings saved', 'تم حفظ إعدادات مراقبة الصحة') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={!!profile} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HeartPulse className="w-5 h-5 text-emerald-400" />{t('Health Monitoring', 'مراقبة الصحة')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-400">{profile?.profileName}</p>
          <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-700/30 p-3">
            <div>
              <p className="text-sm text-white font-medium">{t('Automatic health checks', 'فحوصات الصحة التلقائية')}</p>
              <p className="text-xs text-slate-400">{t('Periodically test this connection and alert admins on repeated failures', 'اختبار هذا الاتصال دورياً وتنبيه المسؤولين عند تكرار الفشل')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('Check interval (minutes)', 'الفاصل الزمني (دقائق)')}</Label>
              <Input type="number" min={1} max={1440} className="mt-1 bg-slate-700 border-slate-600" value={interval} onChange={e => setIntervalMin(e.target.value)} disabled={!enabled} />
              {!intervalValid && <p className="text-xs text-amber-400 mt-1">{t('Enter 1–1440', 'أدخل 1–1440')}</p>}
            </div>
            <div>
              <Label>{t('Alert after failures', 'تنبيه بعد عدد الإخفاقات')}</Label>
              <Input type="number" min={1} max={100} className="mt-1 bg-slate-700 border-slate-600" value={threshold} onChange={e => setThreshold(e.target.value)} disabled={!enabled} />
              {!thresholdValid && <p className="text-xs text-amber-400 mt-1">{t('Enter 1–100', 'أدخل 1–100')}</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving || !intervalValid || !thresholdValid} className="bg-blue-600 hover:bg-blue-700">{saving ? t('Saving…', 'جاري الحفظ…') : t('Save', 'حفظ')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileDetailDialog({ profileId, onClose }: { profileId: number | null; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (profileId == null) { setDetail(null); setError(false); return; }
    let cancelled = false;
    setLoading(true); setError(false); setDetail(null);
    apiFetch(`/api/integration-governance/connection-profiles/${profileId}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profileId]);
  const testerName = detail ? (lang === 'ar' ? (detail.lastTestedByNameAr || detail.lastTestedByNameEn) : (detail.lastTestedByNameEn || detail.lastTestedByNameAr)) : null;
  return (
    <Dialog open={profileId != null} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Network className="w-5 h-5 text-blue-400" />{t('Connection Details', 'تفاصيل الاتصال')}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2 py-2"><Skeleton className="h-5 bg-slate-700" /><Skeleton className="h-5 bg-slate-700" /><Skeleton className="h-5 bg-slate-700" /></div>
        ) : error ? (
          <p className="text-sm text-red-300 py-2">{t('Could not load connection details.', 'تعذر تحميل تفاصيل الاتصال.')}</p>
        ) : detail ? (
          <div className="space-y-3 py-1 text-sm">
            <div>
              <p className="text-white font-medium">{detail.profileName}</p>
              <p className="text-xs text-slate-400">{detail.integrationType}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-xs ${envBadge(detail.environment)}`}>{detail.environment}</Badge>
              <Badge variant="outline" className={`text-xs ${statusBadge(detail.status)}`}>{detail.status}</Badge>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-700/30 p-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-300">{t('Last connection test', 'آخر اختبار اتصال')}</p>
              {detail.lastTestResult ? (
                <>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {detail.lastTestResult === 'success'
                      ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <span className={`text-xs font-medium ${detail.lastTestResult === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {detail.lastTestResult === 'success' ? t('Test passed', 'نجح الاختبار') : t('Test failed', 'فشل الاختبار')}
                    </span>
                    {typeof detail.lastTestLatencyMs === 'number' && <span className="text-xs text-slate-400">{detail.lastTestLatencyMs}ms</span>}
                  </div>
                  {detail.lastTestedAt && (
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 shrink-0" />
                      {new Date(detail.lastTestedAt).toLocaleString()}
                    </p>
                  )}
                  {testerName ? (
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <User className="w-3 h-3 shrink-0" />
                      {t('Tested by', 'اختبرها')} {testerName}
                    </p>
                  ) : detail.lastTestedAt ? (
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <Bot className="w-3 h-3 shrink-0" />
                      {t('Automated health check', 'فحص صحة تلقائي')}
                    </p>
                  ) : null}
                  {detail.lastTestMessage && <p className="text-xs text-slate-400 break-words">{detail.lastTestMessage}</p>}
                </>
              ) : (
                <p className="text-xs text-slate-500">{t('Never tested', 'لم يُختبر بعد')}</p>
              )}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Close', 'إغلاق')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function IntegrationGovernance() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [vault, setVault] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set());
  const [suspendTarget, setSuspendTarget] = useState<any>(null);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const [smtpTestTarget, setSmtpTestTarget] = useState<any>(null);
  const [smtpRecipient, setSmtpRecipient] = useState('');
  const [healthTarget, setHealthTarget] = useState<any>(null);
  const [runningHealthChecks, setRunningHealthChecks] = useState(false);
  const [detailProfileId, setDetailProfileId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, v, r, a] = await Promise.allSettled([
        apiFetch('/api/integration-governance/connection-profiles').then(r => r.json()),
        apiFetch('/api/integration-governance/credential-vault-refs').then(r => r.json()),
        apiFetch('/api/integration-governance/governance-rules').then(r => r.json()),
        apiFetch('/api/integration-governance/audit-log').then(r => r.json()),
      ]);
      setProfiles(p.status === 'fulfilled' && Array.isArray(p.value) ? p.value : []);
      setVault(v.status === 'fulfilled' && Array.isArray(v.value) ? v.value : []);
      setRules(r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
      setAuditLog(a.status === 'fulfilled' && Array.isArray(a.value?.data) ? a.value.data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function testConnection(id: number, testRecipient?: string) {
    setTestingIds(prev => new Set(prev).add(id));
    try {
      const res = await apiFetch(`/api/integration-governance/connection-profiles/${id}/test`, {
        method: 'POST',
        ...(testRecipient ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testRecipient }) } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.success !== 'boolean') {
        toast({
          title: t('Test failed', 'فشل الاختبار'),
          description: data?.error || data?.message || t(`Server returned an unexpected response (HTTP ${res.status})`, `أعاد الخادم استجابة غير متوقعة (HTTP ${res.status})`),
          variant: 'destructive',
        });
        return;
      }
      const simulatedNote = data.simulated ? ` · ${t('⚠ Simulated', '⚠ محاكاة')}` : '';
      toast({
        title: data.success ? t('Test succeeded', 'نجح الاختبار') : t('Test failed', 'فشل الاختبار'),
        description: `${data.success ? '✅' : '❌'} ${data.latencyMs ?? '?'}ms — ${data.message ?? ''}${simulatedNote}`,
        ...(data.success ? {} : { variant: 'destructive' as const }),
      });
      load();
    } catch {
      toast({
        title: t('Test failed', 'فشل الاختبار'),
        description: t('Could not reach the server to run the test. Check your connection and try again.', 'تعذر الوصول إلى الخادم لإجراء الاختبار. تحقق من اتصالك وحاول مرة أخرى.'),
        variant: 'destructive',
      });
    }
    finally { setTestingIds(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  }

  async function approveProfile(id: number) {
    try {
      await apiFetch(`/api/integration-governance/connection-profiles/${id}/approve`, { method: 'POST' });
      toast({ title: t('Approved', 'تمت الموافقة') });
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function suspendProfile() {
    if (!suspendTarget) return;
    try {
      await apiFetch(`/api/integration-governance/connection-profiles/${suspendTarget.id}/suspend`, { method: 'POST' });
      toast({ title: t('Suspended', 'تم التعليق') });
      setSuspendTarget(null);
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function runHealthChecksNow() {
    setRunningHealthChecks(true);
    try {
      const res = await apiFetch('/api/integration-governance/health-checks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.checked !== 'number') {
        toast({ title: t('Health checks failed', 'فشلت فحوصات الصحة'), description: data?.error, variant: 'destructive' });
        return;
      }
      toast({
        title: t('Health checks complete', 'اكتملت فحوصات الصحة'),
        description: t(
          `Checked ${data.checked} · Passed ${data.passed} · Failed ${data.failed} · Alerts ${data.alertsRaised}`,
          `تم الفحص ${data.checked} · نجح ${data.passed} · فشل ${data.failed} · تنبيهات ${data.alertsRaised}`,
        ),
        ...(data.failed > 0 ? { variant: 'destructive' as const } : {}),
      });
      load();
    } catch {
      toast({ title: t('Health checks failed', 'فشلت فحوصات الصحة'), description: t('Could not reach the server.', 'تعذر الوصول إلى الخادم.'), variant: 'destructive' });
    } finally { setRunningHealthChecks(false); }
  }

  const healthAlerts = auditLog.filter(a => a.eventType === 'health_alert').slice(0, 5);

  async function toggleRule(id: number, active: boolean) {
    try {
      await apiFetch(`/api/integration-governance/governance-rules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: active }) });
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Integration Governance', 'حوكمة التكامل')}</h1>
            <p className="text-slate-400 text-sm">{t('Connection profiles, credential vault, rules, and audit log', 'ملفات الاتصال وخزنة بيانات الاعتماد والقواعد وسجل التدقيق')}</p>
          </div>
        </div>

        <Tabs defaultValue="profiles">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="profiles" className="data-[state=active]:bg-slate-700">{t('Connection Profiles', 'ملفات الاتصال')}</TabsTrigger>
            <TabsTrigger value="vault" className="data-[state=active]:bg-slate-700">{t('Credential Vault', 'خزنة الاعتماد')}</TabsTrigger>
            <TabsTrigger value="rules" className="data-[state=active]:bg-slate-700">{t('Governance Rules', 'قواعد الحوكمة')}</TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-slate-700">{t('Audit Log', 'سجل التدقيق')}</TabsTrigger>
          </TabsList>

          {/* Connection Profiles */}
          <TabsContent value="profiles" className="mt-4 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={load}><RefreshCw className="w-4 h-4 me-1" />{t('Refresh', 'تحديث')}</Button>
                <Button variant="outline" size="sm" className="border-slate-600 text-emerald-300 hover:text-emerald-200" onClick={runHealthChecksNow} disabled={runningHealthChecks}>
                  {runningHealthChecks ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Activity className="w-4 h-4 me-1" />}
                  {t('Run health checks now', 'تشغيل فحوصات الصحة الآن')}
                </Button>
              </div>
              <Button onClick={() => setAddProfileOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2"><span>+</span>{t('Add Profile', 'إضافة ملف')}</Button>
            </div>
            {!loading && healthAlerts.length > 0 && (
              <Card className="bg-slate-800 border-red-800/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{t('Recent health alerts', 'تنبيهات الصحة الأخيرة')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1.5">
                  {healthAlerts.map(a => {
                    const prof = profiles.find(p => p.id === a.profileId);
                    return (
                      <div key={a.id} className="flex items-start gap-2 text-xs">
                        <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                        <span className="text-slate-300">
                          <span className="text-white font-medium">{prof?.profileName ?? `#${a.profileId}`}</span>
                          {' — '}{a.message ?? t('Health alert', 'تنبيه صحي')}
                          {a.occurredAt && <span className="text-slate-500"> · {timeAgo(a.occurredAt)}</span>}
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 bg-slate-700 rounded-lg" />)}</div>
            ) : profiles.length === 0 ? (
              <Card className="bg-slate-800 border-slate-700"><CardContent className="p-8 text-center text-slate-400">{t('No connection profiles', 'لا توجد ملفات اتصال')}</CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {profiles.map(p => {
                  const Icon = intTypeIcon(p.integrationType);
                  const testing = testingIds.has(p.id);
                  return (
                    <Card key={p.id} className="bg-slate-800 border-slate-700">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center"><Icon className="w-4 h-4 text-slate-300" /></div>
                            <div>
                              <p className="text-white font-medium text-sm">{p.profileName}</p>
                              <p className="text-slate-400 text-xs">{p.integrationType}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="outline" className={`text-xs ${envBadge(p.environment)}`}>{p.environment}</Badge>
                            <Badge variant="outline" className={`text-xs ${statusBadge(p.status)}`}>{p.status}</Badge>
                            {!REAL_ADAPTER_TYPES.has(p.integrationType) && (
                              <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/40">{t('⚠ Simulated', '⚠ محاكاة')}</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={`text-xs ${p.isHealthMonitoringEnabled ? 'text-emerald-300 border-emerald-700 bg-emerald-900/30' : 'text-slate-400 border-slate-600 bg-slate-700/40'}`}>
                            <HeartPulse className="w-3 h-3 me-1" />
                            {p.isHealthMonitoringEnabled
                              ? t(`Monitored · every ${p.healthCheckIntervalMinutes ?? 15}m`, `مراقب · كل ${p.healthCheckIntervalMinutes ?? 15} د`)
                              : t('Monitoring off', 'المراقبة متوقفة')}
                          </Badge>
                          {(p.consecutiveFailures ?? 0) > 0 && (
                            <Badge variant="outline" className={`text-xs ${(p.consecutiveFailures >= (p.alertOnFailureCount ?? 3)) ? 'text-red-300 border-red-700 bg-red-900/30' : 'text-amber-300 border-amber-700 bg-amber-900/30'}`}>
                              <AlertTriangle className="w-3 h-3 me-1" />
                              {t(`${p.consecutiveFailures} consecutive failure${p.consecutiveFailures === 1 ? '' : 's'}`, `${p.consecutiveFailures} إخفاقات متتالية`)}
                            </Badge>
                          )}
                        </div>
                        {p.lastTestResult && (
                          <div className={`rounded-md border p-2 space-y-1 ${p.lastTestResult === 'success' ? 'border-emerald-800/60 bg-emerald-900/20' : 'border-red-800/60 bg-red-900/20'}`}>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {p.lastTestResult === 'success'
                                ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                              <span className={`text-xs font-medium ${p.lastTestResult === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
                                {p.lastTestResult === 'success' ? t('Test passed', 'نجح الاختبار') : t('Test failed', 'فشل الاختبار')}
                              </span>
                              {typeof p.lastTestLatencyMs === 'number' && (
                                <span className="text-xs text-slate-400">{p.lastTestLatencyMs}ms</span>
                              )}
                              {p.lastTestSimulated && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-400 border-amber-500/40">{t('Simulated', 'محاكاة')}</Badge>
                              )}
                            </div>
                            {p.lastTestedAt && (
                              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                                <Clock className="w-3 h-3 shrink-0" />
                                {new Date(p.lastTestedAt).toLocaleString()}
                              </p>
                            )}
                            {(p.lastTestedByNameEn || p.lastTestedByNameAr) ? (
                              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                                <User className="w-3 h-3 shrink-0" />
                                {t('Tested by', 'اختبرها')} {lang === 'ar' ? (p.lastTestedByNameAr || p.lastTestedByNameEn) : (p.lastTestedByNameEn || p.lastTestedByNameAr)}
                              </p>
                            ) : p.lastTestedAt ? (
                              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                                <Bot className="w-3 h-3 shrink-0" />
                                {t('Automated health check', 'فحص صحة تلقائي')}
                              </p>
                            ) : null}
                            {p.lastTestMessage && <p className="text-[11px] text-slate-400 break-words">{p.lastTestMessage}</p>}
                          </div>
                        )}
                        <div className="flex gap-1 flex-wrap">
                          <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300 h-7 px-2 text-xs" onClick={() => { if (p.integrationType === 'smtp') { setSmtpRecipient(''); setSmtpTestTarget(p); } else { testConnection(p.id); } }} disabled={testing}>
                            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 me-1" />}{t('Test', 'اختبار')}
                          </Button>
                          {p.governanceStatus === 'pending_approval' && (
                            <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-7 px-2 text-xs" onClick={() => approveProfile(p.id)}>{t('Approve', 'موافقة')}</Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white h-7 px-2 text-xs" onClick={() => setDetailProfileId(p.id)}>
                            {t('Details', 'تفاصيل')}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white h-7 px-2 text-xs" onClick={() => setHealthTarget(p)}>
                            <Settings2 className="w-3.5 h-3.5 me-1" />{t('Health', 'الصحة')}
                          </Button>
                          {p.status !== 'inactive' && (
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 px-2 text-xs" onClick={() => setSuspendTarget(p)}>{t('Suspend', 'تعليق')}</Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Credential Vault */}
          <TabsContent value="vault" className="mt-4 space-y-4">
            <div className="rounded-md border border-amber-700/50 bg-amber-900/30 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-amber-400 text-sm">{t('Vault stores key REFERENCES only — never actual credentials. Rotate credentials in your vault system, then update the rotation timestamp here.', 'تخزن الخزنة مراجع المفاتيح فقط — وليس بيانات الاعتماد الفعلية. قم بتدوير بيانات الاعتماد في نظام الخزنة الخاص بك، ثم قم بتحديث طابع التدوير الزمني هنا.')}</p>
            </div>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loading ? <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div> : (
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Label', 'التسمية')}</TableHead>
                      <TableHead className="text-slate-300">{t('Type', 'النوع')}</TableHead>
                      <TableHead className="text-slate-300">{t('Vault Key Ref', 'مرجع مفتاح الخزنة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Status', 'الحالة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Last Rotated', 'آخر تدوير')}</TableHead>
                      <TableHead className="text-slate-300">{t('Rotation Due', 'موعد التدوير')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {vault.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">{t('No vault entries', 'لا توجد إدخالات في الخزنة')}</TableCell></TableRow>
                      : vault.map(v => (
                        <TableRow key={v.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-white">{v.labelEn}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs border-slate-600 text-slate-300">{v.credentialType}</Badge></TableCell>
                          <TableCell className="font-mono text-slate-400 text-sm">vault:****</TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${statusBadge(v.status)}`}>{v.status}</Badge></TableCell>
                          <TableCell className="text-slate-300 text-sm">{v.lastRotatedAt ? new Date(v.lastRotatedAt).toLocaleDateString() : '—'}</TableCell>
                          <TableCell className="text-slate-300 text-sm">{v.rotationDueAt ? new Date(v.rotationDueAt).toLocaleDateString() : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Governance Rules */}
          <TabsContent value="rules" className="mt-4">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loading ? <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div> : (
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Integration Type', 'نوع التكامل')}</TableHead>
                      <TableHead className="text-slate-300">{t('Rule Code', 'رمز القاعدة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Title', 'العنوان')}</TableHead>
                      <TableHead className="text-slate-300">{t('Permission Level', 'مستوى الإذن')}</TableHead>
                      <TableHead className="text-slate-300">{t('Active', 'نشط')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rules.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">{t('No rules', 'لا توجد قواعد')}</TableCell></TableRow>
                      : rules.map(r => (
                        <TableRow key={r.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-slate-300 text-sm">{r.integrationType}</TableCell>
                          <TableCell className="font-mono text-slate-300 text-sm">{r.ruleCode}</TableCell>
                          <TableCell className="text-white">{r.titleEn}</TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${permBadge(r.permissionLevel)}`}>{r.permissionLevel}</Badge></TableCell>
                          <TableCell><Switch checked={!!r.isActive} onCheckedChange={v => toggleRule(r.id, v)} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Log */}
          <TabsContent value="audit" className="mt-4">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                {loading ? <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700" />)}</div> : (
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Event', 'الحدث')}</TableHead>
                      <TableHead className="text-slate-300">{t('Outcome', 'النتيجة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Profile', 'الملف')}</TableHead>
                      <TableHead className="text-slate-300">{t('Message', 'الرسالة')}</TableHead>
                      <TableHead className="text-slate-300">{t('When', 'متى')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {auditLog.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">{t('No audit events', 'لا توجد أحداث تدقيق')}</TableCell></TableRow>
                      : auditLog.map(a => (
                        <TableRow key={a.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-slate-300 font-mono text-xs">{a.eventType}</TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${outcomeBadge(a.outcome)}`}>{a.outcome}</Badge></TableCell>
                          <TableCell className="text-slate-300 text-sm">{a.profileId ?? '—'}</TableCell>
                          <TableCell className="text-slate-400 text-sm max-w-48 truncate">{a.message ?? '—'}</TableCell>
                          <TableCell className="text-slate-400 text-sm whitespace-nowrap">{a.occurredAt ? timeAgo(a.occurredAt) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <AddProfileDialog open={addProfileOpen} onClose={() => setAddProfileOpen(false)} onSaved={load} />

        {healthTarget && <HealthSettingsDialog profile={healthTarget} onClose={() => setHealthTarget(null)} onSaved={load} />}

        <ProfileDetailDialog profileId={detailProfileId} onClose={() => setDetailProfileId(null)} />

        <Dialog open={!!smtpTestTarget} onOpenChange={v => !v && setSmtpTestTarget(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('Send Test Email', 'إرسال بريد اختباري')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-slate-400">
                {t('A test message will be sent from', 'سيتم إرسال رسالة اختبارية من')} <strong className="text-white">{smtpTestTarget?.profileName}</strong>.
              </p>
              <Label htmlFor="smtp-test-recipient">{t('Recipient email', 'البريد الإلكتروني للمستلم')}</Label>
              <Input
                id="smtp-test-recipient"
                type="email"
                autoFocus
                className="bg-slate-700 border-slate-600"
                placeholder="admin@example.com"
                value={smtpRecipient}
                onChange={e => setSmtpRecipient(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && isValidEmail(smtpRecipient)) {
                    testConnection(smtpTestTarget.id, smtpRecipient.trim());
                    setSmtpTestTarget(null);
                  }
                }}
              />
              {smtpRecipient.trim() !== '' && !isValidEmail(smtpRecipient) && (
                <p className="text-xs text-amber-400">{t('Enter a valid email address, e.g. name@company.com', 'أدخل عنوان بريد إلكتروني صالحاً، مثل name@company.com')}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" className="border-slate-600" onClick={() => setSmtpTestTarget(null)}>{t('Cancel', 'إلغاء')}</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!isValidEmail(smtpRecipient)}
                onClick={() => { testConnection(smtpTestTarget.id, smtpRecipient.trim()); setSmtpTestTarget(null); }}
              >
                {t('Send Test', 'إرسال الاختبار')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!suspendTarget} onOpenChange={v => !v && setSuspendTarget(null)}>
          <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Suspend Profile?', 'تعليق الملف؟')}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                {t('Suspend', 'تعليق')} <strong className="text-white">{suspendTarget?.profileName}</strong>? {t('This action is audit-logged.', 'هذا الإجراء مسجل تدقيقياً.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-slate-600">{t('Cancel', 'إلغاء')}</AlertDialogCancel>
              <AlertDialogAction onClick={suspendProfile} className="bg-red-600 hover:bg-red-700">{t('Suspend', 'تعليق')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AnimatedPage>
  );
}
