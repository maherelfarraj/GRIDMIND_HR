import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckSquare, AlertTriangle, Printer } from 'lucide-react';

interface ChecklistItem {
  id: string;
  section: string;
  titleEn: string;
  titleAr: string;
  priority: 'required' | 'recommended' | 'optional';
  implLevel: 'production' | 'prototype';
}

const CHECKLIST: ChecklistItem[] = [
  // Infrastructure
  { id: 'infra-1', section: 'Infrastructure', titleEn: 'Database health verified', titleAr: 'التحقق من صحة قاعدة البيانات', priority: 'required', implLevel: 'production' },
  { id: 'infra-2', section: 'Infrastructure', titleEn: 'Disk space ≥ 100 GB available', titleAr: 'مساحة القرص ≥ 100 غيغابايت متاحة', priority: 'required', implLevel: 'prototype' },
  { id: 'infra-3', section: 'Infrastructure', titleEn: 'Backup schedule active and tested', titleAr: 'جدول النسخ الاحتياطي نشط ومختبر', priority: 'required', implLevel: 'prototype' },
  { id: 'infra-4', section: 'Infrastructure', titleEn: 'Network isolation confirmed', titleAr: 'تأكيد عزل الشبكة', priority: 'recommended', implLevel: 'prototype' },
  // Configuration
  { id: 'conf-1', section: 'Configuration', titleEn: 'Organization profile completed', titleAr: 'اكتمال ملف المنظمة', priority: 'required', implLevel: 'production' },
  { id: 'conf-2', section: 'Configuration', titleEn: 'Calendar and public holidays configured', titleAr: 'تكوين التقويم والعطل الرسمية', priority: 'required', implLevel: 'production' },
  { id: 'conf-3', section: 'Configuration', titleEn: 'Departments, grades, and roles set up', titleAr: 'إعداد الأقسام والدرجات والأدوار', priority: 'required', implLevel: 'production' },
  { id: 'conf-4', section: 'Configuration', titleEn: 'Approval chains configured', titleAr: 'تكوين سلاسل الموافقة', priority: 'required', implLevel: 'production' },
  // Security
  { id: 'sec-1', section: 'Security', titleEn: 'All admin passwords changed from defaults', titleAr: 'تغيير جميع كلمات مرور المسؤولين من الافتراضية', priority: 'required', implLevel: 'production' },
  { id: 'sec-2', section: 'Security', titleEn: 'MFA configured for admin accounts', titleAr: 'تكوين المصادقة الثنائية لحسابات المسؤولين', priority: 'required', implLevel: 'prototype' },
  { id: 'sec-3', section: 'Security', titleEn: 'Session timeout policy enforced', titleAr: 'تطبيق سياسة انتهاء مهلة الجلسة', priority: 'required', implLevel: 'production' },
  { id: 'sec-4', section: 'Security', titleEn: 'Audit logging enabled', titleAr: 'تمكين تسجيل التدقيق', priority: 'required', implLevel: 'production' },
  // Data
  { id: 'data-1', section: 'Data', titleEn: 'All employees loaded and verified', titleAr: 'تحميل جميع الموظفين والتحقق منهم', priority: 'required', implLevel: 'production' },
  { id: 'data-2', section: 'Data', titleEn: 'Leave balances initialized for current year', titleAr: 'تهيئة أرصدة الإجازات للسنة الحالية', priority: 'required', implLevel: 'production' },
  { id: 'data-3', section: 'Data', titleEn: 'Historical attendance data imported', titleAr: 'استيراد بيانات الحضور التاريخية', priority: 'recommended', implLevel: 'prototype' },
  // Testing
  { id: 'test-1', section: 'Testing', titleEn: 'Pilot accounts tested end-to-end', titleAr: 'اختبار الحسابات التجريبية من البداية للنهاية', priority: 'required', implLevel: 'prototype' },
  { id: 'test-2', section: 'Testing', titleEn: 'All modules verified by HR team', titleAr: 'التحقق من جميع الوحدات من قبل فريق الموارد البشرية', priority: 'required', implLevel: 'prototype' },
  { id: 'test-3', section: 'Testing', titleEn: 'Mobile interface tested', titleAr: 'اختبار واجهة الهاتف المحمول', priority: 'recommended', implLevel: 'prototype' },
  { id: 'test-4', section: 'Testing', titleEn: 'Arabic interface fully verified', titleAr: 'التحقق الكامل من الواجهة العربية', priority: 'required', implLevel: 'production' },
  // Documentation
  { id: 'doc-1', section: 'Documentation', titleEn: 'User manual available and distributed', titleAr: 'دليل المستخدم متاح وموزع', priority: 'recommended', implLevel: 'prototype' },
  { id: 'doc-2', section: 'Documentation', titleEn: 'Admin guide available', titleAr: 'دليل المسؤول متاح', priority: 'recommended', implLevel: 'prototype' },
  { id: 'doc-3', section: 'Documentation', titleEn: 'Support contacts published', titleAr: 'جهات الدعم منشورة', priority: 'optional', implLevel: 'prototype' },
  // Go-Live Authorization
  { id: 'auth-1', section: 'Go-Live Authorization', titleEn: 'IT Lead sign-off obtained', titleAr: 'الحصول على موافقة مسؤول تكنولوجيا المعلومات', priority: 'required', implLevel: 'prototype' },
  { id: 'auth-2', section: 'Go-Live Authorization', titleEn: 'HR Lead sign-off obtained', titleAr: 'الحصول على موافقة مسؤول الموارد البشرية', priority: 'required', implLevel: 'prototype' },
  { id: 'auth-3', section: 'Go-Live Authorization', titleEn: 'Department Head authorization', titleAr: 'تفويض رئيس القسم', priority: 'required', implLevel: 'prototype' },
];

