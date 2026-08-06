import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useLocation } from 'wouter';
import {
  CheckCircle, Circle, ChevronRight, Rocket, Building2, Globe,
  Banknote, Calendar, MapPin, Flag, Users, ShieldCheck, CheckSquare,
  Cpu, HardDrive, Lock, PartyPopper,
} from 'lucide-react';

const STEPS = [
  { id: 'org_profile',   icon: Building2,   labelEn: 'Org Profile',        labelAr: 'ملف المنظمة' },
  { id: 'branding',      icon: Flag,        labelEn: 'Branding',           labelAr: 'الهوية البصرية' },
  { id: 'locale',        icon: Globe,       labelEn: 'Locale & Language',  labelAr: 'الإعدادات المحلية' },
  { id: 'payroll',       icon: Banknote,    labelEn: 'Payroll Settings',   labelAr: 'إعدادات الرواتب' },
  { id: 'workweek',      icon: Calendar,    labelEn: 'Work Week',          labelAr: 'أسبوع العمل' },
  { id: 'holidays',      icon: MapPin,      labelEn: 'Holidays',           labelAr: 'العطل الرسمية' },
  { id: 'org_structure', icon: Building2,   labelEn: 'Org Structure',      labelAr: 'الهيكل التنظيمي' },
  { id: 'roles_grades',  icon: ShieldCheck, labelEn: 'Roles & Grades',     labelAr: 'الأدوار والدرجات' },
  { id: 'admins',        icon: Users,       labelEn: 'Administrators',     labelAr: 'المسؤولون' },
  { id: 'approvals',     icon: CheckSquare, labelEn: 'Approval Chains',    labelAr: 'سلاسل الموافقة' },
  { id: 'devices',       icon: Cpu,         labelEn: 'Attendance Devices', labelAr: 'أجهزة الحضور' },
  { id: 'backup',        icon: HardDrive,   labelEn: 'Backup',             labelAr: 'النسخ الاحتياطي' },
  { id: 'security',      icon: Lock,        labelEn: 'Security',           labelAr: 'الأمان' },
  { id: 'complete',      icon: PartyPopper, labelEn: 'Complete',           labelAr: 'اكتمل' },
];

