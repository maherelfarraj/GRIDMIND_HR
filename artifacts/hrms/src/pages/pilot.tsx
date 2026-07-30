import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  PlayCircle, ChevronLeft, ChevronRight, Target, Users, Clock,
  AlertTriangle,
} from 'lucide-react';

interface Scenario {
  id: string;
  titleEn: string;
  titleAr: string;
  category: string;
  estimatedMinutes: number;
  applicableTo: string;
  personas: string[];
  steps: { titleEn: string; titleAr: string; descEn: string; descAr: string }[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'sc-1', titleEn: 'New Employee Onboarding', titleAr: 'تأهيل موظف جديد',
    category: 'HR', estimatedMinutes: 15, applicableTo: 'Core HR',
    personas: ['HR Manager', 'Department Head'],
    steps: [
      { titleEn: 'Create employee record', titleAr: 'إنشاء سجل الموظف', descEn: 'Navigate to Employees → Add Employee. Fill in all required fields.', descAr: 'انتقل إلى الموظفون ← إضافة موظف. أكمل جميع الحقول المطلوبة.' },
      { titleEn: 'Assign to department', titleAr: 'تعيين إلى قسم', descEn: 'In the employee record, set Department and Reporting Manager.', descAr: 'في سجل الموظف، حدد القسم والمسؤول المباشر.' },
      { titleEn: 'Set salary grade', titleAr: 'تحديد درجة الراتب', descEn: 'Go to Payroll → assign the appropriate salary grade.', descAr: 'انتقل إلى الرواتب ← حدد درجة الراتب المناسبة.' },
      { titleEn: 'Initialize leave balance', titleAr: 'تهيئة رصيد الإجازة', descEn: 'Leave Balances → find the new employee → set annual entitlement.', descAr: 'أرصدة الإجازات ← ابحث عن الموظف الجديد ← حدد الاستحقاق السنوي.' },
    ],
  },
  {
    id: 'sc-2', titleEn: 'Leave Request & Approval', titleAr: 'طلب إجازة وموافقة',
    category: 'Leave', estimatedMinutes: 10, applicableTo: 'Leave Management',
    personas: ['Employee', 'HR Manager', 'Supervisor'],
    steps: [
      { titleEn: 'Submit leave request', titleAr: 'تقديم طلب إجازة', descEn: 'My Portal → Leave → New Request. Select type, dates, add notes.', descAr: 'بوابتي ← الإجازات ← طلب جديد. اختر النوع والتواريخ وأضف ملاحظات.' },
      { titleEn: 'Manager approves', titleAr: 'موافقة المدير', descEn: 'Manager Portal → Approvals. Find the pending request and click Approve.', descAr: 'بوابة المدير ← الموافقات. ابحث عن الطلب المعلق وانقر موافقة.' },
      { titleEn: 'HR final approval', titleAr: 'موافقة الموارد البشرية النهائية', descEn: 'Approvals page → HR step → Approve. Balance is deducted.', descAr: 'صفحة الموافقات ← خطوة الموارد البشرية ← موافقة. يتم خصم الرصيد.' },
      { titleEn: 'Verify balance deducted', titleAr: 'التحقق من خصم الرصيد', descEn: 'Leave Balances → employee record → confirm days deducted.', descAr: 'أرصدة الإجازات ← سجل الموظف ← تأكيد خصم الأيام.' },
    ],
  },
  {
    id: 'sc-3', titleEn: 'Monthly Payroll Run', titleAr: 'تشغيل الرواتب الشهرية',
    category: 'Payroll', estimatedMinutes: 20, applicableTo: 'Payroll',
    personas: ['Payroll Officer', 'Finance Manager'],
    steps: [
      { titleEn: 'Open payroll period', titleAr: 'فتح فترة الرواتب', descEn: 'Payroll → New Period. Set month, approve start.', descAr: 'الرواتب ← فترة جديدة. حدد الشهر وابدأ الموافقة.' },
      { titleEn: 'Review calculations', titleAr: 'مراجعة الحسابات', descEn: 'Review each employee payslip. Check basic pay, allowances, deductions.', descAr: 'راجع قسيمة راتب كل موظف. تحقق من الراتب الأساسي والبدلات والخصومات.' },
      { titleEn: 'Approve payroll', titleAr: 'اعتماد الرواتب', descEn: 'Submit for approval. Finance Manager reviews and approves.', descAr: 'أرسل للموافقة. يراجع مدير المالية ويعتمد.' },
      { titleEn: 'Finalize & close', titleAr: 'الإنهاء والإغلاق', descEn: 'Close the payroll period. Payslips become available to employees.', descAr: 'أغلق فترة الرواتب. تصبح قسائم الرواتب متاحة للموظفين.' },
    ],
  },
  {
    id: 'sc-4', titleEn: 'Attendance Audit', titleAr: 'تدقيق الحضور',
    category: 'Attendance', estimatedMinutes: 10, applicableTo: 'Attendance',
    personas: ['HR Manager', 'Security Officer'],
    steps: [
      { titleEn: 'View daily attendance', titleAr: 'عرض الحضور اليومي', descEn: 'Attendance → select date → review status for all employees.', descAr: 'الحضور ← اختر التاريخ ← راجع الحالة لجميع الموظفين.' },
      { titleEn: 'Check punch events', titleAr: 'تحقق من أحداث البصمة', descEn: 'Punch Log → filter by employee or date → review in/out events.', descAr: 'سجل البصمة ← فلتر حسب الموظف أو التاريخ ← راجع أحداث الدخول والخروج.' },
      { titleEn: 'Identify anomalies', titleAr: 'تحديد الحالات الشاذة', descEn: 'Look for missing punches, late arrivals, or excessive overtime.', descAr: 'ابحث عن البصمات المفقودة والتأخيرات أو الوقت الإضافي المفرط.' },
      { titleEn: 'Generate report', titleAr: 'إنشاء تقرير', descEn: 'Reports → Attendance Summary → export for review.', descAr: 'التقارير ← ملخص الحضور ← تصدير للمراجعة.' },
    ],
  },
];