const SECTIONS = [...new Set(CHECKLIST.map(i => i.section))];

const PRIORITY_STYLES: Record<string, string> = {
  required: 'bg-red-100 text-red-700',
  recommended: 'bg-amber-100 text-amber-700',
  optional: 'bg-slate-700 text-slate-300',
};

export default function GoLiveChecklist() {
  const { t } = useLanguage();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  function toggle(id: string) {
    setChecked(c => ({ ...c, [id]: !c[id] }));
  }

  const required = CHECKLIST.filter(i => i.priority === 'required');
  const doneRequired = required.filter(i => checked[i.id]).length;
  const totalRequired = required.length;
  const allDone = doneRequired === totalRequired;

  return (
    <AnimatedPage className="space-y-6">
      {/* Big warning banner */}
      <div className="bg-amber-500/20 border-2 border-amber-500 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-amber-300 font-bold text-base">{t('⚠ SYSTEM IS PILOT/DEMO — NOT FOR PRODUCTION USE', '⚠ النظام في وضع التجريب/العرض — غير مخصص للاستخدام الإنتاجي')}</div>
          <div className="text-amber-400/80 text-sm mt-1">{t('Items marked "⚠ Demo only" require additional development before production deployment.', 'العناصر المحددة بـ "⚠ تجريبي فقط" تتطلب تطويرًا إضافيًا قبل النشر الإنتاجي.')}</div>
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <CheckSquare className="w-8 h-8 text-primary" />
            {t('Go-Live Checklist', 'قائمة الإطلاق')}
          </h1>
          <p className="text-slate-400 mt-1">{t('Complete all required items before system launch', 'أكمل جميع العناصر المطلوبة قبل إطلاق النظام')}</p>
        </div>
        <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />{t('Print / Export', 'طباعة / تصدير')}
        </Button>
      </div>

      {/* Summary bar */}
      <Card className={`border-2 ${allDone ? 'bg-emerald-900/20 border-emerald-600' : 'bg-slate-800 border-slate-700'}`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <div className="text-white font-semibold text-lg">
              {doneRequired} / {totalRequired} {t('required items complete', 'عناصر إلزامية مكتملة')}
            </div>
            <div className="text-slate-400 text-sm">
              {CHECKLIST.filter(i => checked[i.id]).length} / {CHECKLIST.length} {t('total items', 'إجمالي العناصر')}
            </div>
          </div>
          {allDone ? (
            <Badge className="bg-emerald-100 text-emerald-700 text-base px-4 py-2">
              ✓ {t('Ready for Go-Live', 'جاهز للإطلاق')}
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 text-base px-4 py-2">
              {totalRequired - doneRequired} {t('required remaining', 'إلزامي متبقٍ')}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Sections */}
      {SECTIONS.map(section => {
        const items = CHECKLIST.filter(i => i.section === section);
        const doneSec = items.filter(i => checked[i.id]).length;
        return (
          <Card key={section} className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white flex items-center justify-between">
                <span>{t(section, section)}</span>
                <span className="text-sm font-normal text-slate-400">{doneSec}/{items.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map(item => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded border transition-colors cursor-pointer ${
                    checked[item.id] ? 'bg-emerald-900/20 border-emerald-700' : 'bg-slate-700/30 border-slate-600 hover:bg-slate-700/50'
                  }`}
                  onClick={() => toggle(item.id)}
                >
                  <Checkbox
                    checked={!!checked[item.id]}
                    onCheckedChange={() => toggle(item.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${checked[item.id] ? 'line-through text-slate-500' : 'text-white'}`}>
                      {t(item.titleEn, item.titleAr)}
                    </div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge className={`text-xs ${PRIORITY_STYLES[item.priority]}`}>
                        {item.priority}
                      </Badge>
                      <Badge className={`text-xs ${item.implLevel === 'production' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.implLevel === 'prototype' ? '⚠ Demo only' : 'production'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </AnimatedPage>
  );
}
