import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import { useListSystemConfig, usePatchSystemConfig } from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Save, Settings, Shield, Layers, Loader2, Clock } from 'lucide-react';

// Overtime session sanity cap — must be a positive number of hours.
const OT_CAP_KEY = 'payroll.maxOtSessionHours';
function isValidOtCap(raw: string): boolean {
  if (raw.trim() === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0;
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SystemConfig() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: configs, isLoading } = useListSystemConfig();
  const [changes, setChanges] = useState<Record<string, string>>({});

  // Build a lookup map from config data
  const configMap: Record<string, string> = {};
  (configs ?? []).forEach((c: any) => { configMap[c.configKey] = c.configValue; });

  // Merge with local changes
  const getValue = (key: string, fallback = '') => changes[key] ?? configMap[key] ?? fallback;

  const setValue = (key: string, value: string) => setChanges(prev => ({ ...prev, [key]: value }));

  const patchMutation = usePatchSystemConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listSystemConfig'] });
        setChanges({});
        toast({ title: t('Configuration saved', 'تم حفظ الإعدادات') });
      },
      onError: (err: any) => {
        toast({ title: t('Error', 'خطأ'), description: err?.message, variant: 'destructive' });
      },
    },
  });

  const otCapValue = getValue(OT_CAP_KEY, '12');
  const otCapInvalid = OT_CAP_KEY in changes && !isValidOtCap(otCapValue);

  const handleSave = () => {
    if (Object.keys(changes).length === 0) {
      toast({ title: t('No changes to save', 'لا توجد تغييرات للحفظ') });
      return;
    }
    if (otCapInvalid) {
      toast({
        title: t('Invalid value', 'قيمة غير صالحة'),
        description: t('Max overtime session must be a positive number of hours', 'الحد الأقصى لجلسة العمل الإضافي يجب أن يكون رقماً موجباً من الساعات'),
        variant: 'destructive',
      });
      return;
    }
    const updates = Object.entries(changes).map(([configKey, configValue]) => ({ configKey, configValue }));
    patchMutation.mutate({ data: updates } as any);
  };

  const orgType = getValue('org.type', 'commercial');
  const showWarning = orgType !== 'commercial';

  // Feature keys
  const featureKeys = (configs ?? [])
    .filter((c: any) => c.configKey.startsWith('features.'))
    .map((c: any) => c.configKey);

  // Security keys (excluding 'security.level' which is in Org section)
  const securityKeys = (configs ?? [])
    .filter((c: any) => c.configKey.startsWith('security.') && c.configKey !== 'security.level')
    .map((c: any) => c.configKey);

  if (isLoading) {
    return (
      <AnimatedPage>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('System Configuration', 'إعدادات النظام')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('Manage system-wide configuration and feature flags', 'إدارة الإعدادات العامة للنظام وميزاته')}</p>
          </div>
          <Button onClick={handleSave} disabled={patchMutation.isPending || Object.keys(changes).length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {patchMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {t('Save Changes', 'حفظ التغييرات')}
            {Object.keys(changes).length > 0 && (
              <Badge className="ml-2 bg-white/20 text-white border-transparent">{Object.keys(changes).length}</Badge>
            )}
          </Button>
        </div>

        {/* ⚠️ Readiness Warning */}
        {showWarning && (
          <Alert className="border-yellow-400/40 bg-yellow-50 dark:bg-yellow-950/20">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-700 dark:text-yellow-400">
              {t(
                'Some features require external infrastructure (smart card readers, HSM, PKI CA). These are shown as [REQUIRES SETUP] and are enabled in configuration but need external provisioning.',
                'بعض الميزات تتطلب بنية تحتية خارجية (قراء البطاقات الذكية، HSM، PKI CA). تظهر هذه الميزات بعلامة [يتطلب إعداداً] وهي مفعلة في الإعدادات لكنها تحتاج توفيراً خارجياً.'
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Section 1: Organization Profile */}
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="w-5 h-5 text-indigo-600" />
              {t('Organization Profile', 'ملف المؤسسة')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('Organization Name', 'اسم المؤسسة')}</label>
                <Input
                  value={getValue('org.name')}
                  onChange={e => setValue('org.name', e.target.value)}
                  placeholder={t('Enter organization name', 'أدخل اسم المؤسسة')}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('Organization Type', 'نوع المؤسسة')}</label>
                <Select value={getValue('org.type', 'commercial')} onValueChange={v => setValue('org.type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">{t('Commercial', 'تجارية')}</SelectItem>
                    <SelectItem value="government">{t('Government', 'حكومية')}</SelectItem>
                    <SelectItem value="military">{t('Military', 'عسكرية')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('Security Level', 'مستوى الأمان')}</label>
                <Select value={getValue('security.level', 'standard')} onValueChange={v => setValue('security.level', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">{t('Standard', 'قياسي')}</SelectItem>
                    <SelectItem value="enhanced">{t('Enhanced', 'محسّن')}</SelectItem>
                    <SelectItem value="high">{t('High', 'عالٍ')}</SelectItem>
                    <SelectItem value="top_secret">{t('Top Secret', 'سري للغاية')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Other org.* keys */}
              {(configs ?? [])
                .filter((c: any) => c.configKey.startsWith('org.') && !['org.name', 'org.type'].includes(c.configKey))
                .map((c: any) => (
                  <div key={c.configKey} className="space-y-1">
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">{c.configKey}</label>
                    <Input value={getValue(c.configKey)} onChange={e => setValue(c.configKey, e.target.value)} />
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Feature Modules */}
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="w-5 h-5 text-indigo-600" />
              {t('Feature Modules', 'وحدات الميزات')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {featureKeys.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('No feature flags configured', 'لا توجد ميزات مهيأة')}</p>
            ) : (
              <div className="space-y-3">
                {featureKeys.map((key: string) => {
                  const rawVal = getValue(key, 'false');
                  const isEnabled = rawVal === 'true';
                  const label = key.replace('features.', '').replace(/_/g, ' ');
                  const requiresSetup = showWarning && ['smart_card', 'hsm', 'pki', 'biometric'].some(k => key.includes(k));
                  return (
                    <div key={key} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div>
                        <p className="text-sm font-medium capitalize">{label}
                          {requiresSetup && <span className="ml-2 text-xs text-yellow-600">[REQUIRES SETUP]</span>}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">{key}</p>
                      </div>
                      <ToggleSwitch checked={isEnabled} onChange={v => setValue(key, v ? 'true' : 'false')} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section: Payroll Rules */}
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-5 h-5 text-indigo-600" />
              {t('Payroll Rules', 'قواعد الرواتب')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">{t('Max Overtime Session (hours)', 'الحد الأقصى لجلسة العمل الإضافي (ساعات)')}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">
                  {t(
                    'Single overtime sessions longer than this are treated as bad punch data: pay is capped at this value and the run is flagged for HR review.',
                    'جلسات العمل الإضافي الأطول من هذا الحد تُعتبر بيانات بصمة خاطئة: يُحدّد الأجر عند هذه القيمة وتُعلَّم التسوية لمراجعة الموارد البشرية.'
                  )}
                </p>
                <p className="text-xs text-gray-400 font-mono">{OT_CAP_KEY}</p>
              </div>
              <div className="space-y-1">
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  className={`w-32 text-sm ${otCapInvalid ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  value={otCapValue}
                  onChange={e => setValue(OT_CAP_KEY, e.target.value)}
                />
                {otCapInvalid && (
                  <p className="text-xs text-red-500">{t('Must be a positive number', 'يجب أن يكون رقماً موجباً')}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Security & Compliance */}
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="w-5 h-5 text-indigo-600" />
              {t('Security & Compliance', 'الأمان والامتثال')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {securityKeys.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('No security settings configured', 'لا توجد إعدادات أمان مهيأة')}</p>
            ) : (
              <div className="space-y-3">
                {securityKeys.map((key: string) => {
                  const rawVal = getValue(key, '');
                  const isBool = rawVal === 'true' || rawVal === 'false';
                  const label = key.replace('security.', '').replace(/_/g, ' ');
                  return (
                    <div key={key} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div>
                        <p className="text-sm font-medium capitalize">{label}</p>
                        <p className="text-xs text-gray-400 font-mono">{key}</p>
                      </div>
                      {isBool ? (
                        <ToggleSwitch
                          checked={rawVal === 'true'}
                          onChange={v => setValue(key, v ? 'true' : 'false')}
                        />
                      ) : (
                        <Input
                          className="w-48 text-sm"
                          value={rawVal}
                          onChange={e => setValue(key, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save footer */}
        <div className="flex justify-end pb-6">
          <Button onClick={handleSave} disabled={patchMutation.isPending || Object.keys(changes).length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6">
            {patchMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {t('Save Changes', 'حفظ التغييرات')}
          </Button>
        </div>
      </div>
    </AnimatedPage>
  );
}
