import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Activity, Database, Server, Shield, Globe, CheckCircle, AlertTriangle,
  XCircle, RefreshCw, Download, Package,
} from 'lucide-react';

const HEALTH_CHECKS = [
  { id: 1, category: 'Database', icon: Database, name: 'PostgreSQL Connection', nameAr: 'اتصال قاعدة البيانات', result: 'pass', metric: 'Latency: 4ms', lastRun: '2025-07-14 14:00' },
  { id: 2, category: 'Database', icon: Database, name: 'Schema Migrations', nameAr: 'ترحيل المخطط', result: 'pass', metric: 'All 47 applied', lastRun: '2025-07-14 14:00' },
  { id: 3, category: 'API', icon: Globe, name: 'API Health Endpoint', nameAr: 'نقطة صحة API', result: 'pass', metric: '/api/health: 200', lastRun: '2025-07-14 14:00' },
  { id: 4, category: 'API', icon: Globe, name: 'Auth Middleware', nameAr: 'وسيط المصادقة', result: 'pass', metric: 'Protected routes: 82', lastRun: '2025-07-14 14:00' },
  { id: 5, category: 'Security', icon: Shield, name: 'Session Secret', nameAr: 'مفتاح الجلسة', result: 'pass', metric: 'SESSION_SECRET set', lastRun: '2025-07-14 14:00' },
  { id: 6, category: 'Security', icon: Shield, name: 'Rate Limiting', nameAr: 'تحديد معدل الطلبات', result: 'warn', metric: 'Not implemented', lastRun: '2025-07-14 14:00' },
  { id: 7, category: 'Storage', icon: Server, name: 'Disk Space', nameAr: 'مساحة القرص', result: 'warn', metric: 'Unverified', lastRun: '2025-07-14 14:00' },
  { id: 8, category: 'Storage', icon: Server, name: 'Backup Path', nameAr: 'مسار النسخ الاحتياطي', result: 'warn', metric: 'Simulated', lastRun: '2025-07-14 14:00' },
];

const READINESS_CHECKS = [
  { id: 1, name: 'PostgreSQL version ≥ 14', mandatory: true, result: 'pass' },
  { id: 2, name: 'Node.js version ≥ 18', mandatory: true, result: 'pass' },
  { id: 3, name: 'Memory ≥ 8 GB', mandatory: true, result: 'warn' },
  { id: 4, name: 'Disk space ≥ 100 GB', mandatory: true, result: 'warn' },
  { id: 5, name: 'HTTPS configured', mandatory: true, result: 'fail' },
  { id: 6, name: 'Backup schedule active', mandatory: false, result: 'warn' },
  { id: 7, name: 'MFA enabled', mandatory: false, result: 'warn' },
  { id: 8, name: 'Log retention policy set', mandatory: false, result: 'fail' },
];

const UPDATE_PACKAGES = [
  { id: 1, name: 'HRMS Core', version: '2.4.1', currentVersion: '2.4.0', status: 'available', size: '12.4 MB', signed: true },
  { id: 2, name: 'Payroll Engine', version: '1.8.0', currentVersion: '1.8.0', status: 'current', size: '4.2 MB', signed: true },
  { id: 3, name: 'Security Patch', version: 'SEC-2025-07', currentVersion: 'SEC-2025-06', status: 'critical', size: '1.1 MB', signed: true },
];

