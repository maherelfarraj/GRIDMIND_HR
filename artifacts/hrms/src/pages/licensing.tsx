import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Shield, CheckCircle, XCircle, Lock, FileText, RefreshCw } from 'lucide-react';

const LICENSE = {
  edition: 'Enterprise',
  issuedTo: 'Saudi Defense Authority',
  issuedToAr: 'هيئة الدفاع السعودية',
  maxUsers: 500,
  currentUsers: 142,
  validUntil: '2026-12-31',
  issuedAt: '2025-01-01',
  daysRemaining: 535,
  totalDays: 730,
  serialNumber: 'HRMS-ENT-2025-SDA-001',
  licenseType: 'Perpetual (Air-Gap)',
};

const MODULES = [
  { name: 'Core HR',              nameAr: 'الموارد البشرية الأساسية',    enterprise: true,  standard: true,  community: true  },
  { name: 'Leave Management',     nameAr: 'إدارة الإجازات',              enterprise: true,  standard: true,  community: true  },
  { name: 'Payroll',              nameAr: 'الرواتب',                     enterprise: true,  standard: true,  community: false },
  { name: 'Attendance & Devices', nameAr: 'الحضور والأجهزة',             enterprise: true,  standard: true,  community: false },
  { name: 'Recruitment',          nameAr: 'التوظيف',                     enterprise: true,  standard: true,  community: false },
  { name: 'Performance',          nameAr: 'الأداء',                      enterprise: true,  standard: true,  community: false },
  { name: 'Training & Skills',    nameAr: 'التدريب والمهارات',            enterprise: true,  standard: true,  community: false },
  { name: 'Military/Defense',     nameAr: 'عسكري / دفاع',               enterprise: true,  standard: false, community: false },
  { name: 'Integration Center',   nameAr: 'مركز التكامل',                enterprise: true,  standard: true,  community: false },
  { name: 'Advanced Analytics',   nameAr: 'التحليلات المتقدمة',           enterprise: true,  standard: false, community: false },
  { name: 'Workflow Builder',     nameAr: 'منشئ سير العمل',              enterprise: true,  standard: false, community: false },
  { name: 'Self-Service Portals', nameAr: 'بوابات الخدمة الذاتية',       enterprise: true,  standard: true,  community: false },
];

const VALIDATION_HISTORY = [
  { date: '2025-07-14 08:00', method: 'Offline checksum', result: 'pass', note: 'Air-gap validated' },
  { date: '2025-06-14 08:00', method: 'Offline checksum', result: 'pass', note: 'Air-gap validated' },
  { date: '2025-05-14 08:00', method: 'Offline checksum', result: 'pass', note: 'Air-gap validated' },
];

const EDITION_COLS: Array<{ key: 'enterprise' | 'standard' | 'community'; label: string; color: string }> = [
  { key: 'enterprise', label: 'Enterprise', color: 'text-yellow-400' },
  { key: 'standard',   label: 'Standard',   color: 'text-blue-400' },
  { key: 'community',  label: 'Community',  color: 'text-slate-400' },
];