const DEMO_ACCOUNTS = [
  { id: 1, name: 'Ahmed Al-Qahtani', nameAr: 'أحمد القحطاني', role: 'HR Manager', username: 'hr_manager', description: 'Full HR admin access. Can manage employees, approve leave, run payroll.' },
  { id: 2, name: 'Fatima Al-Harbi', nameAr: 'فاطمة الحربي', role: 'Employee', username: 'emp_001', description: 'Regular employee. Access to My Portal, leave requests, own payslips.' },
  { id: 3, name: 'Khalid Al-Dosari', nameAr: 'خالد الدوسري', role: 'Department Head', username: 'dept_head', description: 'Department manager. Approves leave, views team attendance, manager portal.' },
  { id: 4, name: 'Noura Al-Shehri', nameAr: 'نورة الشهري', role: 'Payroll Officer', username: 'payroll_officer', description: 'Manages payroll periods, reviews payslips, handles pay components.' },
  { id: 5, name: 'System Administrator', nameAr: 'مسؤول النظام', role: 'Super Admin', username: 'admin', description: 'Full system access. All modules, settings, user management.' },
];

function ScenarioDialog({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const { t } = useLanguage();
  const [stepIdx, setStepIdx] = useState(0);
  const step = scenario.steps[stepIdx];

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {t(scenario.titleEn, scenario.titleAr)}
          </DialogTitle>
          <div className="text-slate-400 text-xs">{t('Step', 'الخطوة')} {stepIdx + 1} / {scenario.steps.length}</div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-1 flex-wrap">
            {scenario.steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStepIdx(i)}
                className={`w-6 h-6 rounded text-xs font-semibold transition-colors ${i === stepIdx ? 'bg-primary text-white' : i < stepIdx ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}
              >{i + 1}</button>
            ))}
          </div>
          <div className="p-4 bg-slate-800 border border-slate-700 rounded">
            <h3 className="text-white font-semibold mb-2">{t(step.titleEn, step.titleAr)}</h3>
            <p className="text-slate-300 text-sm">{t(step.descEn, step.descAr)}</p>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" className="border-slate-600 text-slate-300"
              disabled={stepIdx === 0} onClick={() => setStepIdx(i => i - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" />{t('Back', 'السابق')}
            </Button>
            {stepIdx < scenario.steps.length - 1 ? (
              <Button className="bg-primary hover:bg-primary/90" onClick={() => setStepIdx(i => i + 1)}>
                {t('Next', 'التالي')}<ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onClose}>
                {t('Complete ✓', 'اكتمل ✓')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScenariosTab() {
  const { t } = useLanguage();
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);

  const CATEGORY_COLORS: Record<string, string> = {
    HR: 'bg-blue-100 text-blue-700',
    Leave: 'bg-emerald-100 text-emerald-700',
    Payroll: 'bg-amber-100 text-amber-700',
    Attendance: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SCENARIOS.map(sc => (
          <Card key={sc.id} className="bg-slate-800 border-slate-700 hover:border-slate-500 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-semibold">{t(sc.titleEn, sc.titleAr)}</h3>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    <Badge className={`text-xs ${CATEGORY_COLORS[sc.category] ?? 'bg-slate-700 text-slate-300'}`}>{sc.category}</Badge>
                    <Badge className="bg-slate-700 text-slate-300 text-xs">{sc.applicableTo}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-slate-400 text-xs shrink-0">
                  <Clock className="w-3 h-3" />{sc.estimatedMinutes}m
                </div>
              </div>
              <div className="text-slate-400 text-xs mb-3">
                <Users className="w-3 h-3 inline mr-1" />
                {sc.personas.join(', ')}
              </div>
              <div className="text-slate-500 text-xs mb-3">{sc.steps.length} {t('steps', 'خطوات')}</div>
              <Button size="sm" className="w-full bg-primary hover:bg-primary/90" onClick={() => setActiveScenario(sc)}>
                <PlayCircle className="w-4 h-4 mr-2" />{t('Start Scenario', 'ابدأ السيناريو')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {activeScenario && <ScenarioDialog scenario={activeScenario} onClose={() => setActiveScenario(null)} />}
    </div>
  );
}

function DemoAccountsTab() {
  const { t } = useLanguage();
  const [showInstructions, setShowInstructions] = useState<number | null>(null);

  const account = DEMO_ACCOUNTS.find(a => a.id === showInstructions);

  return (
    <div className="space-y-4">
      <div className="bg-slate-700/50 border border-slate-600 rounded p-3 text-slate-400 text-sm">
        {t('Session switching is not implemented. Use the credentials below to log in as each persona.',
           'تبديل الجلسة غير مطبق. استخدم بيانات الاعتماد أدناه لتسجيل الدخول بصفة كل شخصية.')}
      </div>

      <div className="overflow-x-auto rounded border border-slate-700">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-700/50 border-slate-700">
              <TableHead className="text-slate-400">{t('Name', 'الاسم')}</TableHead>
              <TableHead className="text-slate-400">{t('Role', 'الدور')}</TableHead>
              <TableHead className="text-slate-400">{t('Username', 'اسم المستخدم')}</TableHead>
              <TableHead className="text-slate-400">{t('Description', 'الوصف')}</TableHead>
              <TableHead className="text-slate-400">{t('Actions', 'إجراءات')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_ACCOUNTS.map(acc => (
              <TableRow key={acc.id} className="border-slate-700 hover:bg-slate-700/30">
                <TableCell className="text-white font-medium">{t(acc.name, acc.nameAr)}</TableCell>
                <TableCell><Badge className="bg-blue-100 text-blue-700 text-xs">{acc.role}</Badge></TableCell>
                <TableCell className="text-slate-300 font-mono text-xs">{acc.username}</TableCell>
                <TableCell className="text-slate-400 text-xs max-w-xs">{acc.description}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 h-7 text-xs"
                    onClick={() => setShowInstructions(acc.id)}>
                    {t('Launch as', 'تشغيل بصفة')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showInstructions !== null} onOpenChange={() => setShowInstructions(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-white">{t('Launch as', 'تشغيل بصفة')} {account ? t(account.name, account.nameAr) : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300">
              <p className="mb-2">{t('To use this persona:', 'لاستخدام هذه الشخصية:')}</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-400">
                <li>{t('Sign out from the current session', 'تسجيل الخروج من الجلسة الحالية')}</li>
                <li>{t(`Log in with username: ${account?.username}`, `تسجيل الدخول باسم المستخدم: ${account?.username}`)}</li>
                <li>{t('Use the demo password: demo1234', 'استخدم كلمة المرور التجريبية: demo1234')}</li>
              </ol>
            </div>
            <p className="text-slate-500 text-xs">{t('Role description:', 'وصف الدور:')} {account?.description}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Pilot() {
  const { t } = useLanguage();

  return (
    <AnimatedPage className="space-y-6">
      {/* Pilot banner */}
      <div className="bg-blue-900/30 border-2 border-blue-600 rounded-lg p-4 flex items-center gap-3">
        <Target className="w-6 h-6 text-blue-400 shrink-0" />
        <div>
          <div className="text-blue-300 font-bold">{t('🎯 PILOT MODE — Using fictional data only', '🎯 وضع التجريب — يستخدم بيانات خيالية فقط')}</div>
          <div className="text-blue-400/70 text-sm">{t('All employees, transactions, and records shown are demo data.', 'جميع الموظفين والمعاملات والسجلات المعروضة هي بيانات تجريبية.')}</div>
        </div>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <PlayCircle className="w-8 h-8 text-primary" />
          {t('Pilot Scenarios', 'سيناريوهات تجريبية')}
        </h1>
        <p className="text-slate-400 mt-1">{t('Step-by-step guided scenarios and demo account personas', 'سيناريوهات إرشادية خطوة بخطوة وشخصيات حسابات تجريبية')}</p>
      </div>

      <Tabs defaultValue="scenarios">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="scenarios" className="data-[state=active]:bg-slate-700">
            {t('Scenarios', 'السيناريوهات')}
          </TabsTrigger>
          <TabsTrigger value="accounts" className="data-[state=active]:bg-slate-700">
            {t('Demo Accounts', 'الحسابات التجريبية')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="scenarios" className="mt-4"><ScenariosTab /></TabsContent>
        <TabsContent value="accounts" className="mt-4"><DemoAccountsTab /></TabsContent>
      </Tabs>
    </AnimatedPage>
  );
}