function StepContent({ stepId }: { stepId: string }) {
  const { t } = useLanguage();
  const [, navigate] = useLocation();

  const fieldClass = 'bg-slate-800 border-slate-600 text-white placeholder:text-slate-500';

  switch (stepId) {
    case 'org_profile':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label className="text-slate-300">{t('Organization Name (English)', 'اسم المنظمة (إنجليزي)')}</Label>
              <Input className={`mt-1 ${fieldClass}`} defaultValue="Saudi Defense Authority" /></div>
            <div><Label className="text-slate-300">{t('Organization Name (Arabic)', 'اسم المنظمة (عربي)')}</Label>
              <Input className={`mt-1 ${fieldClass}`} defaultValue="هيئة الدفاع السعودية" dir="rtl" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label className="text-slate-300">{t('Org Type', 'نوع المنظمة')}</Label>
              <Select defaultValue="military"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="commercial">{t('Commercial', 'تجاري')}</SelectItem>
                  <SelectItem value="government">{t('Government', 'حكومي')}</SelectItem>
                  <SelectItem value="military">{t('Military', 'عسكري')}</SelectItem></SelectContent></Select></div>
            <div><Label className="text-slate-300">{t('Org Code', 'رمز المنظمة')}</Label>
              <Input className={`mt-1 ${fieldClass}`} defaultValue="SDA-001" /></div>
            <div><Label className="text-slate-300">{t('Country', 'الدولة')}</Label>
              <Select defaultValue="sa"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="sa">Saudi Arabia — المملكة العربية السعودية</SelectItem>
                  <SelectItem value="ae">UAE — الإمارات</SelectItem>
                  <SelectItem value="kw">Kuwait — الكويت</SelectItem></SelectContent></Select></div>
          </div>
        </div>
      );
    case 'branding':
      return (
        <div className="space-y-4">
          <div><Label className="text-slate-300">{t('Logo URL (optional)', 'رابط الشعار (اختياري)')}</Label>
            <Input className={`mt-1 ${fieldClass}`} placeholder="https://example.com/logo.png" /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label className="text-slate-300">{t('Primary Color', 'اللون الرئيسي')}</Label>
              <Input className={`mt-1 ${fieldClass}`} defaultValue="#1e40af" type="color" /></div>
            <div><Label className="text-slate-300">{t('Tagline (English)', 'الشعار (إنجليزي)')}</Label>
              <Input className={`mt-1 ${fieldClass}`} defaultValue="Defending the Nation" /></div>
          </div>
          <div><Label className="text-slate-300">{t('Tagline (Arabic)', 'الشعار (عربي)')}</Label>
            <Input className={`mt-1 ${fieldClass}`} defaultValue="في خدمة الوطن" dir="rtl" /></div>
        </div>
      );
    case 'locale':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label className="text-slate-300">{t('Default Language', 'اللغة الافتراضية')}</Label>
              <Select defaultValue="ar"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem></SelectContent></Select></div>
            <div><Label className="text-slate-300">{t('Timezone', 'المنطقة الزمنية')}</Label>
              <Select defaultValue="Asia/Riyadh"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Asia/Riyadh">Asia/Riyadh (UTC+3)</SelectItem>
                  <SelectItem value="Asia/Dubai">Asia/Dubai (UTC+4)</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></div>
            <div><Label className="text-slate-300">{t('Date Format', 'تنسيق التاريخ')}</Label>
              <Select defaultValue="DD/MM/YYYY"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem></SelectContent></Select></div>
          </div>
        </div>
      );
    case 'payroll':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label className="text-slate-300">{t('Currency', 'العملة')}</Label>
              <Select defaultValue="SAR"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SAR">SAR — ريال سعودي</SelectItem>
                  <SelectItem value="AED">AED — درهم إماراتي</SelectItem>
                  <SelectItem value="USD">USD — دولار أمريكي</SelectItem>
                  <SelectItem value="EUR">EUR — يورو</SelectItem></SelectContent></Select></div>
            <div><Label className="text-slate-300">{t('Pay Period', 'دورة الرواتب')}</Label>
              <Select defaultValue="monthly"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="monthly">{t('Monthly', 'شهري')}</SelectItem>
                  <SelectItem value="biweekly">{t('Bi-weekly', 'نصف شهري')}</SelectItem></SelectContent></Select></div>
            <div><Label className="text-slate-300">{t('First Pay Date', 'تاريخ أول راتب')}</Label>
              <Input className={`mt-1 ${fieldClass}`} type="date" defaultValue="2025-01-31" /></div>
          </div>
        </div>
      );
    case 'workweek':
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-slate-300 mb-2 block">{t('Weekend Days', 'أيام العطلة الأسبوعية')}</Label>
            <div className="flex flex-wrap gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <Badge key={d} className={`cursor-pointer px-3 py-1.5 text-sm ${['Fri', 'Sat'].includes(d) ? 'bg-primary text-primary-foreground' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>{d}</Badge>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">{t('Click to toggle. Fri & Sat are pre-selected.', 'انقر للتبديل. الجمعة والسبت محددان مسبقًا.')}</p>
          </div>
          <div><Label className="text-slate-300">{t('Working Hours Per Day', 'ساعات العمل اليومية')}</Label>
            <Input className={`mt-1 ${fieldClass} w-32`} type="number" defaultValue="8" min="1" max="24" /></div>
        </div>
      );
    case 'holidays':
      return (
        <div className="space-y-3">
          <p className="text-slate-400 text-sm">{t('Public holidays configured for this organization:', 'العطل الرسمية المضبوطة لهذه المنظمة:')}</p>
          {[
            { date: '2025-01-01', name: "New Year's Day", nameAr: 'رأس السنة الميلادية' },
            { date: '2025-09-23', name: 'Saudi National Day', nameAr: 'اليوم الوطني السعودي' },
            { date: '2025-04-22', name: 'Eid Al-Fitr (est.)', nameAr: 'عيد الفطر (تقريبي)' },
            { date: '2025-06-07', name: 'Eid Al-Adha (est.)', nameAr: 'عيد الأضحى (تقريبي)' },
          ].map(h => (
            <div key={h.date} className="flex items-center justify-between p-3 bg-slate-700/50 rounded border border-slate-600">
              <div>
                <span className="text-white font-medium">{t(h.name, h.nameAr)}</span>
                <span className="text-slate-400 text-sm ml-3">{h.date}</span>
              </div>
              <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300">✕</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 mt-2">
            + {t('Add Holiday', 'إضافة عطلة')}
          </Button>
        </div>
      );
    case 'org_structure':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[{ label: 'Departments', labelAr: 'الأقسام', count: 12 }, { label: 'Units', labelAr: 'الوحدات', count: 34 }].map(s => (
              <Card key={s.label} className="bg-slate-700/50 border-slate-600">
                <CardContent className="p-4 text-center">
                  <div className="text-3xl font-bold text-white">{s.count}</div>
                  <div className="text-slate-400 text-sm mt-1">{t(s.label, s.labelAr)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => navigate('/departments')}>
            {t('Manage Departments →', 'إدارة الأقسام ←')}
          </Button>
        </div>
      );
    case 'roles_grades':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[{ label: 'Roles', labelAr: 'الأدوار', count: 8 }, { label: 'Salary Grades', labelAr: 'درجات الراتب', count: 15 }].map(s => (
              <Card key={s.label} className="bg-slate-700/50 border-slate-600">
                <CardContent className="p-4 text-center">
                  <div className="text-3xl font-bold text-white">{s.count}</div>
                  <div className="text-slate-400 text-sm mt-1">{t(s.label, s.labelAr)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => navigate('/roles')}>
              {t('Manage Roles →', 'إدارة الأدوار ←')}
            </Button>
            <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => navigate('/payroll/grades')}>
              {t('Manage Grades →', 'إدارة الدرجات ←')}
            </Button>
          </div>
        </div>
      );
    case 'admins':
      return (
        <div className="space-y-3">
          <p className="text-slate-400 text-sm">{t('Users with administrator access:', 'المستخدمون الذين لديهم صلاحية المسؤول:')}</p>
          {[
            { username: 'admin', name: 'System Administrator', role: 'Super Admin' },
            { username: 'hr_manager', name: 'HR Manager', role: 'HR Admin' },
          ].map(u => (
            <div key={u.username} className="flex items-center justify-between p-3 bg-slate-700/50 rounded border border-slate-600">
              <div>
                <div className="text-white font-medium">{u.name}</div>
                <div className="text-slate-400 text-xs">@{u.username}</div>
              </div>
              <Badge className="bg-blue-100 text-blue-700">{u.role}</Badge>
            </div>
          ))}
          <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={() => navigate('/users')}>
            {t('Manage Users →', 'إدارة المستخدمين ←')}
          </Button>
        </div>
      );
    case 'approvals':
      return (
        <div className="space-y-4">
          <div className="p-3 bg-slate-700/50 rounded border border-slate-600">
            <div className="text-white font-medium">{t('3 approval chains configured', 'تم تكوين 3 سلاسل موافقة')}</div>
            <div className="text-slate-400 text-sm mt-1">{t('Leave requests, payroll, recruitment', 'طلبات الإجازة، الرواتب، التوظيف')}</div>
          </div>
          <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={() => navigate('/approvals')}>
            {t('Manage Approval Chains →', 'إدارة سلاسل الموافقة ←')}
          </Button>
        </div>
      );
    case 'devices':
      return (
        <div className="space-y-4">
          <div className="p-3 bg-slate-700/50 rounded border border-slate-600">
            <div className="text-white font-medium">{t('4 attendance devices enrolled', 'تم تسجيل 4 أجهزة حضور')}</div>
            <div className="text-slate-400 text-sm mt-1">{t('ZKTeco biometric readers at main entrances', 'قارئات بيومترية ZKTeco عند المداخل الرئيسية')}</div>
          </div>
          <Button variant="outline" size="sm" className="border-slate-600 text-slate-300" onClick={() => navigate('/devices')}>
            {t('Manage Devices →', 'إدارة الأجهزة ←')}
          </Button>
        </div>
      );
    case 'backup':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label className="text-slate-300">{t('Backup Storage Path', 'مسار التخزين الاحتياطي')}</Label>
              <Input className={`mt-1 ${fieldClass}`} defaultValue="/var/backups/hrms" /></div>
            <div><Label className="text-slate-300">{t('Backup Frequency', 'تكرار النسخ الاحتياطي')}</Label>
              <Select defaultValue="daily"><SelectTrigger className={`mt-1 ${fieldClass}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="hourly">{t('Hourly', 'كل ساعة')}</SelectItem>
                  <SelectItem value="daily">{t('Daily', 'يومي')}</SelectItem>
                  <SelectItem value="weekly">{t('Weekly', 'أسبوعي')}</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-emerald-900/30 border border-emerald-700 rounded">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-300 text-sm">{t('Last backup: 2025-07-14 03:00 UTC — Success', 'آخر نسخة احتياطية: 2025-07-14 03:00 UTC — ناجحة')}</span>
          </div>
        </div>
      );
    case 'security':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label className="text-slate-300">{t('Session Timeout (minutes)', 'مهلة الجلسة (دقائق)')}</Label>
              <Input className={`mt-1 ${fieldClass} w-32`} type="number" defaultValue="30" /></div>
            <div><Label className="text-slate-300">{t('Min Password Length', 'الحد الأدنى لطول كلمة المرور')}</Label>
              <Input className={`mt-1 ${fieldClass} w-32`} type="number" defaultValue="12" /></div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded border border-slate-600">
            <Switch defaultChecked id="mfa" />
            <Label htmlFor="mfa" className="text-slate-300 cursor-pointer">{t('Require MFA for all admin accounts', 'طلب المصادقة الثنائية لجميع حسابات المسؤولين')}</Label>
          </div>
        </div>
      );
    case 'complete':
      return (
        <div className="text-center py-8 space-y-4">
          <div className="w-20 h-20 bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500">
            <PartyPopper className="w-10 h-10 text-emerald-400" />
          </div>
          <h3 className="text-2xl font-bold text-white">{t('Setup Complete!', 'اكتمل الإعداد!')}</h3>
          <p className="text-slate-400 max-w-md mx-auto">{t('Your GridMindHR is configured and ready. All 13 steps have been completed.', 'تم تكوين GridMindHR وهو جاهز. اكتملت جميع الـ 13 خطوة.')}</p>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {['Org Profile', 'Branding', 'Locale', 'Payroll', 'Work Week', 'Holidays', 'Structure', 'Roles', 'Admins', 'Approvals', 'Devices', 'Backup', 'Security'].map(s => (
              <Badge key={s} className="bg-emerald-100 text-emerald-700">✓ {s}</Badge>
            ))}
          </div>
          <Button className="mt-4 bg-primary hover:bg-primary/90" onClick={() => navigate('/')}>
            {t('Go to Dashboard →', 'اذهب إلى لوحة القيادة ←')}
          </Button>
        </div>
      );
    default:
      return <div className="text-slate-400">{t('Step not found', 'الخطوة غير موجودة')}</div>;
  }
}

export default function SetupWizard() {
  const { t } = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);

  const total = STEPS.length;
  const progress = Math.round((currentStep / (total - 1)) * 100);

  return (
    <AnimatedPage className="space-y-6">
      {/* Demo banner */}
      <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-3 flex items-center gap-3">
        <Rocket className="w-5 h-5 text-amber-400 shrink-0" />
        <span className="text-amber-300 font-semibold text-sm">
          {t('DEMO MODE — Wizard pre-completed. All fields show representative data.',
             'وضع العرض التوضيحي — اكتمل المعالج مسبقًا. تعرض جميع الحقول بيانات تمثيلية.')}
        </span>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Rocket className="w-8 h-8 text-primary" />
          {t('Setup Wizard', 'معالج الإعداد')}
        </h1>
        <p className="text-slate-400 mt-1">{t('Configure GridMindHR for first use', 'قم بتكوين GridMindHR للاستخدام الأول')}</p>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-400">
          <span>{t('Step', 'الخطوة')} {currentStep + 1} {t('of', 'من')} {total}</span>
          <span>{progress}% {t('complete', 'مكتمل')}</span>
        </div>
        <Progress value={progress} className="h-2 bg-slate-700" />
      </div>

      <div className="flex gap-6">
        {/* Vertical stepper */}
        <div className="hidden md:flex flex-col gap-1 w-52 shrink-0">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const done = idx < currentStep;
            const active = idx === currentStep;
            return (
              <button
                key={step.id}
                onClick={() => setCurrentStep(idx)}
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
                  active ? 'bg-primary/20 border border-primary text-primary' :
                  done ? 'text-emerald-400 hover:bg-slate-700/50' : 'text-slate-500 hover:bg-slate-700/30'
                }`}
              >
                <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                  {done ? <CheckCircle className="w-4 h-4 text-emerald-400" /> :
                   active ? <ChevronRight className="w-4 h-4 text-primary" /> :
                   <Circle className="w-4 h-4 text-slate-600" />}
                </div>
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t(step.labelEn, step.labelAr)}</span>
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <Card className="bg-slate-800 border-slate-700 flex-1">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              {(() => { const S = STEPS[currentStep]; const Icon = S.icon; return <Icon className="w-5 h-5 text-primary" />; })()}
              {t(STEPS[currentStep].labelEn, STEPS[currentStep].labelAr)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepContent stepId={STEPS[currentStep].id} />

            <div className="flex justify-between mt-8 pt-4 border-t border-slate-700">
              <Button
                variant="outline"
                className="border-slate-600 text-slate-300"
                disabled={currentStep === 0}
                onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
              >
                {t('← Back', '→ السابق')}
              </Button>
              <div className="flex gap-2">
                {currentStep < total - 1 && (
                  <Button
                    variant="ghost"
                    className="text-slate-400 hover:text-slate-300"
                    onClick={() => setCurrentStep(s => Math.min(total - 1, s + 1))}
                  >
                    {t('Skip', 'تخطي')}
                  </Button>
                )}
                {currentStep < total - 1 ? (
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    onClick={() => setCurrentStep(s => Math.min(total - 1, s + 1))}
                  >
                    {t('Save & Continue →', 'حفظ ومتابعة ←')}
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AnimatedPage>
  );
}