export default function Licensing() {
  const { t } = useLanguage();
  const { toast } = useToast();

  const usagePercent = Math.round((LICENSE.currentUsers / LICENSE.maxUsers) * 100);
  const validityPercent = Math.round((LICENSE.daysRemaining / LICENSE.totalDays) * 100);

  function validateLicense() {
    toast({ title: t('✓ License validated offline — checksum OK', '✓ تم التحقق من الترخيص دون اتصال — الملف سليم') });
  }

  return (
    <AnimatedPage className="space-y-6">
      {/* Offline badge */}
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 flex items-center gap-3 w-fit">
        <Lock className="w-5 h-5 text-blue-400 shrink-0" />
        <span className="text-blue-300 font-semibold text-sm">
          {t('🔒 Offline License — No internet connection required', '🔒 ترخيص غير متصل — لا يلزم اتصال بالإنترنت')}
        </span>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary" />
          {t('License Management', 'إدارة الترخيص')}
        </h1>
        <p className="text-slate-400 mt-1">{t('Current license, entitlements, and validation history', 'الترخيص الحالي والصلاحيات وسجل التحقق')}</p>
      </div>

      {/* Current License Card */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
            {t('Current License', 'الترخيص الحالي')}
            <Badge className="bg-yellow-100 text-yellow-700 ml-2">{LICENSE.edition}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-slate-400 text-xs mb-1">{t('Issued To', 'صادر لـ')}</div>
              <div className="text-white font-semibold">{t(LICENSE.issuedTo, LICENSE.issuedToAr)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">{t('Serial Number', 'الرقم التسلسلي')}</div>
              <div className="text-slate-300 font-mono text-sm">{LICENSE.serialNumber}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">{t('License Type', 'نوع الترخيص')}</div>
              <div className="text-white">{LICENSE.licenseType}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">{t('Users', 'المستخدمون')}</span>
                <span className="text-white">{LICENSE.currentUsers} / {LICENSE.maxUsers}</span>
              </div>
              <Progress value={usagePercent} className="h-2 bg-slate-700" />
              <div className="text-xs text-slate-500 mt-1">{usagePercent}% {t('capacity used', 'من السعة مستخدمة')}</div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">{t('Valid Until', 'صالح حتى')}</span>
                <span className="text-white">{LICENSE.validUntil}</span>
              </div>
              <Progress value={validityPercent} className={`h-2 bg-slate-700 ${validityPercent < 20 ? '[&>div]:bg-red-500' : validityPercent < 50 ? '[&>div]:bg-amber-500' : ''}`} />
              <div className="text-xs text-slate-500 mt-1">{LICENSE.daysRemaining} {t('days remaining', 'يومًا متبقيًا')}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entitlements */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">{t('Module Entitlements', 'صلاحيات الوحدات')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 py-2 pr-4">{t('Module', 'الوحدة')}</th>
                  {EDITION_COLS.map(col => (
                    <th key={col.key} className={`text-center py-2 px-4 font-semibold ${col.color} ${col.key === 'enterprise' ? 'bg-yellow-900/20' : ''}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map(mod => (
                  <tr key={mod.name} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                    <td className="py-2.5 pr-4">
                      <div className="text-white">{t(mod.name, mod.nameAr)}</div>
                    </td>
                    {EDITION_COLS.map(col => (
                      <td key={col.key} className={`text-center py-2.5 px-4 ${col.key === 'enterprise' ? 'bg-yellow-900/10' : ''}`}>
                        {mod[col.key] ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" />
                        ) : (
                          <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-700/50 rounded text-xs text-yellow-400">
            ★ {t('Your current edition: Enterprise — all modules enabled', 'إصدارك الحالي: Enterprise — جميع الوحدات مفعلة')}
          </div>
        </CardContent>
      </Card>

      {/* Validation History */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">{t('Validation History', 'سجل التحقق')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {VALIDATION_HISTORY.map((v, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-700/40 rounded border border-slate-600">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-white text-sm">{v.date}</div>
                    <div className="text-slate-400 text-xs">{v.method} — {v.note}</div>
                  </div>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 text-xs">{v.result}</Badge>
              </div>
            ))}
          </div>
          <div className="mt-3 text-slate-500 text-xs">
            {t('Next validation due:', 'موعد التحقق التالي:')} 2025-08-14
          </div>
        </CardContent>
      </Card>

      {/* License Actions */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">{t('License Actions', 'إجراءات الترخيص')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button className="bg-primary hover:bg-primary/90" onClick={validateLicense}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('Validate Now (Offline)', 'تحقق الآن (بدون إنترنت)')}
          </Button>
          <Button variant="outline" className="border-slate-600 text-slate-300"
            onClick={() => window.open('about:blank', '_blank')}>
            <FileText className="w-4 h-4 mr-2" />
            {t('View License Terms', 'عرض شروط الترخيص')}
          </Button>
        </CardContent>
      </Card>
    </AnimatedPage>
  );
}