const CHECKLIST_ITEMS = [
  { id: 1, category: 'Infrastructure', title: 'Database server configured', titleAr: 'تكوين خادم قاعدة البيانات', priority: 'required', implLevel: 'production', status: 'done' },
  { id: 2, category: 'Infrastructure', title: 'Disk storage provisioned', titleAr: 'توفير مساحة تخزين', priority: 'required', implLevel: 'prototype', status: 'pending' },
  { id: 3, category: 'Security', title: 'Admin passwords rotated', titleAr: 'تغيير كلمات مرور المسؤولين', priority: 'required', implLevel: 'production', status: 'pending' },
  { id: 4, category: 'Security', title: 'MFA enabled for admins', titleAr: 'تفعيل المصادقة الثنائية للمسؤولين', priority: 'required', implLevel: 'prototype', status: 'pending' },
  { id: 5, category: 'Data', title: 'Employees loaded', titleAr: 'تحميل بيانات الموظفين', priority: 'required', implLevel: 'production', status: 'done' },
  { id: 6, category: 'Data', title: 'Leave balances initialized', titleAr: 'تهيئة أرصدة الإجازات', priority: 'required', implLevel: 'production', status: 'done' },
  { id: 7, category: 'Monitoring', title: 'Backup verification active', titleAr: 'التحقق النشط من النسخ الاحتياطية', priority: 'recommended', implLevel: 'prototype', status: 'pending' },
  { id: 8, category: 'Monitoring', title: 'Log retention policy configured', titleAr: 'تكوين سياسة الاحتفاظ بالسجلات', priority: 'recommended', implLevel: 'production', status: 'pending' },
];

function ResultBadge({ result }: { result: string }) {
  const map: Record<string, string> = {
    pass: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-700',
    fail: 'bg-red-100 text-red-700',
    done: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-slate-700 text-slate-300',
    current: 'bg-slate-700 text-slate-300',
    available: 'bg-blue-100 text-blue-700',
    critical: 'bg-red-100 text-red-700',
  };
  const iconMap: Record<string, React.ReactNode> = {
    pass: <CheckCircle className="w-3 h-3" />,
    warn: <AlertTriangle className="w-3 h-3" />,
    fail: <XCircle className="w-3 h-3" />,
    done: <CheckCircle className="w-3 h-3" />,
  };
  return (
    <Badge className={`text-xs flex items-center gap-1 w-fit ${map[result] ?? 'bg-slate-700 text-slate-300'}`}>
      {iconMap[result]}{result}
    </Badge>
  );
}

function HealthChecksTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);

  async function runChecks() {
    setRunning(true);
    try {
      await apiFetch('/api/diagnostics/run', { method: 'POST' });
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
    setRan(true);
    setRunning(false);
    toast({ title: t('✓ Simulated — not a production action', '✓ محاكاة — ليس إجراءً إنتاجيًا') });
  }

  const pass = HEALTH_CHECKS.filter(c => c.result === 'pass').length;
  const warn = HEALTH_CHECKS.filter(c => c.result === 'warn').length;
  const fail = HEALTH_CHECKS.filter(c => c.result === 'fail').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          <span className="text-emerald-400 font-semibold">{pass} {t('pass', 'ناجح')}</span>
          <span className="text-amber-400 font-semibold">{warn} {t('warn', 'تحذير')}</span>
          <span className="text-red-400 font-semibold">{fail} {t('fail', 'فشل')}</span>
        </div>
        <Button className="bg-primary hover:bg-primary/90" onClick={runChecks} disabled={running}>
          <RefreshCw className={`w-4 h-4 mr-2 ${running ? 'animate-spin' : ''}`} />
          {running ? t('Running…', 'جاري التشغيل…') : t('Run Health Checks', 'تشغيل فحص الصحة')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {HEALTH_CHECKS.map(check => {
          const Icon = check.icon;
          return (
            <Card key={check.id} className={`bg-slate-800 border-slate-700 ${ran && check.result === 'fail' ? 'border-red-700' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-slate-700 rounded flex items-center justify-center">
                      <Icon className="w-4 h-4 text-slate-300" />
                    </div>
                    <div>
                      <div className="text-white text-sm font-medium">{t(check.name, check.nameAr)}</div>
                      <div className="text-slate-500 text-xs">{check.category}</div>
                    </div>
                  </div>
                  <ResultBadge result={check.result} />
                </div>
                <div className="text-slate-400 text-xs mt-2">{check.metric}</div>
                <div className="text-slate-600 text-xs mt-1">{t('Last run:', 'آخر تشغيل:')} {check.lastRun}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ReadinessTab() {
  const { t } = useLanguage();
  const { toast } = useToast();

  return (
    <div className="overflow-x-auto rounded border border-slate-700">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-700/50 border-slate-700">
            <TableHead className="text-slate-400">{t('Check', 'الفحص')}</TableHead>
            <TableHead className="text-slate-400">{t('Type', 'النوع')}</TableHead>
            <TableHead className="text-slate-400">{t('Result', 'النتيجة')}</TableHead>
            <TableHead className="text-slate-400">{t('Actions', 'إجراءات')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {READINESS_CHECKS.map(c => (
            <TableRow key={c.id} className="border-slate-700 hover:bg-slate-700/30">
              <TableCell className="text-white">{c.name}</TableCell>
              <TableCell>
                <Badge className={c.mandatory ? 'bg-red-100 text-red-700' : 'bg-slate-700 text-slate-300'}>
                  {c.mandatory ? t('Mandatory', 'إلزامي') : t('Optional', 'اختياري')}
                </Badge>
              </TableCell>
              <TableCell><ResultBadge result={c.result} /></TableCell>
              <TableCell>
                {!c.mandatory && c.result !== 'pass' && (
                  <Button variant="ghost" size="sm" className="text-amber-400 hover:text-amber-300 h-7 text-xs"
                    onClick={() => toast({ title: t('✓ Simulated — not a production action', '✓ محاكاة — ليس إجراءً إنتاجيًا') })}>
                    {t('Override', 'تجاوز')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UpdatesTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [confirmInstall, setConfirmInstall] = useState<number | null>(null);

  function simAction(msg: string) {
    toast({ title: t(`✓ Simulated — ${msg}`, `✓ محاكاة — ${msg}`) });
  }

  const pkg = UPDATE_PACKAGES.find(p => p.id === confirmInstall);

  return (
    <div className="space-y-4">
      <div className="bg-blue-900/30 border border-blue-700 rounded p-3 flex items-center gap-2">
        <Shield className="w-4 h-4 text-blue-400 shrink-0" />
        <span className="text-blue-300 text-sm">{t('All updates are signed and verified offline. No internet connection required.', 'جميع التحديثات موقعة ومحققة دون اتصال بالإنترنت.')}</span>
      </div>

      <div className="overflow-x-auto rounded border border-slate-700">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-700/50 border-slate-700">
              <TableHead className="text-slate-400">{t('Package', 'الحزمة')}</TableHead>
              <TableHead className="text-slate-400">{t('Current', 'الحالي')}</TableHead>
              <TableHead className="text-slate-400">{t('Available', 'المتاح')}</TableHead>
              <TableHead className="text-slate-400">{t('Size', 'الحجم')}</TableHead>
              <TableHead className="text-slate-400">{t('Status', 'الحالة')}</TableHead>
              <TableHead className="text-slate-400">{t('Actions', 'إجراءات')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {UPDATE_PACKAGES.map(pkg => (
              <TableRow key={pkg.id} className="border-slate-700 hover:bg-slate-700/30">
                <TableCell className="text-white font-medium">{pkg.name}</TableCell>
                <TableCell className="text-slate-400 text-xs font-mono">{pkg.currentVersion}</TableCell>
                <TableCell className="text-slate-300 text-xs font-mono">{pkg.version}</TableCell>
                <TableCell className="text-slate-400 text-xs">{pkg.size}</TableCell>
                <TableCell><ResultBadge result={pkg.status} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300 h-7 text-xs"
                      onClick={() => simAction('signature verified')}>
                      <Shield className="w-3 h-3 mr-1" />{t('Verify', 'تحقق')}
                    </Button>
                    {pkg.status !== 'current' && (
                      <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300 h-7 text-xs"
                        onClick={() => setConfirmInstall(pkg.id)}>
                        <Download className="w-3 h-3 mr-1" />{t('Install', 'تثبيت')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmInstall !== null} onOpenChange={() => setConfirmInstall(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-white">{t('Confirm Installation', 'تأكيد التثبيت')}</DialogTitle>
          </DialogHeader>
          <p className="text-slate-400 text-sm">{t(`Install ${pkg?.name} v${pkg?.version}? This is a simulated action.`, `تثبيت ${pkg?.name} v${pkg?.version}؟ هذا إجراء محاكاة.`)}</p>
          <DialogFooter>
            <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => setConfirmInstall(null)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={() => { simAction('package installed'); setConfirmInstall(null); }}>
              {t('Install', 'تثبيت')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeploymentChecklistTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<Record<number, string>>(
    Object.fromEntries(CHECKLIST_ITEMS.map(i => [i.id, i.status]))
  );
  const [notes, setNotes] = useState<Record<number, string>>({});

  const categories = [...new Set(CHECKLIST_ITEMS.map(i => i.category))];

  return (
    <div className="space-y-6">
      {categories.map(cat => (
        <Card key={cat} className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">{cat}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {CHECKLIST_ITEMS.filter(i => i.category === cat).map(item => (
              <div key={item.id} className="p-3 bg-slate-700/40 rounded border border-slate-600 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-white text-sm">{t(item.title, item.titleAr)}</span>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge className={item.priority === 'required' ? 'bg-red-100 text-red-700 text-xs' : 'bg-slate-700 text-slate-300 text-xs'}>
                        {item.priority}
                      </Badge>
                      <Badge className={item.implLevel === 'production' ? 'bg-emerald-100 text-emerald-700 text-xs' : 'bg-amber-100 text-amber-700 text-xs'}>
                        {item.implLevel === 'prototype' ? '⚠ Demo only' : 'production'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ResultBadge result={statuses[item.id] ?? 'pending'} />
                    <select
                      className="bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1"
                      value={statuses[item.id] ?? 'pending'}
                      onChange={e => {
                        setStatuses(s => ({ ...s, [item.id]: e.target.value }));
                        toast({ title: t('✓ Status updated', '✓ تم تحديث الحالة') });
                      }}
                    >
                      <option value="pending">{t('Pending', 'قيد الانتظار')}</option>
                      <option value="done">{t('Done', 'تم')}</option>
                      <option value="pass">{t('Pass', 'ناجح')}</option>
                      <option value="fail">{t('Fail', 'فشل')}</option>
                    </select>
                  </div>
                </div>
                <Input
                  className="bg-slate-800 border-slate-600 text-slate-300 h-7 text-xs"
                  placeholder={t('Add notes…', 'أضف ملاحظات…')}
                  value={notes[item.id] ?? ''}
                  onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Diagnostics() {
  const { t } = useLanguage();

  return (
    <AnimatedPage className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Activity className="w-8 h-8 text-primary" />
          {t('System Diagnostics', 'تشخيص النظام')}
        </h1>
        <p className="text-slate-400 mt-1">{t('Health checks, readiness, updates, and deployment checklist', 'فحوصات الصحة والجاهزية والتحديثات وقائمة النشر')}</p>
      </div>

      <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 text-amber-400 px-3 py-2 rounded-lg text-sm mb-2">
        <Activity className="w-4 h-4 shrink-0" />
        {t('Health checks are simulated and do not reflect real system state. Software update apply is not implemented in this installation.', 'فحوصات الصحة محاكاة ولا تعكس حالة النظام الفعلية. تطبيق تحديثات البرامج غير مُطبَّق في هذا التثبيت.')}
      </div>

      <Tabs defaultValue="health">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="health" className="data-[state=active]:bg-slate-700">{t('Health Checks', 'فحوصات الصحة')}</TabsTrigger>
          <TabsTrigger value="readiness" className="data-[state=active]:bg-slate-700">{t('Readiness', 'الجاهزية')}</TabsTrigger>
          <TabsTrigger value="updates" className="data-[state=active]:bg-slate-700">{t('Updates', 'التحديثات')}</TabsTrigger>
          <TabsTrigger value="checklist" className="data-[state=active]:bg-slate-700">{t('Deployment Checklist', 'قائمة النشر')}</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="mt-4"><HealthChecksTab /></TabsContent>
        <TabsContent value="readiness" className="mt-4"><ReadinessTab /></TabsContent>
        <TabsContent value="updates" className="mt-4"><UpdatesTab /></TabsContent>
        <TabsContent value="checklist" className="mt-4"><DeploymentChecklistTab /></TabsContent>
      </Tabs>
    </AnimatedPage>
  );
}
